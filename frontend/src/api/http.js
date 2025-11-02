import axios from 'axios';

// Use relative base during development so Vite proxy handles requests.
// In production, use VITE_API_BASE_URL if provided, else current origin.
const API_BASE =
    import.meta.env && import.meta.env.DEV
        ? ''
        : (import.meta.env && import.meta.env.VITE_API_BASE_URL) || window.location.origin;

// Lightweight global request scheduler to avoid bursts across all API instances
const MIN_INTERVAL_MS = Number(
    (import.meta.env && import.meta.env.VITE_API_MIN_INTERVAL_MS) || 300,
); // default ~3 req/s
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scheduler = (() => {
    const queue = [];
    let pumping = false;
    const schedule = () =>
        new Promise((resolve) => {
            queue.push(resolve);
            if (!pumping) pump();
        });
    const pump = () => {
        if (queue.length === 0) {
            pumping = false;
            return;
        }
        pumping = true;
        const resolve = queue.shift();
        resolve();
        setTimeout(pump, MIN_INTERVAL_MS);
    };
    return { schedule };
})();

// Simple retry/backoff helper for 429/503
async function maybeRetry(err, instance) {
    const config = err && err.config;
    const status = err && err.response && err.response.status;
    if (!config || !instance) throw err;
    // avoid retrying non-idempotent methods (POST)
    const method = (config.method || 'get').toLowerCase();
    if (!['get', 'delete', 'put', 'patch'].includes(method)) throw err;

    const shouldRetry = status === 429 || status === 503;
    if (!shouldRetry) throw err;

    config.__retryCount = (config.__retryCount || 0) + 1;
    const maxRetries = Number((import.meta.env && import.meta.env.VITE_API_MAX_RETRIES) || 3);
    if (config.__retryCount > maxRetries) throw err;

    // Honor Retry-After header (seconds) if present
    const ra =
        err.response &&
        (err.response.headers?.['retry-after'] || err.response.headers?.['Retry-After']);
    let delayMs = 0;
    if (ra) {
        const sec = Number(ra);
        delayMs = isNaN(sec) ? 0 : sec * 1000;
    }
    // Fallback exponential backoff with jitter
    if (!delayMs) {
        const base = 750 * Math.pow(2, config.__retryCount - 1);
        const jitter = Math.random() * 250;
        delayMs = base + jitter;
    }

    await sleep(delayMs);
    // Respect scheduler before retry
    await scheduler.schedule();
    return instance(config);
}

export const userApi = axios.create({ baseURL: API_BASE });

userApi.interceptors.request.use(async (config) => {
    // space out requests globally
    await scheduler.schedule();
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

userApi.interceptors.response.use(
    (r) => r,
    async (err) => {
        if (err && err.response && err.response.status === 401) {
            localStorage.removeItem('token');
            window.location.href = '/login';
            return Promise.reject(err);
        }
        // Retry/backoff
        try {
            return await maybeRetry(err, userApi);
        } catch (e) {
            return Promise.reject(e);
        }
    },
);

export const deviceApi = axios.create({ baseURL: API_BASE + '/api' });

deviceApi.interceptors.request.use(async (config) => {
    // space out requests globally
    await scheduler.schedule();
    let key = localStorage.getItem('device_api_key');
    if (!key) {
        try {
            const { data: devices } = await userApi.get('/devices');
            if (Array.isArray(devices) && devices.length) {
                const current = devices.find((d) => d.status === 'open') || devices[0];
                if (current && current.apiKey) {
                    key = current.apiKey;
                    localStorage.setItem('device_api_key', key);
                    localStorage.setItem('device_selected_id', current.id);
                    localStorage.setItem('device_selected_name', current.name || '');
                }
            }
        } catch (_) {
            // ignore
        }
    }
    if (key) config.headers['X-Forwardin-Key-Device'] = key;
    return config;
});

deviceApi.interceptors.response.use(
    (r) => r,
    async (err) => {
        if (err && err.response && err.response.status === 401) {
            console.warn('Device API unauthorized. Periksa API Key device dan sesi.');
            localStorage.removeItem('device_api_key');
            return Promise.reject(err);
        }
        // Retry/backoff for 429/503
        try {
            return await maybeRetry(err, deviceApi);
        } catch (e) {
            return Promise.reject(e);
        }
    },
);

export default { userApi, deviceApi };
