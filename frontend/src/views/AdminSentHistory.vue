<template>
  <div class="wrapper">
    <h2>Semua Pesan Terkirim (Admin)</h2>

    <div class="toolbar card">
      <div class="filters">
        <div class="field">
          <label>Nomor</label>
          <input v-model="phoneNumber" placeholder="Filter nomor (628xx)" />
        </div>
        <div class="field">
          <label>Tutor</label>
          <input v-model="tutorQuery" placeholder="Tutor" />
        </div>
        <div class="field grow">
          <label>Cari Pesan</label>
          <input v-model="messageQuery" placeholder="Cari pesan" />
        </div>
        <div class="field">
          <label>Urut</label>
          <select v-model="sortBy">
            <option value="createdAt">Terbaru</option>
            <option value="to">Nomor</option>
            <option value="message">Pesan</option>
            <option value="status">Status</option>
          </select>
        </div>
        <div class="field compact">
          <label>Arah</label>
          <select v-model="sortDir">
            <option value="desc">↓</option>
            <option value="asc">↑</option>
          </select>
        </div>
        <div class="field">
          <label>Tampil</label>
          <select v-model.number="pageSize">
            <option :value="10">10</option>
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </div>
        <div class="field">
          <label>&nbsp;</label>
          <button class="btn primary w-100" @click="load(1)" :disabled="loading">{{ loading ? 'Memuat...' : 'Muat' }}</button>
        </div>
      </div>
      <div class="actions">
        <button class="btn outline" @click="exportCsv" :disabled="loading || exporting">{{ exporting ? 'Mengekspor...' : 'Export CSV' }}</button>
        <button class="btn danger" @click="deleteAllSent" :disabled="loading || deleting">{{ deleting ? 'Menghapus...' : 'Hapus Semua' }}</button>
      </div>
    </div>

    <div class="table-wrap card">
      <table v-if="displayedRows.length">
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Nomor</th>
            <th>Kontak</th>
            <th>Pesan</th>
            <th>Media</th>
            <th>Status</th>
            <th>Sumber</th>
            <th>Tutor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in displayedRows" :key="r.id">
            <td class="muted">{{ fmt(r.createdAt) }}</td>
            <td class="mono">{{ normalizeNumber(r.to) }}</td>
            <td>{{ r.contact ? (r.contact.firstName + ' ' + (r.contact.lastName||'')) : '-' }}</td>
            <td class="cell-msg">{{ r.message }}</td>
            <td class="cell-media">
              <template v-if="r.mediaPath">
                <a :href="mediaUrl(r.mediaPath)" target="_blank" rel="noopener" class="m-link">Lihat</a>
                <img
                  v-if="isImagePath(r.mediaPath)"
                  :src="mediaUrl(r.mediaPath)"
                  alt="media"
                  class="m-thumb"
                />
              </template>
              <span v-else class="muted">-</span>
            </td>
            <td>
              <span class="badge" :class="badgeClass(r.status)">{{ r.status }}</span>
            </td>
            <td>
              <span v-if="sourceSimple(r) === 'reminder'" class="chip rm">Reminder</span>
              <span v-else-if="sourceSimple(r) === 'feedback'" class="chip fb">Feedback</span>
              <span v-else-if="sourceSimple(r) === 'broadcast'" class="chip bc">Broadcast</span>
              <span v-else class="muted">-</span>
            </td>
            <td>{{ tutorName(r) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">Belum ada data.</div>
    </div>

    <div class="pager" v-if="meta.totalPages > 1">
      <button class="btn" :disabled="page<=1 || loading" @click="load(page-1)">Prev</button>
      <span>Halaman {{ page }} / {{ meta.totalPages }}</span>
      <button class="btn" :disabled="!meta.hasMore || loading" @click="load(page+1)">Next</button>
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

const exporting = ref(false);
const deleting = ref(false);

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

const exportCsv = async () => {
  try {
    exporting.value = true;
    const params = {
      export: 'csv',
      sortBy: sortBy.value,
      sortDir: sortDir.value,
    };
    if (phoneNumber.value) params.phoneNumber = phoneNumber.value;
    if (messageQuery.value) params.message = messageQuery.value;
    const resp = await userApi.get('/tutors/messages/all', { params, responseType: 'blob' });
    const blob = new Blob([resp.data], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sent-messages.csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal mengekspor CSV';
  } finally {
    exporting.value = false;
  }
};

const deleteAllSent = async () => {
  try {
    if (!window.confirm('Hapus SEMUA status pesan terkirim pada tampilan ini? Tindakan ini permanen.')) return;
    deleting.value = true;

    // 1) Hapus semua status di outgoingMessage
    const msgParams = { status: 'all' };
    if (phoneNumber.value) msgParams.phoneNumber = phoneNumber.value;
    await userApi.delete('/tutors/messages/all', { params: msgParams });

    // 2) Sinkron: hapus broadcast yang sudah terkirim (cascade akan bersih-kan BC_*)
    await userApi.delete('/broadcasts/bulk', { params: { isSent: true } });

    await load(1);
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal menghapus pesan';
  } finally {
    deleting.value = false;
  }
};

const mediaUrl = (p) => p ? (p.startsWith('/') ? p : `/${p}`) : '';
const isImagePath = (p) => /\.(png|jpe?g|webp|gif)$/i.test(p || '');

watch([sortBy, sortDir, pageSize], () => {
  page.value = 1;
  load(1);
});

onMounted(async () => {
  await Promise.allSettled([loadTutorDeviceMap(), loadSessionTutorMap(), loadBroadcasts(), loadFbNameMap(), load(1)]);
});
</script>

<style scoped>
.wrapper {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 16px;
}

h2 { margin-bottom: 12px; }

.card {
  background: #fff;
  border: 1px solid #eaeaea;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(16,24,40,0.04);
}

.toolbar {
  padding: 14px;
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar .filters {
  display: grid;
  grid-template-columns: repeat(6, minmax(120px, 1fr));
  gap: 10px;
  flex: 1 1 680px;
}

.field { display: flex; flex-direction: column; gap: 6px; }
.field.grow { min-width: 200px; grid-column: span 2; }
.field label { font-size: 12px; color: #667085; }
.field input, .field select { height: 36px; padding: 6px 10px; border: 1px solid #d8dde6; border-radius: 8px; background: #fff; }
.field.compact select { width: 80px; }
.w-100 { width: 100%; }

.toolbar .actions { display: flex; gap: 8px; align-items: flex-end; }

.btn {
  height: 36px;
  padding: 0 12px;
  border: 1px solid #d0d5dd;
  background: #f9fafb;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
}
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn.outline { background: #fff; }
.btn.danger { background: #e74c3c; border-color: #e74c3c; color: #fff; }

.table-wrap { overflow: auto; margin-top: 12px; }

table { width: 100%; border-collapse: collapse; font-size: 14px; }
thead th { position: sticky; top: 0; background: #f8fafc; z-index: 1; }
th, td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; text-align: left; vertical-align: top; }
tbody tr:nth-child(odd) { background: #fcfcfc; }
tbody tr:hover { background: #f6faff; }

.muted { color: #667085; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

.badge { padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; }
.badge.ok { background: #e7f8ec; color: #067647; }
.badge.info { background: #eaf2ff; color: #1d4ed8; }
.badge.warn { background: #fff1f0; color: #d92d20; }

.chip { padding: 2px 6px; border-radius: 999px; font-size: 12px; border: 1px solid #e2e8f0; background: #fff; color: #475569; }
.chip.bc { color: #334155; }
.chip.fb { color: #0f5132; border-color: #c7eed8; background: #e7f8ec; }
.chip.rm { color: #8a4b0f; border-color: #ffe0b2; background: #fff7ed; }

.pager { margin-top: 12px; display: flex; gap: 8px; align-items: center; justify-content: center; }
.empty { text-align: center; color: #777; padding: 28px; }
.error { color: #c00; margin-top: 8px; }
.cell-msg { max-width: 480px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-media { max-width: 140px; }
.m-link { font-size: 12px; margin-right:4px; display:inline-block; }
.m-thumb { max-height:42px; max-width:70px; border:1px solid #ddd; border-radius:4px; margin-top:4px; }

@media (max-width: 1100px) {
  .toolbar .filters { grid-template-columns: repeat(4, minmax(120px, 1fr)); }
}
@media (max-width: 720px) {
  .toolbar { align-items: stretch; }
  .toolbar .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field.grow { grid-column: span 2; }
  .cell-msg { max-width: 260px; }
}
</style>