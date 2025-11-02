<template>
  <div class="wrapper">
    <h2>Jadwal Reminder Terjadwal</h2>

    <section class="schedule">
      <h3>Buat Jadwal</h3>
      <form @submit.prevent="submit" class="form-grid">
        <div class="field">
          <label>Nama</label>
          <input v-model.trim="form.name" placeholder="Contoh: Pengingat kelas" required />
        </div>

        <div class="field span-2">
          <label>Pesan</label>
          <textarea v-model.trim="form.message" rows="4" placeholder="Tulis pesan yang akan dikirim" required />
        </div>

        <div class="field">
          <label>Media (opsional)</label>
          <input type="file" @change="onFile" :accept="acceptTypes" />
          <div v-if="mediaPreview" class="preview">
            <img v-if="isImage" :src="mediaPreview" alt="preview" />
            <div v-else class="file-chip">{{ mediaName }}</div>
          </div>
        </div>

        <!-- Delay disembunyikan; nilai default akan digunakan otomatis -->
        <div class="field">
          <!-- <label>Delay per penerima (ms)</label>
          <input v-model.number="form.delay" type="number" min="0" step="100" /> -->
        </div>

        <div class="field">
          <label>Recurrence</label>
          <select v-model="form.recurrence" required>
            <option value="minute">Per menit</option>
            <option value="hourly">Per jam</option>
            <option value="daily">Harian</option>
            <option value="weekly">Mingguan</option>
            <option value="monthly">Bulanan</option>
          </select>
        </div>

        <div class="field">
          <label>Interval</label>
          <input v-model.number="form.interval" type="number" min="1" required />
        </div>

        <div class="field">
          <label>Mulai</label>
          <input v-model="form.startDate" type="datetime-local" required />
        </div>
        <div class="field">
          <label>Selesai</label>
          <input v-model="form.endDate" type="datetime-local" required />
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
          <div>Estimasi kirim: <strong>{{ estimatedCount }}</strong> kali</div>
          <!-- <div class="hint">Delay default: {{ form.delay }} ms</div> -->
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
import { ref, computed } from 'vue';
import { deviceApi } from '../api/http.js';

const form = ref({
  name: '',
  message: '',
  delay: 5000,
  recurrence: 'daily',
  interval: 1,
  startDate: '',
  endDate: ''
});

const recipients = ref([]);
const recipientInput = ref('');
const mediaFile = ref(null);
const mediaPreview = ref('');

const acceptTypes = '.png,.jpg,.jpeg,.webp,.gif,.mp4,.mp3,.wav,.pdf,.doc,.docx,.xls,.xlsx,.txt';

const isImage = computed(() => mediaFile.value && mediaFile.value.type?.startsWith('image'));
const mediaName = computed(() => mediaFile.value?.name || '');

const loading = ref(false);
const msg = ref('');
const err = ref('');

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

loadGroups().catch(() => {});

function onFile(e) {
  const file = e.target.files?.[0];
  mediaFile.value = file || null;
  if (file && file.type?.startsWith('image')) {
    mediaPreview.value = URL.createObjectURL(file);
  } else {
    mediaPreview.value = '';
  }
}

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

const validationError = computed(() => {
  // Basic validations mirroring backend rules
  if (!form.value.name) return 'Nama wajib diisi';
  if (!form.value.message) return 'Pesan wajib diisi';
  if (!form.value.startDate || !form.value.endDate) return 'Rentang tanggal wajib diisi';
  const start = new Date(form.value.startDate);
  const end = new Date(form.value.endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'Format tanggal tidak valid';
  if (start > end) return 'Tanggal mulai harus sebelum tanggal selesai';
  if (!form.value.interval || Number(form.value.interval) <= 0)
    return 'Interval harus lebih dari 0';
  if (recipients.value.length === 0) return 'Minimal satu penerima';
  // Disallow mixing 'all' with labels
  const hasAll = recipients.value.includes('all');
  const hasLabel = recipients.value.some((r) => r.startsWith('label'));
  if (hasAll && hasLabel) return 'Tidak boleh mencampur all dan label_* dalam penerima';
  return '';
});

const estimatedCount = computed(() => {
  // Simple estimation of occurrences between start and end by recurrence + interval
  try {
    const start = new Date(form.value.startDate);
    const end = new Date(form.value.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0;
    let count = 0;
    const cur = new Date(start);
    // safety cap to prevent infinite loop in UI
    const max = 10000;
    while (cur <= end && count < max) {
      count++;
      switch (form.value.recurrence) {
        case 'minute':
          cur.setMinutes(cur.getMinutes() + Number(form.value.interval || 1));
          break;
        case 'hourly':
          cur.setHours(cur.getHours() + Number(form.value.interval || 1));
          break;
        case 'daily':
          cur.setDate(cur.getDate() + Number(form.value.interval || 1));
          break;
        case 'weekly':
          cur.setDate(cur.getDate() + 7 * Number(form.value.interval || 1));
          break;
        case 'monthly':
          cur.setMonth(cur.getMonth() + Number(form.value.interval || 1));
          break;
      }
    }
    return count >= max ? `${max}+` : count;
  } catch {
    return 0;
  }
});

async function submit() {
  msg.value = '';
  err.value = '';
  if (validationError.value) {
    err.value = validationError.value;
    return;
  }

  loading.value = true;
  try {
    if (!mediaFile.value) {
      // Send as JSON when no media to ensure recipients stays an array
      await deviceApi.post('/messages/broadcasts/scheduled', {
        name: form.value.name,
        message: form.value.message,
        delay: form.value.delay ?? 5000,
        recurrence: form.value.recurrence,
        interval: form.value.interval,
        startDate: form.value.startDate,
        endDate: form.value.endDate,
        recipients: recipients.value,
      });
    } else {
      // Use multipart only when media exists
      const fd = new FormData();
      fd.append('name', form.value.name);
      fd.append('message', form.value.message);
      fd.append('delay', String(form.value.delay ?? 5000));
      fd.append('recurrence', form.value.recurrence);
      fd.append('interval', String(form.value.interval));
      fd.append('startDate', form.value.startDate);
      fd.append('endDate', form.value.endDate);
      recipients.value.forEach((r) => fd.append('recipients', r));
      fd.append('media', mediaFile.value);

      await deviceApi.post('/messages/broadcasts/scheduled', fd);
    }

    msg.value = 'Jadwal reminder berhasil dibuat.';
    // reset minimal
    form.value.name = '';
    form.value.message = '';
    form.value.delay = 5000;
    form.value.interval = 1;
    form.value.recurrence = 'daily';
    form.value.startDate = '';
    form.value.endDate = '';
    recipients.value = [];
    mediaFile.value = null;
    mediaPreview.value = '';
  } catch (e) {
    err.value = (e && e.response && e.response.data && (e.response.data.message || e.response.data.error)) || 'Gagal membuat jadwal reminder';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.wrapper { max-width: 920px; }
section { margin-top: 16px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; }
.field span { font-size: 12px; color: #666; }
.field input, .field textarea, .field select { padding: 8px; border: 1px solid #d6d6d6; border-radius: 6px; }
.span-2 { grid-column: span 2; }
.actions { display: flex; justify-content: flex-end; }
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
.preview { margin-top: 8px; }
.preview img { max-width: 220px; max-height: 140px; border-radius: 6px; border: 1px solid #ddd; }
.file-chip { display: inline-block; background: #f3f3f3; padding: 4px 8px; border-radius: 6px; border: 1px solid #ddd; }
.info { color: #333; display: flex; justify-content: space-between; align-items: center; }
</style>