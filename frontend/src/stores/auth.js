import { defineStore } from 'pinia';
import { userApi } from '../api/http.js';

export const useAuthStore = defineStore('auth', {
    state: () => ({ me: null }),
    getters: {
        isAdmin: (state) => state.me?.privilege?.name === 'admin',
        roleName: (state) => state.me?.privilege?.name || '',
    },
    actions: {
        async fetchMe() {
            try {
                const { data } = await userApi.get('/tutors/me');
                this.me = data;
            } catch (_) {
                this.me = null;
            }
        },
    },
});
