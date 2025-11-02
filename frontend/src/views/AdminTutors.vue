<template>
  <div>
    <h2>Kelola Tutor</h2>

    <section class="create">
      <h3>Tambah Tutor</h3>
      <form @submit.prevent="createTutor">
        <input v-model.trim="firstName" placeholder="First name" required />
        <input v-model.trim="email" type="email" placeholder="Email" required />
        <input v-model="password" type="password" placeholder="Password" />
        <button :disabled="loading || !canSubmit">{{ loading ? 'Menyimpan...' : 'Tambah' }}</button>
      </form>
      <small class="hint">Isi nama depan, email, dan password yang valid</small>
      <p v-if="msg" class="success">{{ msg }}</p>
      <p v-if="err" class="error">{{ err }}</p>
    </section>

    <section class="list">
      <h3>Daftar Tutor</h3>
      <button @click="loadTutors">Muat Ulang</button>
      <table v-if="rows.length">
        <thead>
          <tr>
            <th>Nama</th>
            <th>Email</th>
            <th>Devices</th>
            <th>Dibuat</th>
            <th style="width:140px;">Aksi</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in rows" :key="u.id">
            <td>{{ u.firstName }} {{ u.lastName || '' }}</td>
            <td>{{ u.email }}</td>
            <td>
              <ul>
                <li v-for="d in (u.devices || [])" :key="d.id">{{ d.name }} — {{ d.status }}</li>
              </ul>
            </td>
            <td>{{ new Date(u.createdAt).toLocaleString() }}</td>
            <td>
              <button class="btn-danger" @click="deleteTutor(u)" :disabled="deletingId === u.id">
                {{ deletingId === u.id ? 'Menghapus...' : 'Hapus Akun' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else>Belum ada tutor.</p>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { userApi } from '../api/http.js';

const rows = ref([]);
const firstName = ref('');
const email = ref('');
const password = ref('');
const loading = ref(false);
const deletingId = ref('');
const msg = ref('');
const err = ref('');

const emailRe = /^(?:[a-zA-Z0-9_!#$%&'*+/=?`{|}~^.-]+)@(?:[a-zA-Z0-9.-]+)$/;
const canSubmit = computed(() => {
  const fn = (firstName.value || '').trim();
  const em = (email.value || '').trim();
  return fn.length > 0 && em.length > 3 && emailRe.test(em);
});

watch([firstName, email, password], () => { msg.value = ''; err.value = ''; });

const loadTutors = async () => {
  err.value = '';
  try {
    const { data } = await userApi.get('/tutors');
    rows.value = Array.isArray(data) ? data : [];
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal memuat daftar tutor';
  }
};

const createTutor = async () => {
  msg.value = '';
  err.value = '';
  const body = { firstName: (firstName.value || '').trim(), email: (email.value || '').trim().toLowerCase() };
  if (!canSubmit.value) {
    err.value = 'Nama dan email harus diisi dengan benar';
    return;
  }
  if (password.value) body.password = password.value;

  loading.value = true;
  try {
    const { data } = await userApi.post('/tutors', body);
    const pwd = data?.password ? ` Password: ${data.password}` : '';
    msg.value = `Tutor dibuat.${pwd}`;
    firstName.value = '';
    email.value = '';
    password.value = '';
    await loadTutors();
  } catch (e) {
    const status = e?.response?.status;
    if (status === 409) err.value = 'Email sudah terdaftar';
    else err.value = (e && e.response && e.response.data && e.response.data.message) || 'Gagal menambah tutor';
  } finally {
    loading.value = false;
  }
};

const deleteTutor = async (u) => {
  if (!u?.id) return;
  if (!window.confirm(`Hapus akun tutor ${u.firstName}? Tindakan ini tidak dapat dibatalkan.`)) return;
  msg.value = '';
  err.value = '';
  deletingId.value = u.id;
  try {
    await userApi.delete(`/users/${encodeURIComponent(u.id)}/delete`);
    msg.value = 'Akun tutor berhasil dihapus';
    await loadTutors();
  } catch (e) {
    err.value = (e && e.response && e.response.data && e.response.data.message) || 'Gagal menghapus akun tutor';
  } finally {
    deletingId.value = '';
  }
};

onMounted(loadTutors);
</script>

<style scoped>
.create, .list { margin-top: 16px; }
input { padding: 8px; margin-right: 6px; }
.hint { display:block; color:#666; margin-top: 6px; }
.success { color:#070 }
.error { color:#c00 }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 th, td { border: 1px solid #eee; padding: 8px; text-align: left; vertical-align: top; }
.btn-danger { padding: 6px 10px; border: 1px solid #c33; background: #e74c3c; color: #fff; border-radius: 6px; cursor: pointer; }
.btn-danger:disabled { opacity: .7; cursor: default; }
</style>