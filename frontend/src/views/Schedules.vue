<template>
  <div class="wrapper">
    <h2>Jadwal Saya (Feedback & Reminder)</h2>

    <div class="toolbar">
      <input v-model="q" placeholder="Cari nama..." />
      <select v-model="statusFilter">
        <option value="all">Semua</option>
        <option value="upcoming">Proses Dikirim</option>
        <option value="sent">Sudah Dikirim</option>
        <option value="inactive">Nonaktif</option>
      </select>
      <select v-model="selectedDeviceId" @change="onDeviceChange">
        <option value="">Pilih Perangkat</option>
        <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name || d.id }} — {{ d.status }}</option>
      </select>
      <select v-model="sortBy" title="Urutkan berdasarkan">
        <option value="schedule">Jadwal Terdekat</option>
        <option value="name">Nama</option>
      </select>
      <select v-model="sortDir" title="Arah urutan">
        <option value="asc">↑</option>
        <option value="desc">↓</option>
      </select>
      <select v-model.number="pageSize" title="Jumlah baris per halaman">
        <option :value="10">10</option>
        <option :value="25">25</option>
        <option :value="50">50</option>
      </select>
      <button @click="load" :disabled="loading">{{ loading ? 'Memuat...' : 'Muat Ulang' }}</button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nama</th>
            <th>Jadwal</th>
            <th>Status</th>
            <th>Penerima</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in visibleGroups" :key="g.name">
            <td>
              <div class="name">{{ displayName(g) }}</div>
              <small class="dim">Total: {{ g.broadcasts.length }} jadwal</small>
            </td>
            <td>
              <select v-model="selections[g.name]">
                <option v-for="b in g.broadcasts" :key="b.id" :value="b.id">
                  {{ fmtWithDay(b.schedule) }} — {{ statusShort(b) }}
                </option>
              </select>
            </td>
            <td>
              <span class="badge" :class="badgeClass(selectedOf(g))">{{ badgeText(selectedOf(g)) }}</span>
              <button
                class="btn-small danger"
                v-if="canDelete(selectedOf(g))"
                @click="confirmDelete(g.name)"
              >Hapus</button>
            </td>
            <td>
              <div class="chips">
                <span v-for="lbl in groupRecipientLabels(selectedOf(g))" :key="'g-'+lbl" class="chip">{{ lbl }}</span>
                <span v-for="lbl in labelRecipientLabels(selectedOf(g))" :key="'l-'+lbl" class="chip chip-label">Label: {{ lbl }}</span>
                <span v-for="num in phoneRecipients(selectedOf(g))" :key="'p-'+num" class="chip chip-num">{{ normalizeNumber(num) }}</span>
              </div>
            </td>
          </tr>
          <tr v-if="!loading && visibleGroups.length === 0">
            <td colspan="4" class="empty">Tidak ada data</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pager" v-if="meta.totalPages > 1">
      <button :disabled="page<=1 || loading" @click="goPrev">Prev</button>
      <span>Halaman {{ page }} / {{ meta.totalPages }}</span>
      <button :disabled="!meta.hasMore || loading" @click="goNext">Next</button>
    </div>

    <p v-if="msg" class="success">{{ msg }}</p>
    <p v-if="err" class="error">{{ err }}</p>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { deviceApi, userApi } from '../api/http.js';

const items = ref([]);
const loading = ref(false);
const err = ref('');
const msg = ref('');
const q = ref('');
const statusFilter = ref('all');

const groupsMap = ref({});
const loadGroupNames = async () => {
  try {
    let res;
    try { res = await deviceApi.get('/messages/get-groups/detail'); }
    catch { res = await deviceApi.get('/messages/get-groups'); }
    const raw = Array.isArray(res.data) ? res.data : (res.data?.results || res.data?.data || []);
    const map = {};
    for (const g of raw) {
      const id = (g.id || g.jid || '').toString();
      const full = id.includes('@') ? id : `${id}@g.us`;
      const name = g.subject || g.name || g.title || g.id || 'Tanpa Nama';
      map[full] = name;
    }
    groupsMap.value = map;
  } catch (_) { /* ignore */ }
};

const contacts = ref([]);
const loadingContacts = ref(false);
const loadContacts = async () => {
  try {
    loadingContacts.value = true;
    const deviceId = localStorage.getItem('device_selected_id') || '';
    const { data } = await userApi.get('/contacts', { params: deviceId ? { deviceId } : {} });
    contacts.value = Array.isArray(data) ? data : [];
  } catch (_) {
    contacts.value = [];
  } finally {
    loadingContacts.value = false;
  }
};

const labelToPhones = computed(() => {
  const map = {};
  for (const c of contacts.value || []) {
    const phone = String(c.phone || '').trim();
    if (!phone) continue;
    const cLabels = Array.isArray(c.ContactLabel) ? c.ContactLabel : [];
    for (const cl of cLabels) {
      const name = cl?.label?.name;
      if (!name || String(name).startsWith('device_')) continue;
      if (!map[name]) map[name] = new Set();
      map[name].add(phone);
    }
  }
  return map;
});

const selections = ref({});
const pickDefault = (arr) => {
  const upcoming = arr.find((b) => !b.isSent && b.status !== false && new Date(b.schedule).getTime() > Date.now());
  return upcoming?.id || arr[arr.length - 1]?.id;
};

const grouped = computed(() => {
  const byName = {};
  for (const b of items.value) {
    const n = b.name || '(Tanpa Nama)';
    (byName[n] ||= []).push(b);
  }
  const groups = Object.keys(byName).map((name) => {
    const arr = byName[name].slice().sort((a, b) => new Date(a.schedule) - new Date(b.schedule));
    if (!selections.value[name]) selections.value[name] = pickDefault(arr);
    return { name, broadcasts: arr };
  });
  const qq = q.value.toLowerCase();
  const filteredByName = groups.filter((g) => g.name.toLowerCase().includes(qq));
  return filteredByName;
});

const selectedOf = (g) => g.broadcasts.find((b) => b.id === selections.value[g.name]) || g.broadcasts[g.broadcasts.length - 1];

const statusShort = (b) => {
  if (!b) return '';
  if (b.status === false) return 'Nonaktif';
  if (b.isSent) return 'Terkirim';
  const due = new Date(b.schedule).getTime();
  return due > Date.now() ? 'Terjadwal' : 'Tertunda';
};

const matchesStatus = (g) => {
  const b = selectedOf(g);
  if (!b) return false;
  if (statusFilter.value === 'all') return true;
  if (statusFilter.value === 'inactive') return b.status === false;
  const isSent = !!b.isSent;
  const sched = new Date(b.schedule).getTime();
  if (statusFilter.value === 'sent') return isSent;
  if (statusFilter.value === 'upcoming') return !isSent && b.status !== false && sched > Date.now();
  return true;
};

const filtered = computed(() => grouped.value.filter(matchesStatus));

const fmt = (d) => {
  try {
    const dd = new Date(d);
    if (isNaN(dd.getTime())) return '-';
    return dd.toLocaleString();
  } catch {
    return '-';
  }
};

const fmtWithDay = (d) => {
  try {
    const dd = new Date(d);
    if (isNaN(dd.getTime())) return '-';
    const hari = dd.toLocaleDateString('id-ID', { weekday: 'long' });
    const tanggal = dd.toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: 'numeric' });
    const jam = dd.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return `${hari}, ${tanggal} ${jam}`;
  } catch { return '-'; }
};

const badgeClass = (b) => {
  if (b.status === false) return 'warn';
  if (b.isSent) return 'ok';
  const due = new Date(b.schedule).getTime();
  return due > Date.now() ? 'info' : 'warn';
};

const badgeText = (b) => {
  if (b.status === false) return 'Nonaktif';
  if (b.isSent) return 'Terkirim';
  const due = new Date(b.schedule).getTime();
  return due > Date.now() ? 'Terjadwal' : 'Tertunda';
};

const groupRecipientLabels = (b) => {
  if (!b) return [];
  const arr = Array.isArray(b.recipients) ? b.recipients : [];
  return arr
    .filter((r) => typeof r === 'string' && r.includes('@g.us'))
    .map((jid) => groupsMap.value[jid] || jid);
};

const labelRecipientLabels = (b) => {
  if (!b) return [];
  const arr = Array.isArray(b.recipients) ? b.recipients : [];
  return arr
    .filter((r) => typeof r === 'string' && r.toLowerCase().startsWith('label_'))
    .map((r) => String(r).slice('label_'.length));
};

const canDelete = (b) => b && !b.isSent && b.status !== false;

const confirmDelete = async (name) => {
  if (!window.confirm(`Hapus semua jadwal dengan nama "${name}"? Tindakan ini tidak dapat dibatalkan.`)) return;
  msg.value = '';
  err.value = '';
  try {
    await deviceApi.delete('/messages/broadcast-name', { data: { name } });
    msg.value = `Jadwal dengan nama "${name}" berhasil dihapus.`;
    await load();
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal menghapus jadwal';
  }
};

const load = async () => {
  loading.value = true;
  err.value = '';
  try {
    const { data } = await deviceApi.get('/messages/broadcasts');
    items.value = Array.isArray(data) ? data : [];
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal memuat jadwal';
  } finally {
    loading.value = false;
  }
};

const displayName = (g) => {
  const n = g?.name || '';
  return n || 'Tanpa Nama';
};

const phoneRecipients = (b) => {
  if (!b) return [];
  const arr = Array.isArray(b.recipients) ? b.recipients : [];
  const set = new Set(
    arr
      .map((r) => String(r))
      .filter((r) => !r.includes('@g.us'))
      .filter((r) => r.toLowerCase() !== 'all')
      .filter((r) => !r.toLowerCase().startsWith('label'))
      .filter((r) => r.trim().length > 0),
  );

  if (arr.some((r) => String(r).toLowerCase() === 'all')) {
    for (const c of contacts.value || []) {
      if (c?.phone) set.add(String(c.phone));
    }
  }

  for (const r of arr) {
    const s = String(r).toLowerCase();
    if (s.startsWith('label_')) {
      const labelName = String(r).slice('label_'.length);
      const phones = labelToPhones.value[labelName];
      if (phones) {
        for (const p of phones) set.add(String(p));
      }
    }
  }

  return Array.from(set);
};

const normalizeNumber = (num) => String(num).trim().replace(/@s\.whatsapp\.net$/i, '');

const devices = ref([]);
const selectedDeviceId = ref(localStorage.getItem('device_selected_id') || '');

const fetchDevices = async () => {
  try {
    const { data } = await userApi.get('/devices');
    devices.value = Array.isArray(data) ? data : [];
  } catch { devices.value = []; }
};

const ensureDeviceKeyValid = () => {
  const key = localStorage.getItem('device_api_key');
  const selId = localStorage.getItem('device_selected_id');
  if (!key || !selId) return false;
  const ok = devices.value.some((d) => d.id === selId && d.apiKey === key);
  if (!ok) {
    localStorage.removeItem('device_api_key');
    localStorage.removeItem('device_selected_id');
    localStorage.removeItem('device_selected_name');
    selectedDeviceId.value = '';
  }
  return ok;
};

const pickDefaultDevice = () => {
  if (!devices.value.length) return;
  const current = devices.value.find((d) => d.status === 'open') || devices.value[0];
  if (current) {
    localStorage.setItem('device_api_key', current.apiKey);
    localStorage.setItem('device_selected_id', current.id);
    localStorage.setItem('device_selected_name', current.name || '');
    selectedDeviceId.value = current.id;
  }
};

const onDeviceChange = () => {
  const dev = devices.value.find((d) => d.id === selectedDeviceId.value);
  if (dev && dev.apiKey) {
    localStorage.setItem('device_api_key', dev.apiKey);
    localStorage.setItem('device_selected_id', dev.id);
    localStorage.setItem('device_selected_name', dev.name || '');
    load();
    loadContacts();
  }
};

const page = ref(1);
const pageSize = ref(25);
const sortBy = ref('schedule');
const sortDir = ref('asc');
const meta = ref({ totalGroups: 0, currentPage: 1, totalPages: 1, hasMore: false });

const sortedGroups = computed(() => {
  const arr = filtered.value.slice();
  if (sortBy.value === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    arr.sort((a, b) => {
      const sa = new Date(selectedOf(a)?.schedule || 0).getTime();
      const sb = new Date(selectedOf(b)?.schedule || 0).getTime();
      return sa - sb;
    });
  }
  if (sortDir.value === 'desc') arr.reverse();
  return arr;
});

const visibleGroups = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  const end = start + pageSize.value;
  const total = sortedGroups.value.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize.value));
  meta.value = { totalGroups: total, currentPage: page.value, totalPages, hasMore: page.value < totalPages };
  return sortedGroups.value.slice(start, end);
});

watch([q, statusFilter, sortBy, sortDir, pageSize], () => { page.value = 1; });

const goPrev = () => { if (page.value > 1) page.value -= 1; };
const goNext = () => { if (meta.value.hasMore) page.value += 1; };

onMounted(async () => {
  await fetchDevices();
  if (!ensureDeviceKeyValid()) pickDefaultDevice();
  await Promise.allSettled([load(), loadGroupNames(), loadContacts()]);
});
</script>

<style scoped>
.wrapper { max-width: 980px; }
.toolbar { display: flex; gap: 8px; margin: 8px 0 16px; }
.toolbar input, .toolbar select { padding: 8px; border: 1px solid #ddd; border-radius: 6px; }
.table-wrap { overflow: auto; border: 1px solid #eee; border-radius: 8px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px; border-bottom: 1px solid #f0f0f0; text-align: left; }
.name { font-weight: 600; }
.dim { color: #777; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 12px; }
.badge.ok { background: #e7f8ec; color: #1a7f37; }
.badge.info { background: #eaf2ff; color: #1d4ed8; }
.badge.warn { background: #fff4e5; color: #8a4b0f; }
.empty { text-align: center; color: #777; }
.error { color: #c00; margin-top: 8px; }
.success { color: #0a0; margin-top: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.chip { background: #eef6ff; color: #0a4; border: 1px solid #bfe; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
.more { color: #555; font-size: 12px; }
.btn-small { margin-left: 8px; padding: 4px 8px; border-radius: 6px; border: 1px solid #c33; background: #e74c3c; color: #fff; cursor: pointer; font-size: 12px; }
.btn-small.danger { border-color: #c33; background: #e74c3c; }
.chip-num { background: #f7fff2; border-color: #cfe9bf; color: #2f7a1f; }
.chip-label { background: #fff7f0; border-color: #ffd8b5; color: #8a4b0f; }
.pager { display:flex; gap:8px; align-items:center; margin-top:12px; }
</style>
