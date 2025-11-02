<template>
  <div class="auth">
    <h2>Login</h2>
    <form @submit.prevent="login">
      <label>
        email/username
        <input v-model="identifier" placeholder="email or username" />
      </label>
      <label>
        Password
        <input v-model="password" type="password" placeholder="password" />
      </label>
      <button :disabled="loading">{{ loading ? 'Signing in...' : 'Login' }}</button>
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
.auth { max-width: 420px; margin: 64px auto; padding: 24px; border: 1px solid #eee; border-radius: 8px; }
label { display: block; margin: 12px 0; }
input { width: 100%; padding: 10px; }
button { width: 100%; padding: 10px; margin-top: 12px; }
.error { color: #c00; }
</style>