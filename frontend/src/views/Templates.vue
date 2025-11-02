<template>
  <div>
    <h2>Template Feedback</h2>

    <section class="tpl">
      <h3>Kelola Template Feedback</h3>
      <div v-if="isAdmin" class="form">
        <input v-model="fb.courseName" placeholder="Course name" />
        <input v-model.number="fb.lesson" type="number" min="1" placeholder="Lesson" />
        <input v-model="fb.message" placeholder="Message" />
        <button @click="createFeedback" :disabled="submitting">{{ submitting ? 'Menyimpan...' : 'Tambah' }}</button>
      </div>
      <div v-else class="hint">Hanya admin yang dapat mengelola template feedback.</div>

      <div class="filter">
        <input v-model="fbFilter" placeholder="Filter course" />
        <button @click="loadFeedbacks" :disabled="loading">{{ loading ? 'Memuat...' : 'Muat' }}</button>
        <div class="spacer"></div>
        <button class="btn-small" @click="expandAll">Buka Semua</button>
        <button class="btn-small" @click="collapseAll">Tutup Semua</button>
        <button class="btn-small" @click="exportCSV" :disabled="!feedbacks.length">Export CSV</button>
      </div>

      <div class="groups" v-if="courses.length">
        <div class="group" v-for="c in courses" :key="c">
          <div class="group-header" @click="toggleGroup(c)">
            <div class="title">
              <span class="caret" :class="{ open: !collapsed[c] }">▸</span>
              <strong>{{ c }}</strong>
              <span class="dim"> ({{ grouped[c].length }} items)</span>
            </div>
          </div>
          <div class="group-body" v-show="!collapsed[c]">
            <table class="tbl">
              <thead>
                <tr>
                  <th style="width:90px">Lesson</th>
                  <th>Message</th>
                  <th v-if="isAdmin" style="width:160px">Aksi</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in grouped[c]" :key="t.id">
                  <template v-if="editId === t.id">
                    <td><input type="number" v-model.number="ed.lesson" min="1" style="width:80px" /></td>
                    <td><input v-model="ed.message" placeholder="Message" class="full" /></td>
                    <td v-if="isAdmin">
                      <button class="btn-small" @click="saveEdit" :disabled="submitting">Simpan</button>
                      <button class="btn-small" @click="cancelEdit" :disabled="submitting">Batal</button>
                    </td>
                  </template>
                  <template v-else>
                    <td>Lesson {{ t.lesson }}</td>
                    <td class="text">{{ t.message }}</td>
                    <td v-if="isAdmin">
                      <button class="btn-small" @click="startEditInline(t)">Edit</button>
                      <button class="btn-small danger" @click="deleteFeedback(t)" :disabled="submitting">Hapus</button>
                    </td>
                  </template>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div v-else class="hint">Tidak ada template.</div>

      <p v-if="msg" class="success">{{ msg }}</p>
      <p v-if="err" class="error">{{ err }}</p>
    </section>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { userApi } from '../api/http.js';
import { useAuthStore } from '../stores/auth.js';

const auth = useAuthStore();
onMounted(() => auth.fetchMe());
const isAdmin = computed(() => auth.isAdmin);

const feedbacks = ref([]);
const fbFilter = ref('');
const fb = ref({ courseName: '', lesson: 1, message: '' });
const ed = ref({ id: '', courseName: '', lesson: 1, message: '' });
const editId = ref('');
const loading = ref(false);
const submitting = ref(false);
const msg = ref('');
const err = ref('');

// grouping & UI state
const grouped = computed(() => {
  const map = {};
  const arr = Array.isArray(feedbacks.value) ? feedbacks.value.slice() : [];
  const filter = (fbFilter.value || '').trim().toLowerCase();
  for (const t of arr) {
    const course = t.courseName || '';
    if (filter && !course.toLowerCase().includes(filter)) continue;
    (map[course] ||= []).push(t);
  }
  Object.keys(map).forEach((k) => map[k].sort((a, b) => Number(a.lesson) - Number(b.lesson)));
  return map;
});
const courses = computed(() => Object.keys(grouped.value).sort((a, b) => a.localeCompare(b)));
const collapsed = ref({});
const toggleGroup = (c) => { collapsed.value[c] = !collapsed.value[c]; };
const expandAll = () => { courses.value.forEach((c) => (collapsed.value[c] = false)); };
const collapseAll = () => { courses.value.forEach((c) => (collapsed.value[c] = true)); };

const loadFeedbacks = async () => {
  loading.value = true;
  err.value = '';
  try {
    if (fbFilter.value) {
      const { data } = await userApi.get(`/algorithmics/feedback/${encodeURIComponent(fbFilter.value)}`);
      feedbacks.value = data.feedbacks || [];
    } else {
      const { data } = await userApi.get('/algorithmics/feedbacks');
      feedbacks.value = data.feedbacks || [];
    }
    collapsed.value = {};
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal memuat template';
  } finally {
    loading.value = false;
  }
};

const createFeedback = async () => {
  submitting.value = true;
  msg.value = '';
  err.value = '';
  try {
    await userApi.post('/algorithmics/feedback', fb.value);
    fb.value = { courseName: '', lesson: 1, message: '' };
    msg.value = 'Template ditambahkan';
    await loadFeedbacks();
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal menambah template';
  } finally {
    submitting.value = false;
  }
};

// inline edit helpers
const startEditInline = (t) => {
  editId.value = t.id;
  ed.value = { id: t.id, courseName: t.courseName, lesson: t.lesson, message: t.message };
};
const startEdit = (t) => startEditInline(t);
const cancelEdit = () => { editId.value = ''; };
const saveEdit = async () => {
  if (!editId.value) return;
  submitting.value = true;
  msg.value = '';
  err.value = '';
  try {
    await userApi.put(`/algorithmics/feedback/${encodeURIComponent(editId.value)}`, { courseName: ed.value.courseName, lesson: ed.value.lesson, message: ed.value.message });
    msg.value = 'Template diperbarui';
    editId.value = '';
    await loadFeedbacks();
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal memperbarui template';
  } finally {
    submitting.value = false;
  }
};

const deleteFeedback = async (t) => {
  if (!window.confirm('Hapus template ini?')) return;
  submitting.value = true;
  msg.value = '';
  err.value = '';
  try {
    await userApi.delete(`/algorithmics/feedback/${encodeURIComponent(t.id)}`);
    msg.value = 'Template dihapus';
    await loadFeedbacks();
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal menghapus template';
  } finally {
    submitting.value = false;
  }
};

// CSV export for visible data
const exportCSV = () => {
  const rows = [];
  rows.push(['Course Name', 'Lesson', 'Message']);
  for (const c of courses.value) {
    for (const t of grouped.value[c]) {
      rows.push([t.courseName, String(t.lesson ?? ''), (t.message ?? '').replace(/\n/g, ' ') ]);
    }
  }
  const csv = rows.map((r) => r.map((cell) => '"' + String(cell).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'feedback-templates.csv';
  a.click();
  URL.revokeObjectURL(url);
};

loadFeedbacks();
</script>

<style scoped>
.tpl { margin-top: 16px; }
.form input { margin-right: 6px; padding: 8px; }
.filter { display:flex; align-items:center; gap:8px; margin: 8px 0; }
.filter .spacer { flex: 1; }
.hint { color:#666; margin: 6px 0; }
.success { color: #0a0; margin-top: 8px; }
.error { color: #c00; margin-top: 8px; }
.btn-small { padding: 4px 8px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 12px; }
.btn-small.danger { border-color: #c33; background: #e74c3c; color: #fff; }
.groups { margin-top: 8px; display: flex; flex-direction: column; gap: 10px; }
.group { border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
.group-header { background: #f8fafc; padding: 10px 12px; cursor: pointer; display:flex; align-items:center; }
.group-header .title { display:flex; align-items:center; gap:8px; }
.caret { display:inline-block; transition: transform .15s ease; }
.caret.open { transform: rotate(90deg); }
.group-body { padding: 8px 12px 12px; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl th, .tbl td { border-bottom: 1px solid #f0f0f0; padding: 8px; text-align: left; vertical-align: top; }
.tbl .text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 680px; }
.tbl input.full { width: 100%; }
</style>