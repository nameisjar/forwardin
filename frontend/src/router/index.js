import { createRouter, createWebHistory } from 'vue-router';
import Login from '../views/Login.vue';
import Dashboard from '../views/Dashboard.vue';
import AddDevice from '../views/AddDevice.vue';
import ScheduleFeedback from '../views/ScheduleFeedback.vue';
import ScheduleReminder from '../views/ScheduleReminder.vue';
import SentHistory from '../views/SentHistory.vue';
import Templates from '../views/Templates.vue';
import AdminTutors from '../views/AdminTutors.vue';
import AdminSentHistory from '../views/AdminSentHistory.vue';
import SendMessage from '../views/SendMessage.vue';
import Schedules from '../views/Schedules.vue';
import Broadcasts from '../views/Broadcasts.vue';
import Contacts from '../views/Contacts.vue';
import { userApi } from '../api/http.js';

const routes = [
    { path: '/login', name: 'login', component: Login },
    {
        path: '/',
        component: Dashboard,
        children: [
            { path: '', redirect: '/add-device' },
            { path: 'add-device', name: 'add-device', component: AddDevice },
            { path: 'pairing', redirect: { name: 'add-device' } },
            { path: 'contacts', name: 'contacts', component: Contacts },
            { path: 'schedule-feedback', name: 'schedule-feedback', component: ScheduleFeedback },
            { path: 'schedule-reminder', name: 'schedule-reminder', component: ScheduleReminder },
            { path: 'schedules', name: 'schedules', component: Schedules },
            { path: 'broadcasts', name: 'broadcasts', component: Broadcasts },
            // keep legacy paths but protect as admin-only
            {
                path: 'sent-history',
                name: 'sent-history',
                component: SentHistory,
                meta: { requiresAdmin: true },
            },
            {
                path: 'templates',
                name: 'templates',
                component: Templates,
                meta: { requiresAdmin: true },
            },
            // admin routes
            {
                path: 'admin/tutors',
                name: 'admin-tutors',
                component: AdminTutors,
                meta: { requiresAdmin: true },
            },
            {
                path: 'admin/sent-history',
                name: 'admin-sent-history',
                component: AdminSentHistory,
                meta: { requiresAdmin: true },
            },
            {
                path: 'send-message',
                name: 'send-message',
                component: SendMessage,
                meta: { requiresAdmin: true },
            },
        ],
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

router.beforeEach(async (to, _from, next) => {
    const token = localStorage.getItem('token');
    if (to.name !== 'login' && !token) {
        next({ name: 'login' });
        return;
    }
    if (to.name === 'login' && token) {
        next({ name: 'add-device' });
        return;
    }

    if (to.meta && to.meta.requiresAdmin) {
        try {
            const { data } = await userApi.get('/tutors/me');
            const isAdmin = data?.privilege?.name === 'admin';
            if (!isAdmin) {
                next({ name: 'add-device' });
                return;
            }
        } catch (_) {
            next({ name: 'login' });
            return;
        }
    }

    next();
});

export default router;
