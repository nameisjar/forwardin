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

    <section class="list">
      <h3>Daftar Device</h3>
      <button @click="fetchDevices">Muat Ulang</button>
      <button
        v-if="devices.length"
        @click="deleteSelected"
        :disabled="deleting || selectedIds.length === 0"
      >
        {{ deleting ? 'Menghapus...' : `Hapus Terpilih (${selectedIds.length})` }}
      </button>
      <table v-if="devices.length">
        <thead>
          <tr>
            <th style="width:32px; text-align:center;">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" />
            </th>
            <th>Nama</th>
            <th>ID</th>
            <th>Status</th>
            <th style="width:120px;">Aksi</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in devices" :key="d.id">
            <td style="text-align:center;">
              <input type="checkbox" :checked="isSelected(d.id)" @change="toggleOne(d.id)" />
            </td>
            <td>{{ d.name }}</td>
            <td>{{ d.id }}</td>
            <td>{{ d.status }}</td>
            <td>
              <button @click="deleteOne(d)" :disabled="deleting">Hapus</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>Belum ada device.</p>
      <p class="hint">Setelah device dibuat, buka halaman Pairing (QR) untuk scan QR WhatsApp.</p>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue';
import { userApi } from '../api/http.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
const devices = ref([]);
const name = ref('');
const loading = ref(false);
const deleting = ref(false);
const error = ref('');
const success = ref('');

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

onMounted(async () => {
  if (!auth.me) {
    try { await auth.fetchMe(); } catch (_) {}
  }
  await fetchDevices();
});
</script>

<style scoped>
.create, .list { margin-top: 16px; }
label { display: block; margin: 8px 0; }
input { padding: 8px; width: 320px; }
button { margin-right: 8px; }
.error { color: #c00; }
.success { color: #0a0; }
.info { color:#555; background:#f9f9f9; border:1px solid #eee; padding:8px; border-radius:6px; margin-bottom:8px; }
.hint { color:#666; margin-top:8px; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { border: 1px solid #eee; padding: 8px; text-align: left; }
</style>