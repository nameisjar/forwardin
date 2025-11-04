<template>
  <div class="wrapper auth">
    <h2>Login</h2>
    <form @submit.prevent="login" class="card form">
      <label class="field">
        <span>email/username</span>
        <input v-model="identifier" placeholder="email or username" />
      </label>
      <label class="field">
        <span>Password</span>
        <input v-model="password" type="password" placeholder="password" />
      </label>
      <button class="btn primary" :disabled="loading">{{ loading ? 'Signing in...' : 'Login' }}</button>
      <p v-if="error" class="error">{{ error }}</p>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { userApi } from '../api/http.js';

const router = useRouter();
const identifier = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');

const login = async () => {
  error.value = '';
  loading.value = true;
  try {
    const { data } = await userApi.post('/auth/login', {
      identifier: identifier.value,
      password: password.value
    });
    localStorage.setItem('token', data.accessToken);
    router.push('/');
  } catch (e) {
    error.value = (e && e.response && e.response.data && e.response.data.message) || 'Login failed';
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.wrapper { max-width: 420px; margin: 64px auto; }
.card { background: #fff; border: 1px solid #eaeaea; border-radius: 12px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); padding: 16px; }
.form { display: flex; flex-direction: column; gap: 10px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 12px; color: #667085; }
.field input { padding: 10px; border: 1px solid #d8dde6; border-radius: 8px; }
.btn { height: 40px; padding: 0 12px; border: 1px solid #2563eb; background: #2563eb; color: #fff; border-radius: 8px; cursor: pointer; font-weight: 500; }
.btn:disabled { opacity: .7; cursor: default; }
.error { color: #c00; }
</style>