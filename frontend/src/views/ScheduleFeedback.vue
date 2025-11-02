<template>
  <div class="wrapper">
    <h2>Jadwal Feedback</h2>

    <section class="schedule">
      <h3>Buat Jadwal Feedback</h3>
      <form @submit.prevent="submit" class="form-grid">
        <!-- Tambah kembali Nama -->
        <div class="field">
          <label>Nama</label>
          <input v-model.trim="form.name" placeholder="Contoh: Nama Kelas" required />
        </div>

        <div class="field">
          <label>Course</label>
          <select v-model="form.courseName" required>
            <option value="" disabled>Pilih course</option>
            <option v-for="c in courseOptions" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>

        <div class="field">
          <label>Mulai dari Lesson ke-</label>
          <input v-model.number="form.startLesson" type="number" min="1" required />
        </div>

        <!-- Delay diset default (disembunyikan) -->
        <!-- <div class="field">
          <label>Delay per penerima (ms)</label>
          <input v-model.number="form.delay" type="number" min="0" step="100" />
        </div> -->

        <div class="field">
          <label>Tanggal mulai</label>
          <input v-model="form.schedule" type="datetime-local" required />
          <small class="hint">Pengiriman akan berulang tiap minggu untuk setiap lesson.</small>
        </div>

        <div class="field span-2">
          <label>Penerima</label>
          <div class="recipients">
            <div class="chips">
              <span v-for="(r, i) in recipients" :key="r + i" class="chip">
                {{ chipLabel(r) }}
                <button type="button" class="chip-x" @click="removeRecipient(i)">×</button>
              </span>
            </div>
            <div class="add">
              <input
                v-model="recipientInput"
                @keydown.enter.prevent="addRecipientsFromInput"
                placeholder="62812..."
              />
              <button type="button" @click="addRecipientsFromInput">Tambah</button>
            </div>
            <!-- <small class="hint">Khusus: gunakan "all" untuk semua kontak, atau "label_nama" untuk label tertentu. Jangan campur keduanya.</small> -->
          </div>
        </div>

        <div class="field span-2">
          <label>Tambah Grup (opsional)</label>
          <div class="recipients">
            <div class="add">
              <select v-model="selectedGroupId">
                <option value="" disabled>Pilih group</option>
                <option v-for="g in groups" :key="g.value" :value="g.value">{{ g.label }}</option>
              </select>
              <button type="button" @click="addSelectedGroup" :disabled="!selectedGroupId">Tambah Grup</button>
              <button type="button" @click="loadGroups" :disabled="loadingGroups">{{ loadingGroups ? 'Memuat...' : 'Muat Ulang Grup' }}</button>
            </div>
            <!-- <small class="hint">Grup yang ditambahkan akan dikirim ke JID grup (bukan ke tiap anggota).</small> -->
          </div>
        </div>

        <div class="field span-2 info">
          <div>
            Estimasi kirim: <strong>{{ estimatedCount }}</strong> kali
            <span v-if="lastDate"> — Perkiraan selesai: <strong>{{ lastDate }}</strong></span>
          </div>
          <div v-if="validationError" class="error">{{ validationError }}</div>
        </div>

        <div class="actions span-2">
          <button :disabled="loading || !!validationError">{{ loading ? 'Memproses...' : 'Jadwalkan' }}</button>
        </div>
      </form>

      <p v-if="msg" class="success">{{ msg }}</p>
      <p v-if="err" class="error">{{ err }}</p>
    </section>

   
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { deviceApi, userApi } from '../api/http.js';

const form = ref({
  name: '',
  courseName: '',
  startLesson: 1,
  delay: 5000,
  schedule: ''
});

const loading = ref(false);
const msg = ref('');
const err = ref('');

// Recipients (same behaviour as ScheduleReminder)
const recipients = ref([]);
const recipientInput = ref('');
const groups = ref([]); // { value, label, meta }
const selectedGroupId = ref('');
const loadingGroups = ref(false);
const recipientLabels = ref({}); // map recipient string -> label for chip

const normalizeGroupValue = (g) => {
  const full = g.id || g.jid || '';
  const short = g.idShort || g.shortId || g.groupId || '';
  const chosen = full || short || '';
  if (!chosen) return '';
  return chosen.includes('@') ? chosen : `${chosen}@g.us`;
};

const mapGroups = (items) => {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .map((g) => ({
      value: normalizeGroupValue(g),
      label: g.subject || g.name || g.title || g.id || g.jid || 'Tanpa Nama',
      meta: { id: g.id, shortId: g.shortId || g.idShort, jid: g.jid },
    }))
    .filter((g) => g.value);
};

const loadGroups = async () => {
  try {
    loadingGroups.value = true;
    err.value = '';
    let res;
    try {
      res = await deviceApi.get('/messages/get-groups/detail');
    } catch (_) {
      res = await deviceApi.get('/messages/get-groups');
    }
    const payload = res?.data;
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.data)
      ? payload.data
      : [];
    groups.value = mapGroups(list);
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal memuat grup';
  } finally {
    loadingGroups.value = false;
  }
};

const ensureFullGroupJid = async (jidOrId) => {
  let val = String(jidOrId || '').trim();
  if (!val) return '';
  if (!val.includes('@')) val = `${val}@g.us`;
  if (val.split('@')[0].includes('-')) return val;
  try {
    const clean = val.replace(/@g\.us$/i, '');
    const byId = await deviceApi.get(`/messages/get-groups/${encodeURIComponent(clean)}`);
    const full = byId?.data?.id || byId?.data?.jid || '';
    if (full && full.split('@')[0].includes('-')) return full.includes('@g.us') ? full : `${full}@g.us`;
  } catch (_) {}
  try {
    const res = await deviceApi.get('/messages/get-groups/detail');
    const items = Array.isArray(res?.data?.results) ? res.data.results : Array.isArray(res?.data) ? res.data : [];
    const clean = val.replace(/@g\.us$/i, '');
    const match = items.find((g) => {
      const id = (g.id || '').replace(/@g\.us$/i, '');
      const shortId = (g.shortId || g.idShort || '').replace(/@g\.us$/i, '');
      return id === clean || shortId === clean;
    });
    if (match?.id) {
      const full = match.id;
      return full.includes('@g.us') ? full : `${full}@g.us`;
    }
  } catch (_) {}
  return val;
};

const addSelectedGroup = async () => {
  if (!selectedGroupId.value) return;
  const fullJid = await ensureFullGroupJid(selectedGroupId.value);
  if (!fullJid) return;
  if (!recipients.value.includes(fullJid)) {
    recipients.value.push(fullJid);
    const found = groups.value.find((g) => g.value === selectedGroupId.value);
    if (found) recipientLabels.value[fullJid] = `Group: ${found.label}`;
  }
  selectedGroupId.value = '';
};

const chipLabel = (r) => recipientLabels.value[r] || r;

// Add/remove recipients manually
function addRecipientsFromInput() {
  if (!recipientInput.value) return;
  const items = recipientInput.value
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set([...recipients.value, ...items]);
  recipients.value = Array.from(set);
  recipientInput.value = '';
}

function removeRecipient(index) {
  recipients.value.splice(index, 1);
}

// Course dropdown from templates
const templates = ref([]);
const courseOptions = ref([]);
const filterCourse = ref('');
const tf = ref({ courseName: '', lesson: 1, message: '' });

const extractCourseOptions = (items) => {
  const set = new Set((items || []).map((t) => t.courseName).filter(Boolean));
  courseOptions.value = Array.from(set).sort();
};

const loadTemplates = async () => {
  try {
    let data;
    if (filterCourse.value) {
      const res = await userApi.get(`/algorithmics/feedback/${encodeURIComponent(filterCourse.value)}`);
      data = res.data;
      templates.value = data.feedbacks || [];
    } else {
      const res = await userApi.get('/algorithmics/feedbacks');
      data = res.data;
      templates.value = data.feedbacks || [];
    }
    extractCourseOptions(templates.value);
  } catch (e) {
    // noop
  }
};

const createTemplate = async () => {
  try {
    await userApi.post('/algorithmics/feedback', tf.value);
    tf.value = { courseName: '', lesson: 1, message: '' };
    await loadTemplates();
  } catch (e) {
    alert('Gagal membuat template');
  }
};

onMounted(async () => {
  await Promise.allSettled([loadTemplates(), loadGroups()]);
});

// Estimation helpers
const lessonsForCourse = computed(() => {
  if (!form.value.courseName) return [];
  return (templates.value || [])
    .filter((t) => t.courseName === form.value.courseName)
    .sort((a, b) => Number(a.lesson) - Number(b.lesson));
});

const estimatedCount = computed(() => {
  const start = Number(form.value.startLesson || 1);
  const list = lessonsForCourse.value.filter((t) => Number(t.lesson) >= start);
  return list.length || 0;
});

const lastDate = computed(() => {
  try {
    if (!form.value.schedule || !estimatedCount.value) return '';
    const start = new Date(form.value.schedule);
    if (isNaN(start.getTime())) return '';
    const weeks = Math.max(estimatedCount.value - 1, 0);
    const last = new Date(start);
    last.setDate(last.getDate() + weeks * 7);
    // format YYYY-MM-DD HH:mm local
    const pad = (n) => String(n).padStart(2, '0');
    const y = last.getFullYear();
    const m = pad(last.getMonth() + 1);
    const d = pad(last.getDate());
    const hh = pad(last.getHours());
    const mm = pad(last.getMinutes());
    return `${y}-${m}-${d} ${hh}:${mm}`;
  } catch {
    return '';
  }
});

// Validation
const validationError = computed(() => {
  if (!form.value.name) return 'Nama wajib diisi';
  if (!form.value.courseName) return 'Course wajib dipilih';
  if (!form.value.startLesson || Number(form.value.startLesson) <= 0) return 'Start lesson minimal 1';
  if (!form.value.schedule) return 'Tanggal mulai wajib diisi';
  const sd = new Date(form.value.schedule);
  if (isNaN(sd.getTime())) return 'Format tanggal mulai tidak valid';
  if (recipients.value.length === 0) return 'Minimal satu penerima';
  const hasAll = recipients.value.includes('all');
  const hasLabel = recipients.value.some((r) => r.startsWith('label'));
  if (hasAll && hasLabel) return 'Tidak boleh mencampur all dan label_* dalam penerima';
  return '';
});

const submit = async () => {
  msg.value = '';
  err.value = '';
  if (validationError.value) {
    err.value = validationError.value;
    return;
  }
  loading.value = true;
  try {
    // Backend mengabaikan schedule di endpoint ini dan akan mulai dari waktu saat request diterima.
    await deviceApi.post('/messages/broadcasts/feedback', {
      name: form.value.name,
      courseName: form.value.courseName,
      startLesson: form.value.startLesson,
      delay: form.value.delay ?? 5000,
      recipients: recipients.value,
    });
    msg.value = 'Jadwal feedback berhasil dibuat.';
    // reset minimal
    form.value.name = '';
    form.value.courseName = '';
    form.value.startLesson = 1;
    form.value.delay = 5000;
    form.value.schedule = '';
    recipients.value = [];
  } catch (e) {
    err.value = (e && e.response && e.response.data && (e.response.data.message || e.response.data.error)) || 'Gagal membuat jadwal feedback';
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.wrapper { max-width: 920px; }
section { margin-top: 16px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; }
.field input, .field textarea, .field select { padding: 8px; border: 1px solid #d6d6d6; border-radius: 6px; }
.span-2 { grid-column: span 2; }
.actions { display: flex; gap: 8px; justify-content: flex-start; align-items: center; }
button { padding: 8px 14px; border-radius: 6px; border: 1px solid #0a7; background: #0a7; color: #fff; cursor: pointer; }
button[disabled] { opacity: 0.6; cursor: not-allowed; }
.error { color: #c00; }
.success { color: #070; }

.recipients .chips { margin-bottom: 6px; }
.chip { display: inline-flex; align-items: center; background: #eef6ff; color: #0a4; border: 1px solid #bfe; padding: 4px 8px; border-radius: 16px; margin: 2px; }
.chip-x { margin-left: 6px; border: none; background: transparent; color: #555; cursor: pointer; }
.recipients .add { display: flex; gap: 6px; }
.recipients .add input { flex: 1; }
.recipients .add select { flex: 1; }
.hint { color: #666; }
.info { color: #333; display: flex; justify-content: space-between; align-items: center; }

.templates { margin-top: 24px; }
.filter { margin: 8px 0; display: flex; gap: 8px; align-items: center; }
ul { padding-left: 16px; }
</style>