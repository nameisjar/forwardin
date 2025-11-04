<template>
  <div class="wrapper">
    <h2>Tambah Device</h2>

    <section class="create card">
      <h3>Buat Device Baru</h3>
      <div v-if="tutorReachedLimit" class="info">
        Tutor hanya bisa memiliki 1 device. Hapus device lama terlebih dahulu untuk membuat yang baru.
      </div>
      <form v-else @submit.prevent="createDevice" class="form-inline">
        <label class="field">
          <span>Nama Device</span>
          <input v-model="name" placeholder="Contoh: Device Tutor" />
        </label>
        <button class="btn primary" :disabled="loading || tutorReachedLimit">{{ loading ? 'Menyimpan...' : 'Buat Device' }}</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </section>

    <section class="pairing card">
      <h3>Pairing (QR)</h3>
      <div class="toolbar">
        <div class="filters">
          <div class="field">
            <label>Device</label>
            <select v-model="deviceId" :disabled="pairingLoading">
              <option value="" disabled>Pilih device</option>
              <option v-for="d in devices" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
            </select>
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <div class="row-btns">
              <button class="btn primary" @click="startPairing" :disabled="!deviceId || pairingLoading">{{ pairingLoading ? 'Menunggu QR...' : 'Mulai' }}</button>
              <button v-if="controller" class="btn outline" @click="stopPairing">Hentikan</button>
            </div>
          </div>
        </div>
      </div>
      <p class="hint">Scan QR dari WhatsApp di ponsel Anda. QR mungkin diperbarui beberapa kali.</p>
      <p v-if="selectedStatus === 'open'" class="hint success">Device sudah terhubung. Logout sesi dari hp jika ingin terhubung ulang</p>
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
      <div v-else-if="pairingLoading && !apiError" class="loading-qr">
        <div class="spinner"></div>
        <p>Menunggu QR Code...</p>
      </div>
    </section>

    <section class="list card">
      <h3>Daftar Device</h3>
      <div class="list-header">
        <button class="btn outline" @click="fetchDevices">Muat Ulang</button>
      </div>

      <div class="table-wrap">
        <table v-if="devices.length">
          <thead>
            <tr>
              <th>Nama</th>
              <th class="status-col">Status</th>
              <th class="action-col">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in devices" :key="d.id">
              <td class="name-col">{{ d.name }}</td>
              <td class="status-col">
                <span class="status-badge" :class="statusClass(d.status)">{{ humanStatus(d.status) }}</span>
              </td>
              <td class="action-col">
                <button class="btn danger btn-sm" @click="deleteOne(d)" :disabled="deleting">Hapus</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-state">
          <p>Belum ada device.</p>
          <small>Silakan buat device baru pada formulir di atas.</small>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue';
import { userApi } from '../api/http.js';
import { useAuthStore } from '../stores/auth.js';
import QRCode from 'qrcode';

const auth = useAuthStore();
const devices = ref([]);
const name = ref('');
const loading = ref(false);
const deleting = ref(false);
const error = ref('');
const success = ref('');

// Pairing state
const deviceId = ref('');
const qr = ref('');
const asciiQr = ref('');
const statusText = ref('');
const pairingLoading = ref(false);
const apiError = ref('');
let controller = null;

const isTutor = computed(() => auth.roleName === 'cs');
const tutorReachedLimit = computed(() => isTutor.value && devices.value.length >= 1);

// selection state
const selectedIds = ref([]); // string[]
const isSelected = (id) => selectedIds.value.includes(id);
const allSelected = computed(() => devices.value.length > 0 && selectedIds.value.length === devices.value.length);
const toggleOne = (id) => {
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter((x) => x !== id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
  }
};
const toggleAll = () => {
  if (allSelected.value) {
    selectedIds.value = [];
  } else {
    selectedIds.value = devices.value.map((d) => d.id);
  }
};

const fetchDevices = async () => {
  try {
    const { data } = await userApi.get('/devices');
    devices.value = data;
    const ids = new Set(devices.value.map((d) => d.id));
    selectedIds.value = selectedIds.value.filter((id) => ids.has(id));
  } catch (e) {
    console.error(e);
  }
};

const createDevice = async () => {
  error.value = '';
  success.value = '';
  if (tutorReachedLimit.value) {
    error.value = 'Tutor hanya dapat memiliki 1 device';
    return;
  }
  loading.value = true;
  try {
    await userApi.post('/tutors/devices', { name: name.value });
    success.value = 'Device berhasil dibuat';
    name.value = '';
    await fetchDevices();
  } catch (e) {
    error.value = (e && e.response && e.response.data && e.response.data.message) || 'Gagal membuat device';
  } finally {
    loading.value = false;
  }
};

const clearCurrentIfDeleted = (ids) => {
  try {
    const currentId = localStorage.getItem('device_selected_id');
    if (currentId && ids.includes(currentId)) {
      localStorage.removeItem('device_api_key');
      localStorage.removeItem('device_selected_id');
      localStorage.removeItem('device_selected_name');
    }
  } catch (_) {}
};

const doDelete = async (ids) => {
  if (!ids || ids.length === 0) return;
  const msg = ids.length === 1 ? 'Hapus device ini?' : `Hapus ${ids.length} device terpilih?`;
  if (!window.confirm(msg)) return;
  error.value = '';
  success.value = '';
  deleting.value = true;
  try {
    await userApi.delete('/devices', { data: { deviceIds: ids } });
    clearCurrentIfDeleted(ids);
    success.value = 'Device berhasil dihapus';
    selectedIds.value = [];
    await fetchDevices();
  } catch (e) {
    error.value = (e && e.response && e.response.data && e.response.data.message) || 'Gagal menghapus device';
  } finally {
    deleting.value = false;
  }
};

const deleteSelected = async () => {
  await doDelete(selectedIds.value);
};

const deleteOne = async (d) => {
  await doDelete([d.id]);
};

// Pairing helpers
const selectedDevice = computed(() => devices.value.find(d => String(d.id) === String(deviceId.value)));
const selectedStatus = computed(() => selectedDevice.value?.status || '');
// expose for template tests
// eslint-disable-next-line no-undef
defineExpose({ selectedStatus });

const onQRImageError = () => {
  console.error('QR image failed to load');
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

            if (data.qr) {
              if (typeof data.qr === 'string' && data.qr.startsWith('data:image')) {
                qr.value = data.qr;
                asciiQr.value = '';
              } else if (typeof data.qr === 'string') {
                await generateQRFromString(data.qr);
              }
            }

            if (!qr.value && data.qrRaw) {
              asciiQr.value = data.qrRaw;
            }

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
  if (!deviceId.value || pairingLoading.value) return;

  // refresh device list to reflect latest status
  await fetchDevices();

  // prevent parallel streams
  if (controller) {
    try { controller.abort(); } catch (e) { console.error('Error aborting controller:', e); }
  }

  qr.value = '';
  asciiQr.value = '';
  statusText.value = 'Menghubungkan...';
  pairingLoading.value = true;
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
      if (!pairingLoading.value) break; // stopped manually
      if (i < maxCycles - 1) {
        await wait(1000);
      }
    }
  } catch (e) {
    console.error('Pairing error:', e);
    statusText.value = e?.message || 'Koneksi terputus';
    apiError.value = e?.message || 'Terjadi kesalahan saat melakukan pairing';
  } finally {
    pairingLoading.value = false;
    controller = null;
    await fetchDevices();
  }
};

const stopPairing = () => {
  try { controller && controller.abort && controller.abort(); } catch (e) { console.error('Error stopping pairing:', e); }
  controller = null;
  pairingLoading.value = false;
  apiError.value = '';
  qr.value = '';
  asciiQr.value = '';
  statusText.value = 'Dihentikan';
};

// Pretty status mapping for table badges
const humanStatus = (s) => {
  const key = String(s || '').toLowerCase();
  const map = {
    open: 'Terhubung',
    connected: 'Terhubung',
    connecting: 'Menghubungkan…',
    pending: 'Menunggu…',
    closed: 'Terputus',
    disconnected: 'Terputus',
  };
  return map[key] || (s || '-');
};
const statusClass = (s) => {
  const key = String(s || '').toLowerCase();
  if (key === 'open' || key === 'connected') return 'is-open';
  if (key === 'connecting' || key === 'pending') return 'is-pending';
  return 'is-closed';
};

onMounted(async () => {
  if (!auth.me) {
    try { await auth.fetchMe(); } catch (_) {}
  }
  await fetchDevices();
});
</script>

<style scoped>
.wrapper { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
.card { background: #fff; border: 1px solid #eaeaea; border-radius: 12px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); padding: 12px; margin-top: 16px; }

.form-inline { display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span, .field > label { font-size: 12px; color: #667085; }
.field input, .field select { height: 36px; padding: 6px 10px; border: 1px solid #d8dde6; border-radius: 8px; background: #fff; }

.toolbar { margin-top: 8px; }
.toolbar .filters { display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); gap: 10px; }
.row-btns { display: flex; gap: 8px; }

.btn { height: 36px; padding: 0 12px; border: 1px solid #d0d5dd; background: #f9fafb; border-radius: 8px; cursor: pointer; font-weight: 500; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn.outline { background: #fff; }
.btn.danger { background: #e74c3c; border-color: #e74c3c; color: #fff; }
.btn-sm { height: 30px; padding: 0 10px; font-size: 13px; }

.table-wrap { overflow: auto; margin-top: 12px; }
 table { width: 100%; border-collapse: collapse; font-size: 14px; }
 thead th { position: sticky; top: 0; background: #f8fafc; z-index: 1; }
 th, td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; text-align: left; }
 tbody tr:nth-child(odd) { background: #fcfcfc; }
 tbody tr:hover { background: #f6faff; }

/* Pairing styles and QR remain */
.hint { color:#666; margin-top:8px; }
.success { color: #0a0; }
.error { color: #c00; }
.qr-container { margin-top: 20px; text-align: center; }
.qr { margin: 12px 0; display: flex; justify-content: center; }
.qr img { width: 320px; height: 320px; object-fit: contain; border: 2px solid #eee; border-radius: 8px; padding: 16px; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.qr-ascii { margin-top: 12px; border: 1px solid #eee; background: #fff; padding: 8px; border-radius: 4px; }
.qr-ascii pre { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; line-height: 10px; white-space: pre; color: #000; }
.loading-qr { display: flex; flex-direction: column; align-items: center; margin: 20px 0; padding: 20px; }
.spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

/* Status badge */
.status-col { width: 1%; white-space: nowrap; text-align: center; }
.action-col { width: 1%; white-space: nowrap; text-align: right; }
.name-col { font-weight: 500; color: #222; }
.status-badge { display: inline-block; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid transparent; }
.status-badge.is-open { color: #0b6b2b; background: #e6f6eb; border-color: #cbeed7; }
.status-badge.is-pending { color: #8a5a00; background: #fff6e5; border-color: #ffe8b8; }
.status-badge.is-closed { color: #7a2121; background: #fdeaea; border-color: #f7c8c8; }

.empty-state { border: 1px dashed #d8dbe3; border-radius: 8px; padding: 16px; text-align: center; color: #666; background: #fbfcfe; }
.empty-state p { margin: 0 0 4px 0; font-weight: 500; }
.empty-state small { color: #888; }

@media (max-width: 720px) {
  .toolbar .filters { grid-template-columns: 1fr; }
}
</style>