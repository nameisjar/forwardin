<template>
  <div>
    <h2>Tambah Device</h2>

    <section class="create">
      <h3>Buat Device Baru</h3>
      <div v-if="tutorReachedLimit" class="info">
        Tutor hanya bisa memiliki 1 device. Hapus device lama terlebih dahulu untuk membuat yang baru.
      </div>
      <form v-else @submit.prevent="createDevice">
        <label>
          Nama Device
          <input v-model="name" placeholder="Contoh: Device Tutor" />
        </label>
        <button :disabled="loading || tutorReachedLimit">{{ loading ? 'Menyimpan...' : 'Buat Device' }}</button>
      </form>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="success" class="success">{{ success }}</p>
    </section>

    <section class="pairing">
      <h3>Pairing (QR)</h3>
      <div class="row">
        <label>Device</label>
        <select v-model="deviceId" :disabled="pairingLoading">
          <option value="" disabled>Pilih device</option>
          <option v-for="d in devices" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
        </select>
        <button @click="startPairing" :disabled="!deviceId || pairingLoading">{{ pairingLoading ? 'Menunggu QR...' : 'Mulai' }}</button>
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
      <div v-else-if="pairingLoading && !apiError" class="loading-qr">
        <div class="spinner"></div>
        <p>Menunggu QR Code...</p>
      </div>
    </section>

    <section class="list">
      <h3>Daftar Device</h3>
      <div class="list-header">
        <button class="btn btn-primary" @click="fetchDevices">Muat Ulang</button>
      </div>

      <table v-if="devices.length" class="devices-table">
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
              <button class="btn btn-danger btn-sm" @click="deleteOne(d)" :disabled="deleting">Hapus</button>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="empty-state">
        <p>Belum ada device.</p>
        <small>Silakan buat device baru pada formulir di atas.</small>
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
.create, .list, .pairing { margin-top: 16px; }
label { display: block; margin: 8px 0; }
input { padding: 8px; width: 320px; }
button { margin-right: 8px; }
.error { color: #c00; }
.success { color: #0a0; }
.info { color:#555; background:#f9f9f9; border:1px solid #eee; padding:8px; border-radius:6px; margin-bottom:8px; }
.hint { color:#666; margin-top:8px; }

/* Pairing styles (adapted from PairSession) */
.row { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
select { padding: 8px; min-width: 360px; border: 1px solid #ddd; border-radius: 4px; }
button { padding: 8px 12px; background: #007bff; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
button:disabled { background: #ccc; cursor: not-allowed; }
.qr-container { margin-top: 20px; text-align: center; }
.qr { margin: 12px 0; display: flex; justify-content: center; }
.qr img { width: 320px; height: 320px; object-fit: contain; border: 2px solid #eee; border-radius: 8px; padding: 16px; background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.qr-ascii { margin-top: 12px; border: 1px solid #eee; background: #fff; padding: 8px; border-radius: 4px; }
.qr-ascii pre { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; line-height: 10px; white-space: pre; color: #000; }
.qr-instructions { color: #666; font-size: 14px; margin-top: 12px; padding: 12px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid #007bff; }
.loading-qr { display: flex; flex-direction: column; align-items: center; margin: 20px 0; padding: 20px; }
.spinner { width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #007bff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

/* Actions/header layout */
.list-header { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }

/* Button presets */
.btn { padding: 8px 12px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: 14px; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary { background: #2f6fed; color: #fff; border-color: #2f6fed; }
.btn-primary:hover:not(:disabled) { background: #255ad1; border-color: #255ad1; }
.btn-danger { background: #e43d3d; color: #fff; border-color: #e43d3d; }
.btn-danger:hover:not(:disabled) { background: #c92f2f; border-color: #c92f2f; }
.btn-sm { padding: 6px 10px; font-size: 13px; }

/* Table styling */
.devices-table { width: auto; display: inline-table; max-width: 100%; border-collapse: separate; border-spacing: 0; background: #fff; border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
.devices-table thead th { background: #f7f9fc; color: #333; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
.devices-table tbody td { padding: 6px 8px; border-bottom: 1px solid #f1f1f1; vertical-align: middle; }
.devices-table tbody tr:last-child td { border-bottom: none; }
.devices-table tbody tr:hover { background: #fafcff; }
.devices-table tbody tr.selected { background: #eef5ff; }
.select-col { width: 42px; text-align: center; }
.status-col { width: 1%; white-space: nowrap; text-align: center; }
.action-col { width: 1%; white-space: nowrap; text-align: right; }
.action-col { width: 1% !important; }
.name-col { font-weight: 500; color: #222; }

/* Status badge */
.status-badge { display: inline-block; padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid transparent; }
.status-badge.is-open { color: #0b6b2b; background: #e6f6eb; border-color: #cbeed7; }
.status-badge.is-pending { color: #8a5a00; background: #fff6e5; border-color: #ffe8b8; }
.status-badge.is-closed { color: #7a2121; background: #fdeaea; border-color: #f7c8c8; }

/* Empty state */
.empty-state { border: 1px dashed #d8dbe3; border-radius: 8px; padding: 16px; text-align: center; color: #666; background: #fbfcfe; }
.empty-state p { margin: 0 0 4px 0; font-weight: 500; }
.empty-state small { color: #888; }

/* Constrain list width so columns aren’t too far apart */
.list { max-width: 560px; }
</style>