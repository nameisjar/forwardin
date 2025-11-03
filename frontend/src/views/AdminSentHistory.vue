<template>
  <div class="wrapper">
    <h2>Semua Pesan Terkirim (Admin)</h2>

    <div class="toolbar">
      <input v-model="phoneNumber" placeholder="Filter nomor (628xx)" />
      <input v-model="tutorQuery" placeholder="Tutor" />
      <input v-model="messageQuery" placeholder="Cari pesan" />
      <select v-model="sortBy">
        <option value="createdAt">Terbaru</option>
        <option value="to">Nomor</option>
        <option value="message">Pesan</option>
      </select>
      <select v-model="sortDir">
        <option value="desc">↓</option>
        <option value="asc">↑</option>
      </select>
      <select v-model.number="pageSize">
        <option :value="10">10</option>
        <option :value="25">25</option>
        <option :value="50">50</option>
        <option :value="100">100</option>
      </select>
      <button @click="load(1)" :disabled="loading">{{ loading ? 'Memuat...' : 'Muat' }}</button>
    </div>

    <div class="table-wrap">
      <table v-if="displayedRows.length">
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Nomor</th>
            <th>Kontak</th>
            <th>Pesan</th>
            <th>Sumber</th>
            <th>Tutor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in displayedRows" :key="r.id">
            <td>{{ fmt(r.createdAt) }}</td>
            <td>{{ normalizeNumber(r.to) }}</td>
            <td>{{ r.contact ? (r.contact.firstName + ' ' + (r.contact.lastName||'')) : '-' }}</td>
            <td class="cell-msg">{{ r.message }}</td>
            <td>
              <span v-if="sourceSimple(r) === 'reminder'" class="badge rm">Reminder</span>
              <span v-else-if="sourceSimple(r) === 'feedback'" class="badge fb">Feedback</span>
              <span v-else-if="sourceSimple(r) === 'broadcast'" class="badge bc">Broadcast</span>
              <span v-else>-</span>
            </td>
            <td>{{ tutorName(r) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">Belum ada data.</div>
    </div>

    <div class="pager" v-if="meta.totalPages > 1">
      <button :disabled="page<=1 || loading" @click="load(page-1)">Prev</button>
      <span>Halaman {{ page }} / {{ meta.totalPages }}</span>
      <button :disabled="!meta.hasMore || loading" @click="load(page+1)">Next</button>
    </div>

    <p v-if="err" class="error">{{ err }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { userApi, deviceApi } from '../api/http.js';

const rows = ref([]);
const meta = ref({ totalMessages: 0, currentPage: 1, totalPages: 1, hasMore: false });
const page = ref(1);
const pageSize = ref(25);
const sortBy = ref('createdAt');
const sortDir = ref('desc');
const phoneNumber = ref('');
const tutorQuery = ref('');
const messageQuery = ref('');
const loading = ref(false);
const err = ref('');

const isBroadcast = (r) => String(r?.id || '').startsWith('BC_');
const displayedRows = computed(() => {
  const list = rows.value || [];
  if (!tutorQuery.value) return list;
  const q = tutorQuery.value.trim().toLowerCase();
  return list.filter((r) => tutorName(r).toLowerCase().includes(q));
});

const deviceTutorMap = ref({});
const sessionTutorMap = ref({});
const tutorMapLoaded = ref(false);

const broadcastNameMap = ref({});
const getBroadcastPkId = (id) => {
  const m = String(id || '').match(/^BC_(\d+)_/);
  return m ? Number(m[1]) : null;
};
const loadBroadcasts = async () => {
  try {
    const { data } = await deviceApi.get('/messages/broadcasts');
    const arr = Array.isArray(data) ? data : [];
    const map = {};
    for (const b of arr) {
      const key = Number(b?.pkId ?? b?.id);
      if (Number.isFinite(key)) map[key] = String(b?.name || '');
    }
    broadcastNameMap.value = map;
  } catch (_) { /* ignore */ }
};

const fmt = (d) => {
  try { const dd = new Date(d); return isNaN(dd.getTime()) ? '-' : dd.toLocaleString(); } catch { return '-'; }
};
const normalizeNumber = (to) => String(to || '').replace('@s.whatsapp.net','');
const badgeClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'warn';
  if (s.includes('sent') || s.includes('success')) return 'ok';
  if (s.includes('pending')) return 'info';
  return 'info';
};
const tutorName = (r) => {
  const f = r.tutor?.firstName || r.user?.firstName;
  const l = r.tutor?.lastName || r.user?.lastName;
  if (f) return [f, l].filter(Boolean).join(' ');
  const did = r.deviceId || r.device?.id || r.device_id;
  const byDevice = did && deviceTutorMap.value[did];
  if (byDevice) return byDevice;
  const sid = r.sessionId || r.session_id;
  const bySession = sid && sessionTutorMap.value[sid];
  return bySession || '-';
};

const sourceLabel = (r) => {
  const t = (r && r.broadcastType) ? String(r.broadcastType).toLowerCase() : '';
  if (t === 'feedback') return 'Feedback';
  if (t === 'reminder') return 'Reminder';

  const name = typeof r?.broadcastName === 'string' ? r.broadcastName : '';
  if (name) {
    const isReminderByName = /\bRecipients\b/i.test(name);
    return isReminderByName ? 'Reminder' : 'Feedback';
  }

  const id = r?.id;
  if (!id || typeof id !== 'string' || !id.startsWith('BC_')) return '';
  const pk = getBroadcastPkId(id);
  const nm = pk != null ? (broadcastNameMap.value[pk] || '') : '';
  if (!nm) return '';
  const isReminder = /\bRecipients\b/i.test(nm);
  return isReminder ? 'Reminder' : 'Feedback';
};

const loadTutorDeviceMap = async () => {
  try {
    const { data } = await userApi.get('/tutors');
    const map = {};
    const list = Array.isArray(data) ? data : [];
    for (const t of list) {
      const name = [t?.firstName, t?.lastName].filter(Boolean).join(' ') || t?.email || 'Tutor';
      const devices = Array.isArray(t?.devices) ? t.devices : [];
      for (const d of devices) {
        if (d && d.id) map[d.id] = name;
      }
    }
    deviceTutorMap.value = map;
  } catch (_) {
    // ignore
  }
};

const loadSessionTutorMap = async () => {
  try {
    const { data } = await userApi.get('/tutors');
    const list = Array.isArray(data) ? data : [];
    const entries = [];
    for (const t of list) {
      const name = [t?.firstName, t?.lastName].filter(Boolean).join(' ') || t?.email || 'Tutor';
      const devices = Array.isArray(t?.devices) ? t.devices : [];
      for (const d of devices) {
        if (d && d.id) {
          entries.push({ deviceId: d.id, name });
        }
      }
    }
    const results = await Promise.allSettled(entries.map((e) => userApi.get(`/devices/${encodeURIComponent(e.deviceId)}`)));
    const map = {};
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        const tutorName = entries[idx].name;
        const sessions = Array.isArray(res.value?.data?.sessions) ? res.value.data.sessions : [];
        sessions.forEach((s) => {
          if (s && s.sessionId) map[s.sessionId] = tutorName;
        });
      }
    });
    sessionTutorMap.value = map;
  } catch (_) {
    // ignore
  } finally {
    tutorMapLoaded.value = true;
  }
};

const load = async (p = page.value) => {
  loading.value = true;
  err.value = '';
  try {
    page.value = p;
    const params = { page: page.value, pageSize: pageSize.value, sortBy: sortBy.value, sortDir: sortDir.value };
    if (phoneNumber.value) params.phoneNumber = phoneNumber.value;
    if (messageQuery.value) params.message = messageQuery.value;
    const { data } = await userApi.get('/tutors/messages/all', { params });
    rows.value = data.data || [];
    meta.value = data.metadata || meta.value;
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal memuat data';
  } finally {
    loading.value = false;
  }
};

const fbNameMap = ref({});
const fbNameMapNorm = ref({});
const normalizeCourseKey = (s) => String(s || '').trim().toLowerCase();
const loadFbNameMap = () => {
  try {
    const raw = localStorage.getItem('feedback_broadcast_names');
    const map = raw ? JSON.parse(raw) : {};
    fbNameMap.value = map;
    const norm = {};
    Object.keys(map).forEach((k) => { norm[normalizeCourseKey(k)] = map[k]; });
    fbNameMapNorm.value = norm;
  } catch {
    fbNameMap.value = {};
    fbNameMapNorm.value = {};
  }
};

const getBroadcastName = (r) => {
  if (typeof r?.broadcastName === 'string' && r.broadcastName) return r.broadcastName;
  const id = r?.id;
  if (!id || typeof id !== 'string' || !id.startsWith('BC_')) return '';
  const pk = getBroadcastPkId(id);
  return pk != null ? (broadcastNameMap.value[pk] || '') : '';
};

const isReminderName = (name) => /\b(Recipients|Reminder)\b/i.test(String(name || ''));
const isFeedbackName = (name) => {
  if (!name) return false;
  const key = normalizeCourseKey(name);
  return !!fbNameMapNorm.value[key];
};

const sourceSimple = (r) => {
  if (!isBroadcast(r)) return '';
  const t = (r && r.broadcastType) ? String(r.broadcastType).toLowerCase() : '';
  const name = getBroadcastName(r);
  if (t === 'reminder' || isReminderName(name)) return 'reminder';
  if (t === 'feedback' || isFeedbackName(name)) return 'feedback';
  return 'broadcast';
};

watch([sortBy, sortDir, pageSize], () => {
  page.value = 1;
  load(1);
});

onMounted(async () => {
  await Promise.allSettled([loadTutorDeviceMap(), loadSessionTutorMap(), loadBroadcasts(), loadFbNameMap(), load(1)]);
});
</script>

<style scoped>
.wrapper { max-width: 980px; }
.toolbar { display: flex; gap: 8px; margin: 8px 0 16px; }
.toolbar input { padding: 8px; border: 1px solid #ddd; border-radius: 6px; }
.toolbar select { padding: 8px; border: 1px solid #ddd; border-radius: 6px; }
.table-wrap { overflow: auto; border: 1px solid #eee; border-radius: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px; border-bottom: 1px solid #f0f0f0; text-align: left; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.ok { background: #e7f8ec; color: #1a7f37; }
.badge.info { background: #eaf2ff; color: #1d4ed8; }
.badge.warn { background: #fff4e5; color: #8a4b0f; }
.badge.bc { background: #eef2f7; color: #334155; }
.badge.fb { background: #e7f8ec; color: #1a7f37; }
.badge.rm { background: #fff4e5; color: #8a4b0f; }
.pager { margin-top: 10px; display: flex; gap: 8px; align-items: center; }
.empty { text-align: center; color: #777; padding: 24px; }
.error { color: #c00; margin-top: 8px; }
.cell-msg { max-width: 480px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>