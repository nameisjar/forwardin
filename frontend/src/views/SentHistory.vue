<template>
  <div>
    <h2>Riwayat Pesan Terkirim</h2>

    <section class="filters">
      <input v-model="phoneNumber" placeholder="Filter nomor (628xx)" />
      <input v-model="contactName" placeholder="Nama kontak" />
      <input v-model="messageQuery" placeholder="Cari pesan" />
      <button @click="load(1)">Muat</button>
      <button @click="downloadExport" :disabled="!phoneNumber">Export ZIP (butuh phone)</button>
    </section>

    <section class="list">
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
            <td>{{ new Date(r.createdAt).toLocaleString() }}</td>
            <td>{{ (r.to || '').replace('@s.whatsapp.net','') }}</td>
            <td>{{ r.contact ? (r.contact.firstName + ' ' + (r.contact.lastName||'')) : '-' }}</td>
            <td>{{ r.message }}</td>
            <td>{{ r.status }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else>Belum ada data.</p>

      <div class="pager" v-if="meta.totalPages > 1">
        <button :disabled="page<=1" @click="load(page-1)">Prev</button>
        <span>Halaman {{ page }} / {{ meta.totalPages }}</span>
        <button :disabled="!meta.hasMore" @click="load(page+1)">Next</button>
      </div>
    </section>
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
.filters { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
input { padding: 8px; }
.pager { margin-top: 8px; display: flex; gap: 8px; align-items: center; }
 table { width: 100%; border-collapse: collapse; }
 th, td { border: 1px solid #eee; padding: 6px; text-align: left; }
</style>