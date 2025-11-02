<template>
  <div>
    <h2>Kirim Pesan</h2>

    <section class="form">
      <div class="row">
        <label>Tujuan</label>
        <label><input type="radio" value="number" v-model="targetType" /> Nomor</label>
        <label><input type="radio" value="group" v-model="targetType" /> Group</label>
      </div>

      <div class="row" v-if="targetType === 'number'">
        <label>Nomor</label>
        <input v-model="phone" placeholder="contoh: 62812xxxx" />
      </div>

      <div class="row" v-else>
        <label>Group</label>
        <select v-model="selectedGroupId">
          <option value="" disabled>Pilih group</option>
          <option v-for="g in groups" :key="g.value" :value="g.value">{{ g.label }}</option>
        </select>
        <button @click="loadGroups" :disabled="loadingGroups">{{ loadingGroups ? 'Memuat...' : 'Muat Ulang Grup' }}</button>
      </div>

      <div class="row">
        <label>Pesan</label>
        <textarea v-model="text" rows="4" placeholder="Tulis pesan..."></textarea>
      </div>

      <div class="row">
        <button @click="send" :disabled="sending">{{ sending ? 'Mengirim...' : 'Kirim' }}</button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="ok" class="ok">Pesan terkirim.</p>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { deviceApi, userApi } from '../api/http.js';

const targetType = ref('number');
const phone = ref('');
const groups = ref([]); // { value, label }
const selectedGroupId = ref('');
const text = ref('');
const sending = ref(false);
const loadingGroups = ref(false);
const error = ref('');
const ok = ref(false);

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
      // prefer full id that already includes hyphen if present in API
      value: normalizeGroupValue(g),
      label: g.subject || g.name || g.title || g.id || g.jid || 'Tanpa Nama',
      // keep helpers for later resolution
      meta: { id: g.id, shortId: g.shortId || g.idShort, jid: g.jid },
    }))
    .filter((g) => g.value);
};

const loadGroups = async () => {
  try {
    loadingGroups.value = true;
    error.value = '';
    // ensure device api key is available (interceptor does this lazily)
    await userApi.get('/devices').catch(() => {});
    // try detail endpoint first
    let res;
    try {
      res = await deviceApi.get('/messages/get-groups/detail');
    } catch (_) {
      res = await deviceApi.get('/messages/get-groups');
    }
    // backend returns an array or an object with results/data
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

// Ensure we have a full group JID (with hyphen). If selected id has no hyphen, resolve via API list.
const ensureFullGroupJid = async (jidOrId) => {
  let val = String(jidOrId || '').trim();
  if (!val) return '';
  // ensure domain
  if (!val.includes('@')) val = `${val}@g.us`;
  // if already contains hyphen, return
  if (val.split('@')[0].includes('-')) return val;

  // try direct lookup endpoint by id/shortId
  try {
    const clean = val.replace(/@g\.us$/i, '');
    const byId = await deviceApi.get(`/messages/get-groups/${encodeURIComponent(clean)}`);
    const full = byId?.data?.id || byId?.data?.jid || '';
    if (full && full.split('@')[0].includes('-')) return full.includes('@g.us') ? full : `${full}@g.us`;
  } catch (_) {
    // ignore and attempt list fallback
  }

  // fallback: fetch detail list and match shortId -> full id
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
  } catch (_) {
    // ignore
  }

  // return original as last resort (backend will validate)
  return val;
};

const validate = () => {
  if (!text.value.trim()) {
    error.value = 'Pesan tidak boleh kosong';
    return false;
  }
  if (targetType.value === 'number') {
    if (!phone.value.trim()) { error.value = 'Nomor wajib diisi'; return false; }
  } else {
    if (!selectedGroupId.value) { error.value = 'Pilih group'; return false; }
  }
  return true;
};

const send = async () => {
  if (!validate()) return;
  sending.value = true;
  ok.value = false;
  error.value = '';
  try {
    // resolve recipient
    let recipientValue;
    if (targetType.value === 'number') {
      recipientValue = String(phone.value).trim();
    } else {
      recipientValue = await ensureFullGroupJid(selectedGroupId.value);
    }

    const payload = [{
      recipient: recipientValue,
      message: { text: text.value },
    }];

    await deviceApi.post('/messages/send', payload);
    ok.value = true;
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Gagal mengirim pesan';
    // provide friendlier hint for invalid group jid
    error.value = /Invalid group JID/i.test(msg)
      ? 'ID grup tidak valid. Silakan pilih ulang grup dari daftar agar ID lengkap (dengan hyphen) terpakai.'
      : msg;
  } finally {
    sending.value = false;
  }
};

onMounted(() => {
  // prefetch groups for convenience
  loadGroups();
});
</script>

<style scoped>
.form { display: flex; flex-direction: column; gap: 12px; max-width: 720px; }
.row { display:flex; gap:8px; align-items:center; }
.row.small label { width: 120px; }
label { min-width: 80px; }
select, input, textarea { padding: 8px; width: 100%; max-width: 420px; }
.error { color: #b00020; }
.ok { color: #2e7d32; }
</style>