<template>
  <div class="layout">
    <aside>
      <h3>My Algo</h3>
      <nav>
        <router-link to="/add-device">Tambah Device</router-link>
        <router-link to="/contacts">Kontak</router-link>
        <router-link to="/broadcasts">Broadcast</router-link>
        <router-link to="/schedule-feedback">Jadwal Feedback</router-link>
        <router-link to="/schedule-reminder">Jadwal Reminder Terjadwal</router-link>
        <router-link to="/schedules">Jadwal Saya</router-link>
        <!-- Admin-only menus -->
        <template v-if="isAdmin">
          <router-link to="/templates">Templates</router-link>
          <hr/>
          <router-link to="/admin/tutors">Kelola Tutor</router-link>
          <router-link to="/admin/sent-history">Semua Pesan Terkirim</router-link>
        </template>
      </nav>
      <div class="me" v-if="me">
        <small>Masuk sebagai: {{ me.firstName }}</small>
        <small v-if="me.privilege?.name === 'cs'"> (Tutor)</small>
        <small v-if="me.privilege?.name === 'admin'"> (Admin)</small>
      </div>
      <button class="logout" @click="logout">Logout</button>
    </aside>
    <main>
      <router-view />
    </main>
  </div>
</template>

<script setup>
import { onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const auth = useAuthStore();

onMounted(() => auth.fetchMe());
const me = computed(() => auth.me);
const isAdmin = computed(() => auth.isAdmin);

const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('device_api_key');
  localStorage.removeItem('device_selected_id');
  localStorage.removeItem('device_selected_name');
  router.push('/login');
};
</script>

<style scoped>
.layout { display: grid; grid-template-columns: 260px 1fr; height: 100%; }
aside { border-right: 1px solid #eee; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
nav { display: flex; flex-direction: column; gap: 8px; }
nav a { text-decoration: none; color: #333; padding: 6px 8px; border-radius: 6px; }
nav a.router-link-active { background: #f0f3ff; color: #3342b8; }
main { padding: 24px; overflow: auto; }
.logout { margin-top: auto; }
.me { margin-top: 8px; color:#666 }
</style>