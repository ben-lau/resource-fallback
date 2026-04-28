import { createApp, defineAsyncComponent } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import App from './App.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: () => import('./Home.vue') },
    {
      path: '/about',
      component: defineAsyncComponent(() => import('./About.vue')),
    },
    {
      path: '/about2',
      component: defineAsyncComponent(() => import('./About2.vue')),
    },
  ],
});

createApp(App).use(router).mount('#app');
