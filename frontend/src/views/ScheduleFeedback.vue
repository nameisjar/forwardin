<template>
  <div class="wrapper">
    <h2>Jadwal Feedback</h2>

    <section class="schedule card">
      <!-- <h3>Buat Jadwal Feedback</h3> -->
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
                placeholder="cth: 62812... jika banyak: 62812...,62813...,62814..."
              />
              <button type="button" class="btn" @click="addRecipientsFromInput">Tambah</button>
            </div>
          </div>
        </div>

        <div class="field span-2">
          <label>Tambah Kontak (opsional)</label>
          <div class="recipients">
            <div class="add">
              <select v-model="selectedContactId">
                <option value="" disabled>Pilih kontak</option>
                <option v-for="c in filteredContacts" :key="c.id" :value="c.phone">{{ contactDisplay(c) }}</option>
              </select>
              <button type="button" class="btn" @click="addSelectedContact" :disabled="!selectedContactId">Tambah Kontak</button>
              <button type="button" class="btn outline" @click="loadContacts" :disabled="loadingContacts">{{ loadingContacts ? 'Memuat...' : 'Muat Kontak' }}</button>
            </div>
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
              <button type="button" class="btn" @click="addSelectedGroup" :disabled="!selectedGroupId">Tambah Grup</button>
              <button type="button" class="btn outline" @click="loadGroups" :disabled="loadingGroups">{{ loadingGroups ? 'Memuat...' : 'Muat Ulang Grup' }}</button>
            </div>
          </div>
        </div>

        <div class="field span-2">
          <label>Tambah Kelas (Label) (opsional)</label>
          <div class="recipients">
            <div class="add">
              <select v-model="selectedLabelValue">
                <option value="" disabled>Pilih label</option>
                <option v-for="l in filteredLabels" :key="l.value" :value="l.value">{{ l.label }}</option>
              </select>
              <button type="button" class="btn" @click="addSelectedLabel" :disabled="!selectedLabelValue">Tambah Label</button>
              <button type="button" class="btn outline" @click="loadLabels" :disabled="loadingLabels">{{ loadingLabels ? 'Memuat...' : 'Muat Label' }}</button>
            </div>
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
          <button class="btn primary" :disabled="loading || !!validationError">{{ loading ? 'Memproses...' : 'Jadwalkan' }}</button>
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

// Pastikan deviceId tersedia/tersimpan sebelum memuat label/kontak
const ensureDeviceId = async () => {
  let deviceId = localStorage.getItem('device_selected_id');
  if (deviceId) return deviceId;
  try {
    const { data } = await userApi.get('/devices');
    const devices = Array.isArray(data) ? data : [];
    const current = devices.find((d) => d.status === 'open') || devices[0];
    if (current) {
      if (current.id) localStorage.setItem('device_selected_id', current.id);
      if (current.name) localStorage.setItem('device_selected_name', current.name);
      if (current.apiKey) localStorage.setItem('device_api_key', current.apiKey);
      return current.id || '';
    }
  } catch (_) {}
  return '';
};

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

const contacts = ref([]);
const selectedContactId = ref('');
const loadingContacts = ref(false);
const contactSearch = ref('');
const filteredContacts = computed(() => {
  const q = contactSearch.value.toLowerCase();
  if (!q) return contacts.value;
  return contacts.value.filter((c) =>
    [c.firstName, c.lastName, c.phone]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q))
  );
});

// Labels (kelas)
const labels = ref([]); // { value: 'label_<slugOrName>', label: 'Name' }
const selectedLabelValue = ref('');
const loadingLabels = ref(false);
const labelSearch = ref('');
const filteredLabels = computed(() => {
  const q = labelSearch.value.toLowerCase();
  if (!q) return labels.value;
  return labels.value.filter((l) => l.label.toLowerCase().includes(q));
});

const mapLabels = (items) => {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .map((it) => {
      if (typeof it === 'string') {
        const name = it;
        return { value: `label_${name}`, label: name };
      }
      const name = it.name || it.label || it.title || '';
      const slug = it.slug || '';
      const value = `label_${slug || name}`;
      return name ? { value, label: name } : null;
    })
    .filter(Boolean);
};

const deriveLabelsFromContacts = () => {
  const names = new Set();
  (contacts.value || []).forEach((c) => {
    (c.ContactLabel || []).forEach((cl) => {
      const n = cl?.label?.name;
      if (n && !String(n).startsWith('device_')) names.add(n);
    });
  });
  return Array.from(names);
};

const loadLabels = async () => {
  try {
    loadingLabels.value = true;
    const deviceId = (await ensureDeviceId()) || undefined;
    const res = await userApi.get('/contacts/labels', { params: deviceId ? { deviceId } : {} });
    const data = res?.data;
    let list = Array.isArray(data?.labels) ? data.labels : Array.isArray(data) ? data : [];
    if (!Array.isArray(list) || list.length === 0) {
      if (!contacts.value || contacts.value.length === 0) {
        await loadContacts();
      }
      list = deriveLabelsFromContacts();
    }
    labels.value = mapLabels(list);
  } catch (_) {
    if (!contacts.value || contacts.value.length === 0) {
      await loadContacts().catch(() => {});
    }
    const list = deriveLabelsFromContacts();
    labels.value = mapLabels(list);
  } finally {
    loadingLabels.value = false;
  }
};

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
      try {
        res = await deviceApi.get('/messages/get-groups');
      } catch (__) {
        // Fallback jika endpoint tidak ada
        groups.value = [];
        return;
      }
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
    console.error('Error loading groups:', e);
    // Jangan tampilkan error jika hanya gagal load groups
    groups.value = [];
  } finally {
    loadingGroups.value = false;
  }
};

const loadContacts = async () => {
  try {
    loadingContacts.value = true;
    err.value = '';
    // Gunakan userApi untuk contacts, bukan deviceApi
    const deviceId = (await ensureDeviceId()) || undefined;
    const res = await userApi.get('/contacts', {
      params: deviceId ? { deviceId } : {},
    });
    contacts.value = res?.data || [];
  } catch (e) {
    console.error('Error loading contacts:', e);
    // Jangan tampilkan error jika hanya gagal load contacts
    contacts.value = [];
  } finally {
    loadingContacts.value = false;
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

const contactLabelNames = (c) => {
  try {
    const arr = (c?.ContactLabel || []).map((x) => x?.label?.name).filter((n) => n && !String(n).startsWith('device_'));
    return arr.join(', ');
  } catch { return ''; }
};
const contactDisplay = (c) => {
  const name = `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.phone || '-';
  const labels = contactLabelNames(c);
  return labels ? `${name} (${c.phone}) — [${labels}]` : `${name} (${c.phone})`;
};

const addSelectedContact = () => {
  if (!selectedContactId.value) return;
  if (!recipients.value.includes(selectedContactId.value)) {
    recipients.value.push(selectedContactId.value);
    const found = contacts.value.find((c) => c.phone === selectedContactId.value);
    if (found) {
      const labels = contactLabelNames(found);
      recipientLabels.value[selectedContactId.value] = `Contact: ${found.firstName} ${found.lastName || ''}${labels ? ' [' + labels + ']' : ''}`;
    }
  }
  selectedContactId.value = '';
};

const addSelectedLabel = () => {
  if (!selectedLabelValue.value) return;
  const val = selectedLabelValue.value;
  if (!recipients.value.includes(val)) {
    recipients.value.push(val);
    const found = labels.value.find((l) => l.value === val);
    if (found) recipientLabels.value[val] = `Label: ${found.label}`;
  }
  selectedLabelValue.value = '';
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
      try {
        const res = await userApi.get(`/algorithmics/feedback/${encodeURIComponent(filterCourse.value)}`);
        data = res.data;
        templates.value = data.feedbacks || [];
      } catch (e) {
        console.error('Error loading course templates:', e);
        templates.value = [];
      }
    } else {
      try {
        const res = await userApi.get('/algorithmics/feedbacks');
        data = res.data;
        templates.value = data.feedbacks || [];
      } catch (e) {
        console.error('Error loading all templates:', e);
        templates.value = [];
      }
    }
    extractCourseOptions(templates.value);
  } catch (e) {
    console.error('Error in loadTemplates:', e);
    templates.value = [];
    courseOptions.value = [];
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
  await Promise.allSettled([loadTemplates(), loadGroups(), loadContacts(), loadLabels()]);
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
    // Pastikan schedule dikirim dengan benar
    const payload = {
      name: form.value.name,
      courseName: form.value.courseName,
      startLesson: form.value.startLesson,
      delay: form.value.delay ?? 5000,
      schedule: form.value.schedule, // Tambahkan schedule
      recipients: recipients.value,
    };
    
    console.log('Sending feedback schedule payload:', payload);
    
    await deviceApi.post('/messages/broadcasts/feedback', payload);
    
    msg.value = 'Jadwal feedback berhasil dibuat.';
    // reset form
    form.value.name = '';
    form.value.courseName = '';
    form.value.startLesson = 1;
    form.value.delay = 5000;
    form.value.schedule = '';
    recipients.value = [];
    recipientLabels.value = {};
  } catch (e) {
    console.error('Error creating feedback schedule:', e);
    const errorMsg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Gagal membuat jadwal feedback';
    err.value = errorMsg;
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.wrapper { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
section { margin-top: 16px; }
.card { background: #fff; border: 1px solid #eaeaea; border-radius: 12px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); padding: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; }
.field input, .field textarea, .field select { padding: 8px 10px; border: 1px solid #d6d6d6; border-radius: 8px; }
.span-2 { grid-column: span 2; }
.actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; }

.btn { height: 36px; padding: 0 12px; border: 1px solid #d0d5dd; background: #f9fafb; border-radius: 8px; cursor: pointer; font-weight: 500; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn.outline { background: #fff; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }

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