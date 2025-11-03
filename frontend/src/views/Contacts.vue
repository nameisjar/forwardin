<template>
  <div class="wrapper">
    <h2>Kelola Kontak</h2>
    
    <!-- Device Selection Toolbar -->
    <div class="toolbar">
      <select v-model="selectedDeviceId" @change="onDeviceChange">
        <option value="">Pilih Perangkat</option>
        <option v-for="d in devices" :key="d.id" :value="d.id">{{ d.name || d.id }} — {{ d.status }}</option>
      </select>
      <!-- New: search box -->
      <input v-model="q" placeholder="Cari nama/nomor/label..." />
      <!-- Sort controls -->
      <select v-model="sortBy">
        <option value="createdAt">Terbaru</option>
        <option value="firstName">Nama Depan</option>
        <option value="lastName">Nama Belakang</option>
        <option value="phone">Nomor</option>
      </select>
      <select v-model="sortDir">
        <option value="desc">↓</option>
        <option value="asc">↑</option>
      </select>
      <select v-model.number="pageSize">
        <option :value="10">10</option>
        <option :value="25">25</option>
        <option :value="50">50</option>
        <option :value="100">100</option>
      </select>
      <button @click="showAddForm = true" class="btn-primary">+ Tambah Kontak</button>
      <button @click="loadContacts" :disabled="loading">{{ loading ? 'Memuat...' : 'Muat Ulang' }}</button>
      <!-- New: Import/Export Controls -->
      <button @click="triggerImport" :disabled="!selectedDeviceId || importBusy">{{ importBusy ? 'Mengimpor...' : 'Import' }}</button>
      <button @click="exportContactsFile" :disabled="!selectedDeviceId || exportBusy">{{ exportBusy ? 'Mengekspor...' : 'Export' }}</button>
      <input ref="fileInput" type="file" accept=".xlsx,.xls" style="display:none" @change="onImportFileChange" />
    </div>

    <!-- Contacts Table -->
    <div class="table-wrap" v-if="selectedDeviceId">
      <table>
        <thead>
          <tr>
            <th>Nama</th>
            <th>Nomor HP</th>
            <th>Nama Kelas</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="contact in visibleContacts" :key="contact.id">
            <td>{{ contact.firstName }} {{ contact.lastName || '' }}</td>
            <td>{{ contact.phone }}</td>
            <td>
              <div class="labels" v-if="contact.ContactLabel && filteredContactLabels(contact).length">
                <span v-for="label in filteredContactLabels(contact)" :key="label" class="label-chip">
                  {{ label }}
                </span>
              </div>
              <span v-else>-</span>
            </td>
            <td>
              <button @click="editContact(contact)" class="btn-small">Edit</button>
              <button @click="deleteContact(contact.id)" class="btn-small danger">Hapus</button>
            </td>
          </tr>
          <tr v-if="!loading && visibleContacts.length === 0">
            <td colspan="4" class="empty">{{ q ? 'Tidak ada hasil untuk pencarian.' : 'Belum ada kontak. Pilih perangkat dan tambah kontak baru.' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="pager">
        <button :disabled="page===1 || loading" @click="goPrev">Prev</button>
        <span>Hal {{ page }} / {{ meta.totalPages || 1 }}</span>
        <button :disabled="!meta.hasMore || loading" @click="goNext">Next</button>
      </div>
    </div>
    <div v-else class="empty-state">
      <p>Pilih perangkat untuk melihat dan mengelola kontak</p>
    </div>

    <!-- Add/Edit Contact Modal -->
    <div v-if="showAddForm || editingContact" class="modal-overlay" @click="cancelForm">
      <div class="modal" @click.stop>
        <h3>{{ editingContact ? 'Edit Kontak' : 'Tambah Kontak' }}</h3>
        <form @submit.prevent="saveContact">
          <div class="form-grid">
            <div class="field">
              <label>Nama Depan*</label>
              <input v-model="form.firstName" required />
            </div>
            <div class="field">
              <label>Nama Belakang</label>
              <input v-model="form.lastName" />
            </div>
            <div class="field">
              <label>Nomor HP*</label>
              <input v-model="form.phone" placeholder="cth: 628123456789" required />
            </div>
            <div class="field span-2">
              <label>Nama Kelas (Label)</label>
              <input v-model="labelInput" placeholder="cth: IND-PP-01-MON-19.00" />
            </div>
          </div>
          <div class="actions">
            <button type="button" @click="cancelForm">Batal</button>
            <button type="submit" :disabled="saving">{{ saving ? 'Menyimpan...' : 'Simpan' }}</button>
          </div>
        </form>
      </div>
    </div>

    <p v-if="msg" class="success">{{ msg }}</p>
    <p v-if="err" class="error">{{ err }}</p>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { userApi } from '../api/http.js';

const contacts = ref([]);
const devices = ref([]);
const selectedDeviceId = ref(localStorage.getItem('device_selected_id') || '');
const loading = ref(false);
const saving = ref(false);
const showAddForm = ref(false);
const editingContact = ref(null);
const msg = ref('');
const err = ref('');

// New: Import/Export state
const fileInput = ref(null);
const importBusy = ref(false);
const exportBusy = ref(false);

const form = ref({
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  gender: '',
  dob: '',
});
const labelInput = ref('');
const q = ref('');
let searchTimer;

// paging/sorting state
const page = ref(1);
const pageSize = ref(25);
const sortBy = ref('createdAt');
const sortDir = ref('desc');
const meta = ref({ totalContacts: 0, currentPage: 1, totalPages: 1, hasMore: false });

const fetchDevices = async () => {
  try {
    const { data } = await userApi.get('/devices');
    devices.value = Array.isArray(data) ? data : [];
  } catch { devices.value = []; }
};

const onDeviceChange = () => {
  localStorage.setItem('device_selected_id', selectedDeviceId.value);
  page.value = 1; // reset
  loadContacts();
};

const loadContacts = async () => {
  if (!selectedDeviceId.value) {
    console.log('❌ No device selected, cannot load contacts');
    return;
  }
  
  console.log('🔄 Loading contacts for device:', selectedDeviceId.value);
  loading.value = true;
  err.value = '';
  
  try {
    const { data } = await userApi.get('/contacts', {
      params: {
        deviceId: selectedDeviceId.value,
        ...(q.value ? { q: q.value } : {}),
        page: page.value,
        pageSize: pageSize.value,
        sortBy: sortBy.value,
        sortDir: sortDir.value,
      },
    });
    
    console.log('📋 Raw contacts response:', data);
    console.log('📊 Number of contacts received:', Array.isArray(data) ? data.length : 'Not an array');
    
    const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    contacts.value = list;
    meta.value = Array.isArray(data) ? {
      totalContacts: list.length,
      currentPage: 1,
      totalPages: 1,
      hasMore: false,
    } : (data?.metadata || meta.value);
    
    console.log('✅ Contacts loaded successfully:', contacts.value.length, 'items');
    contacts.value.forEach((contact, index) => {
      console.log(`   ${index + 1}. ${contact.firstName} ${contact.lastName || ''} - ${contact.phone}`);
    });
    
  } catch (e) {
    console.error('❌ Error loading contacts:', e);
    console.error('❌ Error response:', e?.response);
    err.value = e?.response?.data?.message || 'Gagal memuat kontak';
    contacts.value = []; // Reset contacts on error
    meta.value = { totalContacts: 0, currentPage: 1, totalPages: 1, hasMore: false };
  } finally {
    loading.value = false;
  }
};

const filteredContactLabels = (contact) => {
  const names = (contact.ContactLabel || []).map((l) => l.label?.name).filter(Boolean);
  return names.filter((n) => !String(n).startsWith('device_'));
};

// New: computed visibleContacts filtered by query (name/phone/label)
const visibleContacts = computed(() => {
  const term = String(q.value || '').trim().toLowerCase();
  if (!term) return contacts.value;
  return contacts.value.filter((c) => {
    const name = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
    const phone = String(c.phone || '').toLowerCase();
    const labels = filteredContactLabels(c).join(' ').toLowerCase();
    return name.includes(term) || phone.includes(term) || labels.includes(term);
  });
});

// Debounced server-side reload on search/sort/pageSize change
watch([q, sortBy, sortDir, pageSize], () => {
  page.value = 1; // reset to first page on criteria change
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadContacts(), 300);
});

const resetForm = () => {
  form.value = {
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    gender: '',
    dob: '',
  };
  labelInput.value = '';
  editingContact.value = null;
  showAddForm.value = false;
};

const cancelForm = () => {
  resetForm();
  msg.value = '';
  err.value = '';
};

const editContact = (contact) => {
  editingContact.value = contact;
  form.value = {
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    phone: contact.phone || '',
    email: '', // kosongkan email untuk tutor
    gender: '', // kosongkan gender untuk tutor
    dob: '', // kosongkan dob untuk tutor
  };
  // Pre-fill only non-device labels
  labelInput.value = filteredContactLabels(contact).join(', ');
};

const saveContact = async () => {
  if (!selectedDeviceId.value) {
    err.value = 'Pilih perangkat terlebih dahulu';
    return;
  }
  
  saving.value = true;
  err.value = '';
  msg.value = '';
  
  try {
    const labels = labelInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const payload = {
      ...form.value,
      // pastikan field opsional tetap kosong seperti permintaan
      email: '',
      gender: '',
      dob: '',
      labels,
      deviceId: selectedDeviceId.value,
    };
    
    console.log('🚀 Sending contact payload:', payload);
    console.log('📱 Selected device ID:', selectedDeviceId.value);
    
    let response;
    if (editingContact.value) {
      response = await userApi.put(`/contacts/${editingContact.value.id}`, payload);
      msg.value = 'Kontak berhasil diperbarui';
      console.log('✅ Contact updated:', response.data);
    } else {
      response = await userApi.post('/contacts/create', payload);
      msg.value = 'Kontak berhasil ditambahkan';
      console.log('✅ Contact created:', response.data);
    }
    
    // Reset form immediately
    resetForm();
    
    // Force reload contacts with better timing and error handling
    console.log('🔄 Reloading contacts after save...');
    
    // Try immediate reload first
    await loadContacts();
    
    // If no contacts found, try again after a short delay
    if (contacts.value.length === 0) {
      console.log('⏰ No contacts found, retrying after delay...');
      setTimeout(async () => {
        await loadContacts();
        
        // If still no contacts, try one more time
        if (contacts.value.length === 0) {
          console.log('⏰ Still no contacts, final retry...');
          setTimeout(async () => {
            await loadContacts();
          }, 1000);
        }
      }, 500);
    }
    
  } catch (e) {
    console.error('❌ Contact save error:', e);
    console.error('❌ Error response data:', e?.response?.data);
    console.error('❌ Error status:', e?.response?.status);
    
    const errorMsg = e?.response?.data?.message || e?.message || 'Gagal menyimpan kontak';
    
    if (e?.response?.status === 401) {
      err.value = 'Session expired. Silakan login ulang.';
    } else if (e?.response?.status === 403) {
      err.value = 'Tidak memiliki izin untuk mengelola kontak. Hubungi admin.';
    } else if (e?.response?.status === 404 && errorMsg.includes('Device')) {
      err.value = 'Perangkat tidak ditemukan. Pilih perangkat yang valid.';
    } else if (errorMsg.includes('already exists')) {
      err.value = 'Nomor HP sudah terdaftar di perangkat ini.';
    } else {
      err.value = `Error: ${errorMsg}`;
    }
  } finally {
    saving.value = false;
  }
};

const deleteContact = async (contactId) => {
  if (!confirm('Hapus kontak ini?')) return;
  
  try {
    await userApi.delete('/contacts', { data: { contactIds: [contactId] } });
    msg.value = 'Kontak berhasil dihapus';
    await loadContacts();
  } catch (e) {
    err.value = e?.response?.data?.message || 'Gagal menghapus kontak';
  }
};

// New: Import handlers
const triggerImport = () => {
  if (!selectedDeviceId.value) {
    err.value = 'Pilih perangkat terlebih dahulu';
    return;
  }
  err.value = '';
  msg.value = '';
  fileInput.value && fileInput.value.click();
};

const onImportFileChange = async (e) => {
  const file = e?.target?.files?.[0];
  if (!file) return;
  const MAX_SIZE_MB = 5; // simple guard
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    err.value = `Ukuran file melebihi ${MAX_SIZE_MB}MB`;
    e.target.value = '';
    return;
  }

  const defaultGroup = new Date().toISOString().slice(0,10);
  const groupName = (prompt('Nama grup untuk import (opsional):', `IMPORT_${defaultGroup}`) || '').trim();

  importBusy.value = true;
  err.value = '';
  msg.value = '';

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('deviceId', selectedDeviceId.value);
    if (groupName) formData.append('groupName', groupName);

    const { data } = await userApi.post('/contacts/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    const createdCount = Array.isArray(data?.results) ? data.results.length : 0;
    const errorCount = Array.isArray(data?.errors) ? data.errors.length : 0;
    msg.value = `Import selesai. Berhasil: ${createdCount}${errorCount ? `, Gagal: ${errorCount}` : ''}`;

    // reload contacts after import
    await loadContacts();
  } catch (e) {
    console.error('❌ Import error:', e);
    err.value = e?.response?.data?.message || 'Gagal mengimpor kontak';
  } finally {
    importBusy.value = false;
    if (e?.target) e.target.value = '';
  }
};

// New: Export handler
const exportContactsFile = async () => {
  if (!selectedDeviceId.value) {
    err.value = 'Pilih perangkat terlebih dahulu';
    return;
  }
  exportBusy.value = true;
  err.value = '';
  try {
    const response = await userApi.get('/contacts/export-contacts', {
      params: { deviceId: selectedDeviceId.value },
      responseType: 'blob',
    });

    const ct = response.headers?.['content-type'] || '';
    // If the server returned HTML, likely hitting the frontend (wrong API base). Stop and show help.
    if (typeof ct === 'string' && ct.includes('text/html')) {
      try {
        const txt = await response.data.text();
        console.warn('Unexpected HTML in export response:', txt?.slice(0, 200));
      } catch (_) {}
      throw new Error('Server mengembalikan HTML. Cek konfigurasi URL API.');
    }

    const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    // Try to get filename from header
    const cd = response.headers?.['content-disposition'] || '';
    const match = /filename\s*=\s*([^;]+)/i.exec(cd);
    const fallback = `Contacts_${new Date().toISOString().slice(0,10)}.xlsx`;
    const filename = match ? decodeURIComponent(match[1].replace(/\"/g, '').trim()) : fallback;

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    msg.value = 'Export dimulai. File sedang diunduh.';
  } catch (e) {
    console.error('❌ Export error:', e);
    err.value = e?.message || e?.response?.data?.message || 'Gagal mengekspor kontak';
  } finally {
    exportBusy.value = false;
  }
};

const goPrev = () => { if (page.value > 1) { page.value -= 1; loadContacts(); } };
const goNext = () => { if (meta.value.hasMore) { page.value += 1; loadContacts(); } };

onMounted(async () => {
  await fetchDevices();
  if (selectedDeviceId.value) {
    await loadContacts();
  }
});
</script>

<style scoped>
.wrapper { max-width: 1200px; }
.toolbar { display: flex; gap: 12px; margin: 16px 0; align-items: center; }
.toolbar select, .toolbar button, .toolbar input { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; }
.btn-primary { background: #0066cc; color: white; border-color: #0066cc; }
.btn-small { padding: 4px 8px; margin: 0 2px; font-size: 12px; border-radius: 4px; border: 1px solid #ccc; background: #f8f9fa; cursor: pointer; }
.btn-small.danger { background: #dc3545; color: white; border-color: #dc3545; }
.table-wrap { border: 1px solid #eee; border-radius: 8px; overflow: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 12px; text-align: left; border-bottom: 1px solid #f0f0f0; }
th { background: #f8f9fa; font-weight: 600; }
.empty { text-align: center; color: #666; padding: 24px; }
.empty-state { text-align: center; color: #666; padding: 48px; }
.labels { display: flex; flex-wrap: wrap; gap: 4px; }
.label-chip { background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 12px; font-size: 11px; }
.modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.modal { background: white; padding: 24px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 90vh; overflow-y: auto; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
.field { display: flex; flex-direction: column; }
.field label { margin-bottom: 4px; font-weight: 500; }
.field input, .field select { padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
.span-2 { grid-column: span 2; }
.actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; }
.actions button { padding: 8px 16px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; }
.actions button[type="submit"] { background: #0066cc; color: white; border-color: #0066cc; }
.success { color: #28a745; margin-top: 12px; }
.error { color: #dc3545; margin-top: 12px; }
.pager { display:flex; gap:12px; align-items:center; padding: 12px; }
</style>