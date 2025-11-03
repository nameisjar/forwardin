import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const backend = env.VITE_API_BASE_URL || 'http://localhost:3000';

    // helper: bypass proxy for HTML navigations so Vue Router can handle client routes
    const bypassHtml = (req) => {
        const accept = req.headers && req.headers.accept;
        if (accept && accept.includes('text/html')) {
            return '/index.html';
        }
        return undefined;
    };

    return {
        plugins: [vue()],
        server: {
            port: 5173,
            strictPort: true,
            proxy: {
                // Device API (requires X-Forwardin-Key-Device). No need to bypass since UI never navigates to /api in the browser bar.
                '/api': { target: backend, changeOrigin: true },

                // Backend API routes grouped; bypass if it's a browser navigation (Accept: text/html)
                '^/(auth|devices|users|groups|templates|messages|broadcasts|campaigns|algorithmics|tutors|sessions|auto-replies|business-hours|privileges|subscription-plans|orders|analytics)$':
                    {
                        target: backend,
                        changeOrigin: true,
                        bypass: bypassHtml,
                    },
                // Also allow nested paths under those prefixes
                '^/(auth|devices|users|groups|templates|messages|broadcasts|campaigns|algorithmics|tutors|sessions|auto-replies|business-hours|privileges|subscription-plans|orders|analytics)/.*':
                    {
                        target: backend,
                        changeOrigin: true,
                        bypass: bypassHtml,
                    },

                // Contacts API - only API endpoints; SPA route /contacts should be handled by Vue, so bypass HTML
                '^/contacts$': { target: backend, changeOrigin: true, bypass: bypassHtml },
                '^/contacts/create$': { target: backend, changeOrigin: true },
                '^/contacts/import$': { target: backend, changeOrigin: true },
                '^/contacts/export-contacts$': { target: backend, changeOrigin: true },
                '^/contacts/sync-google$': { target: backend, changeOrigin: true },
                '^/contacts\\?': { target: backend, changeOrigin: true },
                '^/contacts/[a-f0-9-]{36}$': { target: backend, changeOrigin: true },
            },
        },
        build: {
            rollupOptions: {
                output: {
                    manualChunks: undefined,
                },
            },
        },
    };
});
