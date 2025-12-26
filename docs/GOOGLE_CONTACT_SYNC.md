# Google Contact Sync - Setup & Usage Guide

> **Last Updated**: December 26, 2025

## Overview

Google Contact Sync adalah fitur yang memungkinkan Anda untuk mensinkronisasi kontak antara Google Contacts dan sistem Forwardin. Fitur ini bersifat **dua arah (bidirectional)**:

1. **Download**: Mengambil kontak dari Google Contacts dan menyimpannya ke database Forwardin
2. **Upload**: Mengirim kontak dari Forwardin ke Google Contacts

---

## Requirements

### 1. Subscription Plan
Fitur ini memerlukan subscription plan yang memiliki `isGoogleContactSync: true`. Hubungi admin untuk mengaktifkan fitur ini pada akun Anda.

### 2. Google OAuth Setup
Anda memerlukan Google OAuth Access Token untuk mengakses Google Contacts API.

---

## Setup Google OAuth

### Step 1: Create Google Cloud Project

1. Buka [Google Cloud Console](https://console.cloud.google.com/)
2. Buat project baru atau pilih project yang ada
3. Navigate ke **APIs & Services** > **Library**
4. Cari dan enable **People API**

### Step 2: Configure OAuth Consent Screen

1. Navigate ke **APIs & Services** > **OAuth consent screen**
2. Pilih **External** (atau Internal untuk Google Workspace)
3. Isi informasi yang diperlukan:
   - App name: "Forwardin Contact Sync"
   - User support email
   - Developer contact email
4. Tambahkan scopes:
   - `https://www.googleapis.com/auth/contacts`
   - `https://www.googleapis.com/auth/contacts.readonly`
5. Save dan continue

### Step 3: Create OAuth Credentials

1. Navigate ke **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Application type: **Web application**
4. Authorized JavaScript origins:
   ```
   http://localhost:5173  (development)
   https://your-frontend-domain.com (production)
   ```
5. Authorized redirect URIs:
   ```
   http://localhost:5173/oauth/callback
   https://your-frontend-domain.com/oauth/callback
   ```
6. Download atau copy **Client ID** dan **Client Secret**

### Step 4: Configure Environment Variables

Tambahkan ke file `.env` frontend:

```env
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/oauth/callback
```

---

## API Usage

### Endpoint
```http
POST /contacts/sync-google
```

### Headers
```http
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

### Request Body
```json
{
  "accessToken": "google_oauth_access_token",
  "deviceId": "device-uuid-string"
}
```

### Response (Success)
```json
{
  "results": [
    {
      "index": 0,
      "downloaded": {
        "pkId": 123,
        "firstName": "John Doe",
        "phone": "628123456789"
      }
    },
    {
      "index": 1,
      "uploaded": "+628987654321"
    }
  ],
  "errors": []
}
```

### Response (Error)
```json
{
  "message": "Access denied. You do not have the required subscriptions to perform this action"
}
```

---

## How It Works

### Sync Process Flow

```
┌─────────────────┐                    ┌─────────────────┐
│  Google         │                    │    Forwardin    │
│  Contacts       │                    │    Database     │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
         │  1. Download contacts                │
         │ ──────────────────────────────────►  │
         │                                      │
         │  2. Compare with existing            │
         │                                      │
         │  3. Upload new Forwardin contacts    │
         │ ◄──────────────────────────────────  │
         │                                      │
         │  4. Save new Google contacts         │
         │ ──────────────────────────────────►  │
         │                                      │
```

### Detailed Steps

1. **Fetch Google Contacts**
   - Menggunakan Google People API endpoint:
   - `https://people.googleapis.com/v1/people/me/connections`
   - Fields: names, phoneNumbers, emailAddresses, birthdays, genders, photos

2. **Upload Forwardin Contacts to Google**
   - Mencari kontak di Forwardin yang belum ada di Google
   - Mengupload ke Google dengan format:
   ```json
   {
     "names": [{ "givenName": "John", "familyName": "Forwardin" }],
     "phoneNumbers": [{ "value": "628123456789", "type": "mobile" }]
   }
   ```

3. **Download Google Contacts to Forwardin**
   - Mencari kontak di Google yang belum ada di database Forwardin
   - Menyimpan dengan labels:
     - `sync_google`
     - `device_{deviceName}`
   - Menghubungkan ke device yang dipilih

4. **Link Messages**
   - Mengupdate `outgoingMessage` dan `incomingMessage` yang sudah ada
   - Menghubungkan ke contact baru yang dibuat

---

## Frontend Implementation Example

### 1. Google OAuth Button Component

```vue
<template>
  <button @click="startGoogleAuth" :disabled="loading">
    <img src="/google-icon.svg" alt="Google" />
    {{ loading ? 'Syncing...' : 'Sync with Google Contacts' }}
  </button>
</template>

<script setup>
import { ref } from 'vue';
import { http } from '@/api/http';

const props = defineProps({
  deviceId: { type: String, required: true }
});

const loading = ref(false);

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_GOOGLE_REDIRECT_URI;
const SCOPES = 'https://www.googleapis.com/auth/contacts';

function startGoogleAuth() {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', props.deviceId);
  
  window.location.href = authUrl.toString();
}
</script>
```

### 2. OAuth Callback Handler

```vue
<!-- /oauth/callback.vue -->
<template>
  <div class="callback-page">
    <div v-if="loading">Syncing contacts...</div>
    <div v-else-if="error">{{ error }}</div>
    <div v-else>Sync complete! Redirecting...</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '@/api/http';

const router = useRouter();
const loading = ref(true);
const error = ref(null);

onMounted(async () => {
  try {
    // Parse hash fragment
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    
    const accessToken = params.get('access_token');
    const deviceId = params.get('state');
    
    if (!accessToken) {
      throw new Error('No access token received');
    }
    
    // Call sync API
    const response = await http.post('/contacts/sync-google', {
      accessToken,
      deviceId
    });
    
    console.log('Sync results:', response.data);
    
    // Redirect back to contacts
    router.push('/contacts');
    
  } catch (err) {
    error.value = err.response?.data?.message || err.message;
  } finally {
    loading.value = false;
  }
});
</script>
```

### 3. Add Route

```javascript
// router/index.js
{
  path: '/oauth/callback',
  name: 'OAuthCallback',
  component: () => import('@/views/OAuthCallback.vue')
}
```

---

## Labels Applied

Kontak yang disinkronkan dari Google akan mendapat labels berikut:

| Label | Keterangan |
|-------|------------|
| `sync_google` | Menandakan kontak berasal dari Google Sync |
| `device_{deviceName}` | Menandakan device mana yang melakukan sync |

---

## Limitations

1. **Phone Number Matching**
   - Kontak dicocokan berdasarkan nomor telepon
   - Format nomor harus konsisten (tanpa +, tanpa spasi)

2. **One-way Photo Sync**
   - Foto tidak di-download dari Google
   - Hanya data nama dan nomor telepon yang disinkronkan

3. **Device Specific**
   - Setiap sync terkait dengan satu device
   - Kontak yang sama bisa ada di multiple devices

4. **Rate Limiting**
   - Google API memiliki rate limit
   - Jangan melakukan sync terlalu sering

---

## Troubleshooting

### "Access denied. You do not have the required subscriptions"
- Hubungi admin untuk mengaktifkan fitur Google Contact Sync pada subscription plan Anda

### "Invalid access token"
- Token sudah expired, ulangi proses OAuth
- Pastikan scope yang diminta sudah benar

### Kontak tidak muncul setelah sync
- Pastikan nomor telepon valid
- Cek apakah kontak sudah ada (duplikat dicegah)
- Lihat response `errors` array untuk detail error

### Google OAuth Error
- Pastikan redirect URI sudah dikonfigurasi dengan benar di Google Cloud Console
- Verifikasi Client ID sudah benar

---

## Security Considerations

1. **Access Token Storage**
   - Jangan simpan Google access token di localStorage/sessionStorage
   - Gunakan langsung setelah OAuth callback

2. **Token Scope**
   - Minta scope minimum yang diperlukan
   - `contacts` scope memberikan akses baca dan tulis

3. **Data Privacy**
   - Informasikan user bahwa data mereka akan disinkronkan
   - Berikan opsi untuk membatalkan/menghapus data yang disinkronkan

---

## Example cURL Request

```bash
curl -X POST "https://your-api.com/contacts/sync-google" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accessToken": "ya29.a0AfH6SMB...",
    "deviceId": "abc123-def456-ghi789"
  }'
```

---

## Related Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/contacts` | GET | List all contacts |
| `/contacts` | POST | Create single contact |
| `/contacts/import` | POST | Import from Excel/CSV |
| `/contacts/labels` | GET | Get all labels |
| `/contacts/sync-google` | POST | Sync with Google Contacts |
