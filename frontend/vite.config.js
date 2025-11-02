import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const backend = env.VITE_API_BASE_URL || 'http://localhost:3000';
    return {
        plugins: [vue()],
        server: {
            port: 5173,
            strictPort: true,
            proxy: {
                '/auth': { target: backend, changeOrigin: true },
                '/devices': { target: backend, changeOrigin: true },
                '/users': { target: backend, changeOrigin: true },
                '/api': { target: backend, changeOrigin: true },
                '/algorithmics': { target: backend, changeOrigin: true },
                '/tutors': { target: backend, changeOrigin: true },
            },
        },
    };
});
