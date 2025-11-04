<template>
  <div class="wrapper">
    <h2>Riwayat Pesan Terkirim</h2>

    <div class="toolbar card">
      <div class="filters">
        <div class="field">
          <label>Nomor</label>
          <input v-model="phoneNumber" placeholder="Filter nomor (628xx)" />
        </div>
        <div class="field">
          <label>Kontak</label>
          <input v-model="contactName" placeholder="Nama kontak" />
        </div>
        <div class="field grow">
          <label>Cari Pesan</label>
          <input v-model="messageQuery" placeholder="Cari pesan" />
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
          <button class="btn primary w-100" @click="load(1)">Muat</button>
        </div>
      </div>
      <div class="actions">
        <button class="btn outline" @click="downloadExport" :disabled="!phoneNumber">Export ZIP</button>
      </div>
    </div>

    <div class="table-wrap card">
      <table v-if="rows.length">
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Nomor</th>
            <th>Kontak</th>
            <th>Pesan</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="muted">{{ new Date(r.createdAt).toLocaleString() }}</td>
            <td class="mono">{{ (r.to || '').replace('@s.whatsapp.net','') }}</td>
            <td>{{ r.contact ? (r.contact.firstName + ' ' + (r.contact.lastName||'')) : '-' }}</td>
            <td class="cell-msg">{{ r.message }}</td>
            <td><span class="badge">{{ r.status }}</span></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">Belum ada data.</div>
    </div>

    <div class="pager" v-if="meta.totalPages > 1">
      <button class="btn" :disabled="page<=1" @click="load(page-1)">Prev</button>
      <span>Halaman {{ page }} / {{ meta.totalPages }}</span>
      <button class="btn" :disabled="!meta.hasMore" @click="load(page+1)">Next</button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { deviceApi } from '../api/http.js';

const rows = ref([]);
const meta = ref({ totalMessages: 0, currentPage: 1, totalPages: 1, hasMore: false });
const page = ref(1);
const pageSize = ref(25);
const phoneNumber = ref('');
const contactName = ref('');
const messageQuery = ref('');

const load = async (p = page.value) => {
  page.value = p;
  const params = { page: page.value, pageSize: pageSize.value };
  if (phoneNumber.value) params.phoneNumber = phoneNumber.value;
  if (contactName.value) params.contactName = contactName.value;
  if (messageQuery.value) params.message = messageQuery.value;
  const { data } = await deviceApi.get('/messages/outgoing', { params });
  rows.value = data.data || [];
  meta.value = data.metadata || meta.value;
};

const downloadExport = async () => {
  try {
    const params = { phoneNumber: phoneNumber.value };
    const res = await deviceApi.get('/messages/export-zip', { params, responseType: 'blob' });
    const blob = new Blob([res.data], { type: 'application/zip' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${phoneNumber.value}.zip`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    alert((e && e.response && e.response.data && e.response.data.message) || 'Gagal export');
  }
};

load(1);
</script>

<style scoped>
.wrapper { max-width: 1200px; margin: 0 auto; padding: 0 16px; }

h2 { margin-bottom: 12px; }

.card { background: #fff; border: 1px solid #eaeaea; border-radius: 12px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); }

.toolbar { padding: 14px; display: flex; justify-content: space-between; align-items: stretch; gap: 12px; flex-wrap: wrap; }
.toolbar .filters { display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 10px; flex: 1 1 680px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field.grow { min-width: 200px; grid-column: span 2; }
.field label { font-size: 12px; color: #667085; }
.field input, .field select { height: 36px; padding: 6px 10px; border: 1px solid #d8dde6; border-radius: 8px; background: #fff; }
.w-100 { width: 100%; }
.toolbar .actions { display: flex; gap: 8px; align-items: flex-end; }

.btn { height: 36px; padding: 0 12px; border: 1px solid #d0d5dd; background: #f9fafb; border-radius: 8px; cursor: pointer; font-weight: 500; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn.outline { background: #fff; }

.table-wrap { overflow: auto; margin-top: 12px; }

table { width: 100%; border-collapse: collapse; font-size: 14px; }
thead th { position: sticky; top: 0; background: #f8fafc; z-index: 1; }
th, td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; text-align: left; vertical-align: top; }
tbody tr:nth-child(odd) { background: #fcfcfc; }
tbody tr:hover { background: #f6faff; }

.muted { color: #667085; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }

.badge { padding: 2px 8px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #eef2ff; color: #3730a3; }

.pager { margin-top: 12px; display: flex; gap: 8px; align-items: center; justify-content: center; }
.empty { text-align: center; color: #777; padding: 28px; }
.cell-msg { max-width: 480px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

@media (max-width: 1100px) { .toolbar .filters { grid-template-columns: repeat(4, minmax(120px, 1fr)); } }
@media (max-width: 720px) {
  .toolbar { align-items: stretch; }
  .toolbar .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field.grow { grid-column: span 2; }
  .cell-msg { max-width: 260px; }
}
</style>