<template>
  <div class="wrapper">
    <h2>Jadwal Reminder Terjadwal</h2>

    <section class="schedule card">
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
        <div class="field"></div>

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
          <div>Estimasi kirim: <strong>{{ estimatedCount }}</strong> kali</div>
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
import { ref, computed } from 'vue';
import { deviceApi, userApi } from '../api/http.js';

// Pastikan deviceId tersedia di localStorage agar pemuatan labels/kontak tepat sasaran
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

const contacts = ref([]); // { id, firstName, lastName, phone }
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

// labels (kelas)
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

// NEW: derive labels from contacts when API returns none
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
    // Fallback: derive from contacts if empty
    if (!Array.isArray(list) || list.length === 0) {
      if (!contacts.value || contacts.value.length === 0) {
        await loadContacts().catch(() => {});
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

const loadContacts = async () => {
  try {
    loadingContacts.value = true;
    err.value = '';
    const deviceId = (await ensureDeviceId()) || undefined;
    const res = await userApi.get('/contacts', { params: deviceId ? { deviceId } : {} });
    contacts.value = Array.isArray(res?.data) ? res.data : [];
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal memuat kontak';
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
      recipientLabels.value[selectedContactId.value] = `Kontak: ${found.firstName} ${found.lastName || ''}${labels ? ' [' + labels + ']' : ''}`;
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

loadGroups().catch(() => {});
loadContacts().catch(() => {});
loadLabels().catch(() => {});

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
.wrapper { max-width: 1200px; margin: 0 auto; padding: 0 16px; }
section { margin-top: 16px; }
.card { background: #fff; border: 1px solid #eaeaea; border-radius: 12px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); padding: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; }
.field span { font-size: 12px; color: #666; }
.field input, .field textarea, .field select { padding: 8px 10px; border: 1px solid #d6d6d6; border-radius: 8px; }
.span-2 { grid-column: span 2; }
.actions { display: flex; justify-content: flex-end; }

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
.preview { margin-top: 8px; }
.preview img { max-width: 220px; max-height: 140px; border-radius: 6px; border: 1px solid #ddd; }
.file-chip { display: inline-block; background: #f3f3f3; padding: 4px 8px; border-radius: 6px; border: 1px solid #ddd; }
.info { color: #333; display: flex; justify-content: space-between; align-items: center; }
</style>