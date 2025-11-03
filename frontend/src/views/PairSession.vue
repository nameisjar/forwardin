<template>
  <div>
    <h2>Pairing (QR)</h2>

    <section class="start">
      <h3>Mulai Pairing</h3>
      <div class="row">
        <label>Device</label>
        <select v-model="deviceId" :disabled="loading">
          <option value="" disabled>Pilih device</option>
          <option v-for="d in devices" :key="d.id" :value="String(d.id)">{{ d.name }} — {{ d.id }}</option>
        </select>
        <button @click="startPairing" :disabled="!deviceId || loading">{{ loading ? 'Menunggu QR...' : 'Mulai' }}</button>
        <button v-if="controller" @click="stopPairing">Hentikan</button>
      </div>
      <p class="hint">Scan QR dari WhatsApp di ponsel Anda. QR mungkin diperbarui beberapa kali.</p>
      <p v-if="selectedStatus === 'open'" class="hint success">Device sudah terhubung. Hapus sesi jika ingin Pairing ulang.</p>
      <p v-if="statusText">Status: {{ statusText }}</p>
      <p v-if="apiError" class="error">{{ apiError }}</p>
      
      <!-- QR Code Display -->
      <div v-if="qr" class="qr-container">
        <h4>QR Code WhatsApp</h4>
        <div class="qr">
          <img :src="qr" alt="QR Code" @error="onQRImageError" />
        </div>
        <p class="qr-instructions">Buka WhatsApp di ponsel Anda → Ketuk titik tiga → Perangkat Tertaut → Tautkan Perangkat → Scan QR code di atas</p>
      </div>
      
      <div v-else-if="asciiQr" class="qr-ascii">
        <h4>QR Code (Text)</h4>
        <pre>{{ asciiQr }}</pre>
      </div>
      
      <!-- Loading indicator when waiting for QR -->
      <div v-else-if="loading && !apiError" class="loading-qr">
        <div class="spinner"></div>
        <p>Menunggu QR Code...</p>
      </div>
    </section>

    <section class="sessions" v-if="showSessions">
      <h3>Sesi Aktif</h3>
      <button @click="loadSessions">Muat Ulang Sesi</button>
      <ul>
        <li v-for="(s, idx) in sessions" :key="s.sessionId || idx" class="session-item">
          <span>{{ (s.device && s.device.name) ? s.device.name : '-' }} — {{ (s.device && s.device.phone) ? s.device.phone : '-' }} — {{ (s.device && s.device.status) ? s.device.status : (s.status || '-') }}</span>
          <span v-if="s.sessionId" class="session-id"> — sessionId: {{ s.sessionId }}</span>
          <button v-if="(s.device?.status || s.status) === 'open' && s.sessionId" @click="onSendTest(s.sessionId)">Kirim pesan tes</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue';
import { userApi } from '../api/http.js';
import QRCode from 'qrcode';

const devices = ref([]);
const sessions = ref([]);
const deviceId = ref('');
const qr = ref('');
const asciiQr = ref('');
const statusText = ref('');
const loading = ref(false);
const apiError = ref('');
let controller = null;

// New: hide sessions list by default
const showSessions = ref(false);

const selectedDevice = computed(() => devices.value.find(d => String(d.id) === String(deviceId.value)));
const selectedStatus = computed(() => selectedDevice.value?.status || '');

// expose to template
// eslint-disable-next-line no-undef
defineExpose({ selectedStatus });

const loadDevices = async () => {
  try {
    const { data } = await userApi.get('/devices');
    devices.value = data;
  } catch (error) {
    console.error('Error loading devices:', error);
    apiError.value = 'Gagal memuat daftar device';
  }
};

const loadSessions = async () => {
  try {
    const { data } = await userApi.get('/sessions');
    sessions.value = data || [];
    // update status text for current selection
    if (deviceId.value && selectedStatus.value) {
      statusText.value = selectedStatus.value;
    }
  } catch (error) {
    console.error('Error loading sessions:', error);
  }
};

const onQRImageError = () => {
  console.error('QR image failed to load');
  // Try to regenerate QR if image fails
  if (qr.value && !qr.value.startsWith('data:image')) {
    generateQRFromString(qr.value);
  }
};

const generateQRFromString = async (qrString) => {
  try {
    qr.value = await QRCode.toDataURL(qrString);
    asciiQr.value = '';
  } catch (error) {
    console.error('Error generating QR from string:', error);
  }
};

async function openSSEOnce() {
  controller = new AbortController();
  apiError.value = '';
  qr.value = '';
  asciiQr.value = '';
  
  const token = localStorage.getItem('token') || '';
  
  try {
    const resp = await fetch('/tutors/sessions/create-sse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ deviceId: deviceId.value }),
      signal: controller.signal,
      cache: 'no-store'
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${errorText}`);
    }
    
    if (!resp.body) {
      throw new Error('Response body is null');
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let connectedOpen = false;

    const processLines = async () => {
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data:')) {
          const json = line.slice(5).trim();
          if (!json) continue;
          
          try {
            const data = JSON.parse(json);
            
            if (data.error) { 
              apiError.value = data.error; 
              continue; 
            }

            // Handle QR code data
            if (data.qr) {
              if (typeof data.qr === 'string' && data.qr.startsWith('data:image')) {
                qr.value = data.qr;
                asciiQr.value = '';
              } else if (typeof data.qr === 'string') {
                await generateQRFromString(data.qr);
              }
            }

            // Handle ASCII QR as fallback
            if (!qr.value && data.qrRaw) {
              asciiQr.value = data.qrRaw;
            }
            
            // Handle connection status
            if (data.connection) {
              statusText.value = data.connection;
              if (data.connection === 'open') {
                connectedOpen = true;
                qr.value = '';
                asciiQr.value = '';
                statusText.value = 'Berhasil terhubung!';
              }
            }
          } catch (parseError) {
            console.error('Error parsing SSE data:', parseError);
          }
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      await processLines();
    }

    return connectedOpen;
  } catch (error) {
    if (error.name === 'AbortError') {
      return false; // Stopped manually
    }
    throw error;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const startPairing = async () => {
  if (!deviceId.value || loading.value) return;
  
  // refresh sessions to get latest status
  await loadSessions();

  // prevent parallel streams
  if (controller) {
    try { 
      controller.abort(); 
    } catch (e) {
      console.error('Error aborting controller:', e);
    }
  }

  qr.value = '';
  asciiQr.value = '';
  statusText.value = 'Menghubungkan...';
  loading.value = true;
  apiError.value = '';

  try {
    const maxCycles = 3;
    for (let i = 0; i < maxCycles; i++) {
      statusText.value = `Mencoba koneksi... (${i + 1}/${maxCycles})`;
      const opened = await openSSEOnce();
      if (opened) {
        statusText.value = 'Berhasil terhubung!';
        break;
      }
      if (!loading.value) break; // stopped manually
      if (i < maxCycles - 1) {
        await wait(1000); // Wait before retry
      }
    }
  } catch (e) {
    console.error('Pairing error:', e);
    statusText.value = e?.message || 'Koneksi terputus';
    apiError.value = e?.message || 'Terjadi kesalahan saat melakukan pairing';
  } finally {
    loading.value = false;
    controller = null;
    await loadDevices();
    await loadSessions();
  }
};

const stopPairing = () => {
  try { 
    controller && controller.abort && controller.abort(); 
  } catch (e) {
    console.error('Error stopping pairing:', e);
  }
  controller = null;
  loading.value = false;
  apiError.value = '';
  qr.value = '';
  asciiQr.value = '';
  statusText.value = 'Dihentikan';
};

const onSendTest = async (sessionId) => {
  try {
    const defaultPhone = localStorage.getItem('admin_phone') || '';
    const to = window.prompt('Masukkan nomor tujuan (contoh: 62812xxxx)', defaultPhone);
    if (!to) return;
    const text = window.prompt('Isi pesan tes', 'Login berhasil.');
    await userApi.post(`/messages/${sessionId}/send`, { 
      to: [to], 
      message: text || 'Login berhasil.' 
    });
    alert('Pesan tes terkirim.');
  } catch (e) {
    alert(`Gagal mengirim pesan tes: ${e?.response?.data?.message || e?.message || 'Unknown error'}`);
  }
};

onMounted(async () => {
  await loadDevices();
  await loadSessions();
});
</script>

<style scoped>
.row { 
  display: flex; 
  gap: 8px; 
  align-items: center; 
  margin-bottom: 16px;
}

select { 
  padding: 8px; 
  min-width: 360px; 
  border: 1px solid #ddd;
  border-radius: 4px;
}

button {
  padding: 8px 16px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

button:disabled {
  background: #ccc;
  cursor: not-allowed;
}

button:hover:not(:disabled) {
  background: #0056b3;
}

.qr-container {
  margin-top: 20px;
  text-align: center;
}

.qr { 
  margin: 12px 0;
  display: flex;
  justify-content: center;
}

.qr img { 
  width: 320px; 
  height: 320px; 
  object-fit: contain; 
  border: 2px solid #eee; 
  border-radius: 8px;
  padding: 16px; 
  background: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.qr-ascii { 
  margin-top: 12px; 
  border: 1px solid #eee; 
  background: #fff; 
  padding: 8px; 
  border-radius: 4px;
}

.qr-ascii pre { 
  margin: 0; 
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; 
  font-size: 10px; 
  line-height: 10px; 
  white-space: pre; 
  color: #000; 
}

.qr-instructions {
  color: #666;
  font-size: 14px;
  margin-top: 12px;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 4px;
  border-left: 4px solid #007bff;
}

.loading-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 20px 0;
  padding: 20px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #007bff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.hint { 
  color: #666; 
  font-size: 14px;
  margin: 8px 0;
}

.hint.success {
  color: #28a745;
  font-weight: bold;
}

.error { 
  color: #dc3545; 
  font-weight: bold;
  padding: 8px;
  background: #f8d7da;
  border: 1px solid #f5c6cb;
  border-radius: 4px;
  margin: 8px 0;
}

.session-item { 
  display: flex; 
  align-items: center; 
  gap: 8px; 
  flex-wrap: wrap; 
  padding: 8px;
  border: 1px solid #eee;
  border-radius: 4px;
  margin: 8px 0;
}

.session-id { 
  color: #888; 
  font-size: 12px;
}

.sessions {
  margin-top: 32px;
}

.sessions ul {
  list-style: none;
  padding: 0;
}
</style>