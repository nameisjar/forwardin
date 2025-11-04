<template>
  <div class="wrapper">
    <h2>Kirim Pesan</h2>

    <section class="form card">
      <!-- Target selector -->
      <div class="row radios">
        <label class="field">
          <span>Tujuan</span>
          <div class="choices">
            <label><input type="radio" value="number" v-model="targetType" /> Nomor</label>
            <label><input type="radio" value="group" v-model="targetType" /> Group</label>
            <label><input type="radio" value="contact" v-model="targetType" /> Kontak</label>
            <label><input type="radio" value="label" v-model="targetType" /> Label</label>
          </div>
        </label>
      </div>

      <div class="row" v-if="targetType === 'number'">
        <label class="field grow">
          <span>Nomor</span>
          <input v-model="phone" placeholder="contoh: 62812xxxx" />
        </label>
      </div>

      <div class="row" v-else-if="targetType === 'group'">
        <label class="field grow">
          <span>Group</span>
          <select v-model="selectedGroupId">
            <option value="" disabled>Pilih group</option>
            <option v-for="g in groups" :key="g.value" :value="g.value">{{ g.label }}</option>
          </select>
        </label>
        <button class="btn outline" @click="loadGroups" :disabled="loadingGroups">{{ loadingGroups ? 'Memuat...' : 'Muat Ulang Grup' }}</button>
      </div>

      <div class="row" v-else-if="targetType === 'contact'">
        <label class="field grow">
          <span>Kontak</span>
          <select v-model="selectedContacts" multiple size="6">
            <option v-for="c in contacts" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </label>
        <button class="btn outline" @click="loadContacts" :disabled="loadingContacts">{{ loadingContacts ? 'Memuat...' : 'Muat Ulang Kontak' }}</button>
      </div>

      <div class="row" v-else>
        <label class="field grow">
          <span>Label</span>
          <select v-model="selectedLabels" multiple size="6">
            <option v-for="l in labels" :key="l" :value="l">{{ l }}</option>
          </select>
        </label>
        <button class="btn outline" @click="loadLabels" :disabled="loadingLabels">{{ loadingLabels ? 'Memuat...' : 'Muat Ulang Label' }}</button>
      </div>

      <hr />

      <!-- Message type -->
      <div class="row radios">
        <label class="field">
          <span>Tipe Pesan</span>
          <div class="choices">
            <label><input type="radio" value="text" v-model="messageMode" /> Teks</label>
            <label><input type="radio" value="media" v-model="messageMode" /> Media</label>
          </div>
        </label>
      </div>

      <template v-if="messageMode === 'text'">
        <div class="row">
          <label class="field grow">
            <span>Pesan</span>
            <textarea v-model="text" rows="4" placeholder="Tulis pesan..."></textarea>
          </label>
        </div>
      </template>

      <template v-else>
        <div class="row">
          <label class="field">
            <span>Jenis Media</span>
            <select v-model="mediaType">
              <option value="image">Gambar</option>
              <option value="document">Dokumen</option>
              <option value="audio">Audio</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label class="field grow">
            <span>File</span>
            <input type="file" @change="onFile" :accept="acceptByType" />
          </label>
        </div>
        <div class="row">
          <label class="field grow">
            <span>Keterangan</span>
            <input v-model="caption" placeholder="Caption (opsional)" />
          </label>
        </div>
      </template>

      <div class="row actions">
        <button class="btn primary" @click="send" :disabled="sending">{{ sending ? 'Mengirim...' : 'Kirim' }}</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="ok" class="ok">Berhasil diproses.</p>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref, computed } from 'vue';
import { deviceApi, userApi } from '../api/http.js';

const targetType = ref('number');
const messageMode = ref('text'); // 'text' | 'media'

const phone = ref('');
const groups = ref([]); // { value, label }
const selectedGroupId = ref('');

const contacts = ref([]); // { value: phone, label: 'Name (phone)', labels: string[] }
const selectedContacts = ref([]);

const labels = ref([]); // string[]
const selectedLabels = ref([]);

const text = ref('');
const caption = ref('');
const mediaType = ref('image'); // image|document|audio|video
const mediaFile = ref(null);

const sending = ref(false);
const loadingGroups = ref(false);
const loadingContacts = ref(false);
const loadingLabels = ref(false);
const error = ref('');
const ok = ref(false);

const acceptByType = computed(() => {
  switch (mediaType.value) {
    case 'image': return 'image/*';
    case 'document': return '*/*';
    case 'audio': return 'audio/*';
    case 'video': return 'video/*';
    default: return '*/*';
  }
});

// prefer full group id/jid when available; append @g.us if missing
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

const getDeviceId = () => localStorage.getItem('device_selected_id') || undefined;

const loadGroups = async () => {
  try {
    loadingGroups.value = true;
    error.value = '';
    // ensure device api key is available (interceptor does this lazily)
    await userApi.get('/devices').catch(() => {});
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
    error.value = e?.response?.data?.message || e?.message || 'Gagal memuat grup';
  } finally {
    loadingGroups.value = false;
  }
};

const loadContacts = async () => {
  try {
    loadingContacts.value = true;
    error.value = '';
    const deviceId = getDeviceId();
    const { data } = await userApi.get('/contacts', { params: { deviceId } });
    contacts.value = (Array.isArray(data) ? data : []).map((c) => ({
      value: String(c.phone || ''),
      label: `${c.firstName || c.lastName ? (c.firstName || '') + ' ' + (c.lastName || '') : c.phone} (${c.phone})`,
      labels: (c.ContactLabel || []).map((x) => x.label?.name).filter(Boolean),
    }));
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Gagal memuat kontak';
  } finally {
    loadingContacts.value = false;
  }
};

const loadLabels = async () => {
  try {
    loadingLabels.value = true;
    error.value = '';
    const deviceId = getDeviceId();
    const { data } = await userApi.get('/contacts/labels', { params: { deviceId } });
    labels.value = Array.isArray(data) ? data : [];
  } catch (e) {
    error.value = e?.response?.data?.message || e?.message || 'Gagal memuat label';
  } finally {
    loadingLabels.value = false;
  }
};

// Ensure we have a full group JID (with hyphen). If selected id has no hyphen, resolve via API list.
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
    const items = Array.isArray(res?.data?.results)
      ? res.data.results
      : Array.isArray(res?.data)
      ? res.data
      : [];
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

const onFile = (e) => {
  const f = e.target.files && e.target.files[0];
  mediaFile.value = f || null;
};

const buildRecipients = async () => {
  if (targetType.value === 'number') {
    return phone.value ? [String(phone.value).trim()] : [];
  }
  if (targetType.value === 'group') {
    const gid = await ensureFullGroupJid(selectedGroupId.value);
    return gid ? [gid] : [];
  }
  if (targetType.value === 'contact') {
    return selectedContacts.value.map((p) => String(p)).filter(Boolean);
  }
  // label: expand via loaded contacts
  const selected = new Set(selectedLabels.value);
  const phones = contacts.value
    .filter((c) => (c.labels || []).some((l) => selected.has(l)))
    .map((c) => c.value)
    .filter(Boolean);
  return Array.from(new Set(phones));
};

const validate = async () => {
  if (messageMode.value === 'text') {
    if (!text.value.trim()) { error.value = 'Pesan tidak boleh kosong'; return false; }
  } else {
    if (!mediaFile.value) { error.value = 'File media wajib diisi'; return false; }
  }
  const rec = await buildRecipients();
  if (!rec.length) { error.value = 'Tujuan belum dipilih/dimasukkan'; return false; }
  return true;
};

const send = async () => {
  if (!(await validate())) return;
  sending.value = true;
  ok.value = false;
  error.value = '';
  try {
    const recipients = await buildRecipients();

    if (messageMode.value === 'text') {
      const isGroup = targetType.value === 'group';
      const payload = recipients.map((r) => ({
        recipient: r,
        ...(isGroup ? { type: 'group' } : {}),
        message: { text: text.value },
      }));
      await deviceApi.post('/messages/send', payload);
    } else {
      const form = new FormData();
      // append recipients as repeated field
      for (const r of recipients) form.append('recipients', r);
      if (caption.value) form.append('caption', caption.value);
      // form.append('delay', String(5000)); // optional
      const fileField = mediaType.value === 'document' ? 'document' : mediaType.value; // image|document|audio|video
      form.append(fileField, mediaFile.value);
      const path = `/messages/send/${mediaType.value}`;
      await deviceApi.post(path, form);
    }

    ok.value = true;
  } catch (e) {
    const msg = e?.response?.data?.message || e?.response?.data?.error || e?.message || 'Gagal mengirim';
    error.value = /Invalid group JID/i.test(msg)
      ? 'ID grup tidak valid. Pilih ulang grup agar ID lengkap (dengan hyphen) terpakai.'
      : msg;
  } finally {
    sending.value = false;
  }
};

onMounted(() => {
  loadGroups();
  loadContacts();
  loadLabels();
});
</script>

<style scoped>
.wrapper { max-width: 920px; margin: 0 auto; }
.card { background: #fff; border: 1px solid #eaeaea; border-radius: 12px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); padding: 12px; }

.form { display: flex; flex-direction: column; gap: 12px; }
.row { display:flex; gap:12px; align-items:flex-end; flex-wrap: wrap; }
.radios .choices { display:flex; gap: 12px; align-items: center; }

.field { display:flex; flex-direction: column; gap:6px; }
.field > span { font-size: 12px; color: #667085; }
.field input, .field select, .field textarea { padding: 8px 10px; border: 1px solid #d8dde6; border-radius: 8px; background: #fff; }
.field textarea { min-height: 100px; }
.field.grow { flex: 1; min-width: 260px; }

.actions { margin-top: 6px; }

.btn { height: 36px; padding: 0 12px; border: 1px solid #d0d5dd; background: #f9fafb; border-radius: 8px; cursor: pointer; font-weight: 500; }
.btn:disabled { opacity: .6; cursor: not-allowed; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn.outline { background: #fff; }

.error { color: #b00020; }
.ok { color: #2e7d32; }
</style>