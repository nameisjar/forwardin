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
      <div class="tools">
        <input v-model.trim="search" placeholder="Cari nama/email..." @input="onSearchInput" />
        <select v-model.number="pageSize" @change="onPageSizeChange">
          <option :value="10">10</option>
          <option :value="25">25</option>
          <option :value="50">50</option>
          <option :value="100">100</option>
        </select>
        <div class="spacer"></div>
        <button @click="loadTutors">Muat Ulang</button>
      </div>
      <table v-if="rows.length">
        <thead>
          <tr>
            <th @click="setSort('firstName')" class="sortable">
              Nama
              <SortIcon :active="sortBy === 'firstName'" :dir="sortDir" />
            </th>
            <th @click="setSort('email')" class="sortable">
              Email
              <SortIcon :active="sortBy === 'email'" :dir="sortDir" />
            </th>
            <th>Devices</th>
            <th @click="setSort('createdAt')" class="sortable">
              Dibuat
              <SortIcon :active="sortBy === 'createdAt'" :dir="sortDir" />
            </th>
            <th style="width:220px;">Aksi</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in rows" :key="u.id">
            <template v-if="editingId === u.id">
              <td>
                <input v-model.trim="ed.firstName" placeholder="First name" style="width:120px" />
                <input v-model.trim="ed.lastName" placeholder="Last name" style="width:120px; margin-left:6px" />
              </td>
              <td>
                <input v-model.trim="ed.email" type="email" placeholder="Email" style="width:220px" />
              </td>
              <td>
                <input v-model="ed.password" type="password" placeholder="Password baru" style="width:180px" />
              </td>
              <td>{{ new Date(u.createdAt).toLocaleString() }}</td>
              <td>
                <button class="btn" @click="saveEdit(u)" :disabled="savingEdit">{{ savingEdit ? 'Menyimpan...' : 'Simpan' }}</button>
                <button class="btn" @click="cancelEdit" :disabled="savingEdit">Batal</button>
              </td>
            </template>
            <template v-else>
              <td>{{ u.firstName }} {{ u.lastName || '' }}</td>
              <td>{{ u.email }}</td>
              <td>
                <ul>
                  <li v-for="d in (u.devices || [])" :key="d.id">{{ d.name }} — {{ d.status }}</li>
                </ul>
              </td>
              <td>{{ new Date(u.createdAt).toLocaleString() }}</td>
              <td>
                <button class="btn" @click="startEdit(u)">Edit</button>
                <button class="btn-danger" @click="deleteTutor(u)" :disabled="deletingId === u.id">
                  {{ deletingId === u.id ? 'Menghapus...' : 'Hapus Akun' }}
                </button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
      <p v-else>Belum ada tutor.</p>

      <div v-if="total > 0" class="pagination">
        <div>Menampilkan {{ startItem }}-{{ endItem }} dari {{ total }}</div>
        <div class="pager">
          <button :disabled="page <= 1" @click="goToPage(page - 1)">Sebelumnya</button>
          <span>Halaman {{ page }} / {{ totalPages }}</span>
          <button :disabled="page >= totalPages" @click="goToPage(page + 1)">Berikutnya</button>
        </div>
      </div>
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

// list state
const search = ref('');
const page = ref(1);
const pageSize = ref(10);
const sortBy = ref('createdAt');
const sortDir = ref('desc'); // 'asc' | 'desc'
const total = ref(0);
const totalPages = computed(() => (total.value && pageSize.value ? Math.max(1, Math.ceil(total.value / pageSize.value)) : 1));
const startItem = computed(() => (rows.value.length ? (page.value - 1) * pageSize.value + 1 : 0));
const endItem = computed(() => (rows.value.length ? (page.value - 1) * pageSize.value + rows.value.length : 0));

const emailRe = /^(?:[a-zA-Z0-9_!#$%&'*+/=?`{|}~^.-]+)@(?:[a-zA-Z0-9.-]+)$/;
const canSubmit = computed(() => {
  const fn = (firstName.value || '').trim();
  const em = (email.value || '').trim();
  return fn.length > 0 && em.length > 3 && emailRe.test(em);
});

watch([firstName, email, password], () => { msg.value = ''; err.value = ''; });

let searchTmr = null;
const onSearchInput = () => {
  page.value = 1;
  if (searchTmr) clearTimeout(searchTmr);
  searchTmr = setTimeout(() => {
    loadTutors();
  }, 350);
};

const setSort = (col) => {
  if (sortBy.value === col) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy.value = col;
    sortDir.value = 'asc';
  }
  page.value = 1;
  loadTutors();
};

const onPageSizeChange = () => {
  page.value = 1;
  loadTutors();
};

const goToPage = (p) => {
  if (p < 1 || p > totalPages.value) return;
  page.value = p;
  loadTutors();
};

const loadTutors = async () => {
  err.value = '';
  try {
    const params = {
      search: (search.value || '').trim() || undefined,
      page: page.value,
      pageSize: pageSize.value,
      sortBy: sortBy.value,
      sortDir: sortDir.value,
    };
    const { data } = await userApi.get('/tutors', { params });
    if (data && data.data && Array.isArray(data.data)) {
      rows.value = data.data;
      const m = data.metadata || {};
      total.value = Number(m.total || 0);
    } else if (Array.isArray(data)) {
      rows.value = data;
      total.value = data.length;
    } else {
      rows.value = [];
      total.value = 0;
    }
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
    await userApi.post('/tutors', body);
    msg.value = 'Tutor dibuat';
    firstName.value = '';
    email.value = '';
    password.value = '';
    page.value = 1;
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
    page.value = 1;
    await loadTutors();
  } catch (e) {
    err.value = (e && e.response && e.response.data && e.response.data.message) || 'Gagal menghapus akun tutor';
  } finally {
    deletingId.value = '';
  }
};

const editingId = ref('');
const savingEdit = ref(false);
const ed = ref({ firstName: '', lastName: '', email: '', password: '' });

const startEdit = (u) => {
  editingId.value = u.id;
  ed.value = { firstName: u.firstName || '', lastName: u.lastName || '', email: u.email || '', password: '' };
  msg.value = '';
  err.value = '';
};
const cancelEdit = () => { editingId.value = ''; ed.value = { firstName: '', lastName: '', email: '', password: '' }; };

const saveEdit = async (u) => {
  if (!u?.id) return;
  savingEdit.value = true;
  msg.value = '';
  err.value = '';
  try {
    // 1) Update name
    await userApi.patch(`/users/${encodeURIComponent(u.id)}`, { firstName: ed.value.firstName, lastName: ed.value.lastName });
    // 2) Update email if changed
    const newEmail = (ed.value.email || '').trim().toLowerCase();
    if (newEmail && newEmail !== (u.email || '').toLowerCase()) {
      await userApi.patch(`/users/change-email/${encodeURIComponent(u.id)}`, { email: newEmail });
    }
    // 3) Update password if provided
    const newPwd = ed.value.password || '';
    if (newPwd) {
      if (newPwd.length < 6) throw new Error('Password minimal 6 karakter');
      await userApi.patch(`/users/change-password/${encodeURIComponent(u.id)}`, { password: newPwd });
    }
    msg.value = 'Akun tutor diperbarui';
    editingId.value = '';
    ed.value = { firstName: '', lastName: '', email: '', password: '' };
    await loadTutors();
  } catch (e) {
    const m = e?.response?.data?.message || e?.message || 'Gagal menyimpan perubahan';
    err.value = m;
  } finally {
    savingEdit.value = false;
  }
};

onMounted(loadTutors);

// small component for sort indicator
const SortIcon = {
  props: { active: Boolean, dir: String },
  template: `<span v-if="active" class="sort-icon">{{ dir === 'asc' ? '▲' : '▼' }}</span>`
};
</script>

<style scoped>
.create, .list { margin-top: 16px; }
input { padding: 8px; margin-right: 6px; }
.hint { display:block; color:#666; margin-top: 6px; }
.success { color:#070 }
.error { color:#c00 }
.table { width: 100%; }
.tools { display:flex; align-items:center; gap:8px; margin-bottom: 8px; }
.tools .spacer { flex: 1; }
.btn { padding: 6px 10px; border: 1px solid #ccc; background: #fff; border-radius: 6px; cursor: pointer; margin-right: 6px; }
 table { width: 100%; border-collapse: collapse; margin-top: 8px; }
 th, td { border: 1px solid #eee; padding: 8px; text-align: left; vertical-align: top; }
 th.sortable { cursor: pointer; user-select: none; }
 .sort-icon { font-size: 10px; margin-left: 4px; color: #555; }
.btn-danger { padding: 6px 10px; border: 1px solid #c33; background: #e74c3c; color: #fff; border-radius: 6px; cursor: pointer; }
.btn-danger:disabled { opacity: .7; cursor: default; }
.pagination { display:flex; align-items:center; justify-content: space-between; margin-top: 10px; }
.pager { display:flex; align-items:center; gap: 8px; }
</style>