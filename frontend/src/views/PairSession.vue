<template>
  <div>
    <h2>Pairing (QR)</h2>

    <section class="start">
      <h3>Mulai Pairing</h3>
      <div class="row">
        <label>Device</label>
        <select v-model="deviceId">
          <option value="" disabled>Pilih device</option>
          <option v-for="d in devices" :key="d.id" :value="String(d.id)">{{ d.name }} — {{ d.id }}</option>
        </select>
        <button @click="startPairing">{{ loading ? 'Menunggu QR...' : 'Mulai' }}</button>
        <button v-if="controller" @click="stopPairing">Hentikan</button>
      </div>
      <p class="hint">Scan QR dari WhatsApp di ponsel Anda. QR mungkin diperbarui beberapa kali.</p>
      <p v-if="selectedStatus === 'open'" class="hint">Device sudah terhubung. Hapus sesi jika ingin Pairing ulang.</p>
      <!-- <p class="hint">Tombol "Muat Ulang Sesi" hanya menyegarkan daftar sesi, tidak memulai pairing.</p> -->
      <p v-if="statusText">Status: {{ statusText }}</p>
      <p v-if="apiError" class="error">{{ apiError }}</p>
      <div v-if="qr" class="qr">
        <img :src="qr" alt="QR Code" />
      </div>
      <div v-else-if="asciiQr" class="qr-ascii">
        <pre>{{ asciiQr }}</pre>
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
  const { data } = await userApi.get('/devices');
  devices.value = data;
};

const loadSessions = async () => {
  const { data } = await userApi.get('/sessions');
  sessions.value = data || [];
  // update status text for current selection
  if (deviceId.value && selectedStatus.value) {
    statusText.value = selectedStatus.value;
  }
};

async function openSSEOnce() {
  controller = new AbortController();
  apiError.value = '';
  const token = localStorage.getItem('token') || '';
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

  if (!resp.ok || !resp.body) throw new Error('Gagal membuka SSE');

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
          if (data.error) { apiError.value = data.error; continue; }

          if (data.qr) {
            if (typeof data.qr === 'string' && data.qr.startsWith('data:image')) {
              qr.value = data.qr;
              asciiQr.value = '';
            } else if (typeof data.qr === 'string') {
              try {
                qr.value = await QRCode.toDataURL(data.qr);
                asciiQr.value = '';
              } catch {}
            }
          }

          if (!qr.value && data.qrRaw) asciiQr.value = data.qrRaw;
          if (data.connection) {
            statusText.value = data.connection;
            if (data.connection === 'open') connectedOpen = true;
          }
        } catch (_) {}
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    processLines();
  }

  return connectedOpen;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const startPairing = async () => {
  if (!deviceId.value || loading.value) return; // guard here instead of disabling button
  // refresh sessions to get latest status, but do not block pairing if status is 'open'
  await loadSessions();

  // prevent parallel streams
  if (controller) try { controller.abort(); } catch {}

  qr.value = '';
  asciiQr.value = '';
  statusText.value = 'Menghubungkan...';
  loading.value = true;

  try {
    const maxCycles = 3;
    for (let i = 0; i < maxCycles; i++) {
      const opened = await openSSEOnce();
      if (opened) break;
      if (!loading.value) break; // stopped manually
      await wait(500);
    }
  } catch (e) {
    statusText.value = e?.message || 'Terputus';
  } finally {
    loading.value = false;
    controller = null;
    await loadDevices();
    await loadSessions();
  }
};

const stopPairing = () => {
  try { controller && controller.abort && controller.abort(); } catch {}
  controller = null;
  loading.value = false;
  apiError.value = '';
};

const onSendTest = async (sessionId) => {
  try {
    const defaultPhone = localStorage.getItem('admin_phone') || '';
    const to = window.prompt('Masukkan nomor tujuan (contoh: 62812xxxx)', defaultPhone);
    if (!to) return;
    const text = window.prompt('Isi pesan tes', 'Login berhasil.');
    await userApi.post(`/messages/${sessionId}/send/test`, { to, message: text || 'Login berhasil.' });
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
.row { display:flex; gap:8px; align-items:center; }
select { padding:8px; min-width: 360px; }
.qr { margin-top: 12px; }
.qr img { width: 320px; height: 320px; object-fit: contain; border:1px solid #eee; padding:8px; }
.qr-ascii { margin-top: 12px; border:1px solid #eee; background:#fff; padding:8px; }
.qr-ascii pre { margin:0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; line-height: 10px; white-space: pre; color:#000; }
.hint { color:#666; }
.error { color: #b00020; }
.session-item { display:flex; align-items:center; gap: 8px; flex-wrap: wrap; }
.session-id { color:#888; }
</style>