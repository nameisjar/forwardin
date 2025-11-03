<template>
  <div class="wrapper">
    <h2>Broadcast</h2>

    <section class="form">
      <form @submit.prevent="submit" class="grid">
        <div class="field">
          <label>Nama</label>
          <input v-model.trim="form.name" placeholder="Contoh: EC Minggu" required />
        </div>

        <!-- Delay disembunyikan; gunakan default di kode -->
        <!-- <div class="field">
          <label>Delay per penerima (ms)</label>
          <input v-model.number="form.delay" type="number" min="0" step="100" />
          <small class="dim">Default: 5000 ms</small>
        </div> -->

        <div class="field span-2">
          <label>Pesan</label>
          <textarea v-model.trim="form.message" rows="4" placeholder="Tulis pesan yang akan dikirim" required />
        </div>

        <div class="field">
          <label>Jadwal</label>
          <input v-model="form.schedule" type="datetime-local" />
          <small class="dim" v-if="form.schedule">Tanggal terpilih: {{ fmt(form.schedule) }}</small>
        </div>

        <div class="field">
          <label>Media (opsional)</label>
          <input type="file" @change="onFile" :accept="acceptTypes" />
          <div v-if="mediaPreview" class="preview">
            <img v-if="isImage" :src="mediaPreview" alt="preview" />
            <div v-else class="file-chip">{{ mediaName }}</div>
          </div>
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
          <label>Tambah Kontak (opsional)</label>
          <div class="recipients">
            <div class="add">
              <!-- <input v-model.trim="contactSearch" placeholder="Cari nama/nomor..." /> -->
              <select v-model="selectedContactId">
                <option value="" disabled>Pilih kontak</option>
                <option v-for="c in filteredContacts" :key="c.id" :value="c.phone">{{ c.firstName }} {{ c.lastName || '' }} ({{ c.phone }})</option>
              </select>
              <button type="button" @click="addSelectedContact" :disabled="!selectedContactId">Tambah Kontak</button>
              <button type="button" @click="loadContacts" :disabled="loadingContacts">{{ loadingContacts ? 'Memuat...' : 'Muat Kontak' }}</button>
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
              <button type="button" @click="addSelectedGroup" :disabled="!selectedGroupId">Tambah Grup</button>
              <button type="button" @click="loadGroups" :disabled="loadingGroups">{{ loadingGroups ? 'Memuat...' : 'Muat Ulang Grup' }}</button>
            </div>
            <!-- <small class="hint">Grup yang ditambahkan akan dikirim ke JID grup (bukan ke tiap anggota).</small> -->
          </div>
        </div>

        <div class="field span-2">
          <label>Tambah Kelas (Label) (opsional)</label>
          <div class="recipients">
            <div class="add">
              <!-- <input v-model.trim="labelSearch" placeholder="Cari kelas..." /> -->
              <select v-model="selectedLabelValue">
                <option value="" disabled>Pilih label</option>
                <option v-for="l in filteredLabels" :key="l.value" :value="l.value">{{ l.label }}</option>
              </select>
              <button type="button" @click="addSelectedLabel" :disabled="!selectedLabelValue">Tambah Label</button>
              <button type="button" @click="loadLabels" :disabled="loadingLabels">{{ loadingLabels ? 'Memuat...' : 'Muat Label' }}</button>
            </div>
          </div>
        </div>

        <div class="actions span-2">
          <button :disabled="loading || !!validationError">{{ loading ? 'Memproses...' : 'Kirim Broadcast' }}</button>
        </div>
      </form>

      <p v-if="validationError" class="error">{{ validationError }}</p>
      <p v-if="msg" class="success">{{ msg }}</p>
      <p v-if="err" class="error">{{ err }}</p>
    </section>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { deviceApi, userApi } from '../api/http.js';

// Pastikan ada device terpilih sebelum memuat data berbasis device (labels/kontak)
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
  delay: 5000,
  message: '',
  schedule: ''
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

const fmt = (d) => {
  try {
    const dd = new Date(d);
    return isNaN(dd.getTime()) ? '-' : dd.toLocaleString();
  } catch { return '-'; }
};

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

const groups = ref([]); // { value, label }
const selectedGroupId = ref('');
const loadingGroups = ref(false);
const recipientLabels = ref({}); // map recipient string -> label for chip

const chipLabel = (r) => recipientLabels.value[r] || r;

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

// auto-load groups initially (best-effort)
loadGroups().catch(() => {});

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

const addSelectedContact = () => {
  if (!selectedContactId.value) return;
  if (!recipients.value.includes(selectedContactId.value)) {
    recipients.value.push(selectedContactId.value);
    const found = contacts.value.find((c) => c.phone === selectedContactId.value);
    if (found) recipientLabels.value[selectedContactId.value] = `Kontak: ${found.firstName} ${found.lastName || ''}`;
  }
  selectedContactId.value = '';
};

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
      // fallback dari contacts jika API labels kosong
      if (!contacts.value || contacts.value.length === 0) {
        await loadContacts();
      }
      list = deriveLabelsFromContacts();
    }
    labels.value = mapLabels(list);
  } catch (_) {
    // fallback dari contacts jika gagal
    if (!contacts.value || contacts.value.length === 0) {
      await loadContacts().catch(() => {});
    }
    const list = deriveLabelsFromContacts();
    labels.value = mapLabels(list);
  } finally {
    loadingLabels.value = false;
  }
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

// auto-load groups & contacts & labels
loadGroups().catch(() => {});
loadContacts().catch(() => {});
loadLabels().catch(() => {});

const validationError = computed(() => {
  if (!form.value.name) return 'Nama wajib diisi';
  if (!form.value.message) return 'Pesan wajib diisi';
  if (recipients.value.length === 0) return 'Minimal satu penerima';
  const hasAll = recipients.value.includes('all');
  const hasLabel = recipients.value.some((r) => String(r).startsWith('label'));
  if (hasAll && hasLabel) return 'Tidak boleh mencampur all dan label_* dalam penerima';
  return '';
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
    const payloadDelay = form.value.delay ?? 5000;
    if (!mediaFile.value) {
      // JSON payload when no media
      await deviceApi.post('/messages/broadcasts', {
        name: form.value.name,
        message: form.value.message,
        delay: payloadDelay,
        schedule: form.value.schedule || undefined,
        recipients: recipients.value,
      });
    } else {
      // Multipart when media exists
      const fd = new FormData();
      fd.append('name', form.value.name);
      fd.append('message', form.value.message);
      fd.append('delay', String(payloadDelay));
      if (form.value.schedule) fd.append('schedule', form.value.schedule);
      recipients.value.forEach((r) => fd.append('recipients', r));
      fd.append('media', mediaFile.value);
      await deviceApi.post('/messages/broadcasts', fd);
    }

    msg.value = 'Broadcast berhasil dikirim/dijadwalkan.';
    // reset minimal
    form.value.name = '';
    form.value.message = '';
    form.value.delay = 5000;
    form.value.schedule = '';
    recipients.value = [];
    mediaFile.value = null;
    mediaPreview.value = '';
  } catch (e) {
    err.value = e?.response?.data?.message || e?.message || 'Gagal mengirim broadcast';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.wrapper { max-width: 920px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.field { display: flex; flex-direction: column; }
.field input, .field textarea { padding: 8px; border: 1px solid #d6d6d6; border-radius: 6px; }
.span-2 { grid-column: span 2; }
.actions { display: flex; justify-content: flex-end; }
button { padding: 8px 14px; border-radius: 6px; border: 1px solid #0a7; background: #0a7; color: #fff; cursor: pointer; }
button[disabled] { opacity: .6; cursor: not-allowed; }
.dim { color: #666; }
.error { color: #c00; margin-top: 8px; }
.success { color: #070; margin-top: 8px; }
.recipients .chips { margin-bottom: 6px; }
.chip { display: inline-flex; align-items: center; background: #eef6ff; color: #0a4; border: 1px solid #bfe; padding: 4px 8px; border-radius: 16px; margin: 2px; }
.chip-x { margin-left: 6px; border: none; background: transparent; color: #555; cursor: pointer; }
.recipients .add { display: flex; gap: 6px; }
.preview { margin-top: 8px; }
.preview img { max-width: 220px; max-height: 140px; border-radius: 6px; border: 1px solid #ddd; }
.file-chip { display: inline-block; background: #f3f3f3; padding: 4px 8px; border-radius: 6px; border: 1px solid #ddd; }
.recipients .add select { flex: 1; }
.recipients .add input { flex: 1; }
</style>
