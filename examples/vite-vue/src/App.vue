<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';

interface RfEvent {
  ts: number;
  type: string;
  detail: unknown;
}

const CIRCUIT_KEY = '__rf_circuit__';

const events = ref<RfEvent[]>([]);
const circuit = ref<Record<string, unknown>>({});
const subscribers: Array<() => void> = [];

function listen(type: string) {
  const handler = (e: Event) => {
    events.value = events.value.concat({
      ts: Date.now(),
      type: type.slice(3),
      detail: (e as CustomEvent).detail,
    });
  };
  window.addEventListener(type, handler);
  subscribers.push(() => window.removeEventListener(type, handler));
}

function refreshCircuit() {
  try {
    const raw = localStorage.getItem(CIRCUIT_KEY);
    circuit.value = raw ? JSON.parse(raw) : {};
  } catch { circuit.value = {}; }
}

function clearCircuit() {
  localStorage.removeItem(CIRCUIT_KEY);
  refreshCircuit();
}

let timer: ReturnType<typeof setInterval>;

onMounted(() => {
  const buffered = (window as any).__RF_EVENTS__ || [];
  events.value = [...buffered];

  listen('rf:retry');
  listen('rf:fallback');
  listen('rf:success');
  listen('rf:error');

  refreshCircuit();
  const onStorage = (e: StorageEvent) => { if (e.key === CIRCUIT_KEY) refreshCircuit(); };
  window.addEventListener('storage', onStorage);
  subscribers.push(() => window.removeEventListener('storage', onStorage));
  timer = setInterval(refreshCircuit, 1000);
});

onUnmounted(() => { subscribers.forEach((off) => off()); clearInterval(timer); });

const typeColors: Record<string, string> = {
  retry: '#b08000',
  fallback: '#c25e00',
  success: '#0f7d2a',
  error: '#b00020',
};
</script>

<template>
  <main style="font-family: system-ui, sans-serif; padding: 24px; max-width: 960px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #fff; padding: 20px; border-radius: 8px; margin-bottom: 16px;">
      <h1 style="margin: 0;">resource-fallback · vite-vue demo</h1>
      <p style="margin-top: 8px; opacity: 0.9; font-size: 14px;">
        如果你看到这个页面，说明 JS + CSS 都已成功从 origin 回退加载。
      </p>
    </div>

    <!-- 配置概览 -->
    <div style="border: 1px solid #e1e4e8; border-radius: 8px; padding: 16px; margin-bottom: 16px; font-size: 13px;">
      <strong>配置</strong>
      <table style="margin-top: 8px; border-collapse: collapse; width: 100%;">
        <tbody>
          <tr><td style="padding: 2px 8px; color: #888;">Primary</td><td><code>http://cdn-primary.example.invalid/</code> — DNS 不存在</td></tr>
          <tr><td style="padding: 2px 8px; color: #888;">Secondary</td><td><code>http://cdn-secondary.example.invalid/</code> — DNS 不存在</td></tr>
          <tr><td style="padding: 2px 8px; color: #888;">Backup</td><td><code>http://cdn-backup.example.invalid/</code> — DNS 不存在</td></tr>
          <tr><td style="padding: 2px 8px; color: #888;">Origin</td><td><code>/</code> — 同源</td></tr>
          <tr><td style="padding: 2px 8px; color: #888;">每 URL 重试</td><td>1 次 · baseDelay 300ms</td></tr>
          <tr><td style="padding: 2px 8px; color: #888;">熔断器</td><td>threshold=2 · cooldown=15s · TTL=60s</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 熔断器状态 -->
    <div style="border: 1px solid #e1e4e8; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <strong>熔断器</strong>
        <button @click="clearCircuit" style="font-size: 12px; cursor: pointer; padding: 2px 10px; border: 1px solid #ddd; border-radius: 4px;">清除</button>
        <button @click="refreshCircuit" style="font-size: 12px; cursor: pointer; padding: 2px 10px; border: 1px solid #ddd; border-radius: 4px;">刷新</button>
      </div>
      <p v-if="Object.keys(circuit).length === 0" style="color: #888; font-size: 13px; margin-top: 8px;">无记录</p>
      <table v-else style="font-size: 13px; border-collapse: collapse; width: 100%; margin-top: 8px;">
        <thead>
          <tr style="text-align: left; border-bottom: 2px solid #eee;">
            <th style="padding: 4px 8px;">Host</th>
            <th style="padding: 4px 8px;">Fails</th>
            <th style="padding: 4px 8px;">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(v, host) in circuit" :key="host" style="border-bottom: 1px solid #f0f0f0;">
            <td style="padding: 4px 8px; font-family: monospace; font-size: 12px;">{{ host }}</td>
            <td style="padding: 4px 8px;">{{ (v as any).fails }}</td>
            <td style="padding: 4px 8px;">
              <span
                :style="{ color: (v as any).openedAt > 0 ? '#b00020' : '#0f7d2a', fontWeight: 600, fontSize: '12px', padding: '2px 8px', borderRadius: '12px', background: (v as any).openedAt > 0 ? '#fdd' : '#dfd' }"
              >{{ (v as any).openedAt > 0 ? 'OPEN' : 'CLOSED' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 路由导航 -->
    <div style="border: 1px solid #e1e4e8; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <strong>路由（异步 chunk）</strong>
      <p style="font-size: 13px; color: #555; margin: 8px 0;">
        切换路由加载异步组件。先 Home → About → About2，观察熔断器变化。
      </p>
      <nav style="display: flex; gap: 12px; margin-bottom: 12px;">
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/about" data-testid="link-about">About</RouterLink>
        <RouterLink to="/about2" data-testid="link-about2">About2</RouterLink>
      </nav>
      <RouterView />
    </div>

    <!-- 事件日志 -->
    <div style="border: 1px solid #e1e4e8; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
      <strong>运行时事件 ({{ events.length }})</strong>
      <p style="font-size: 12px; color: #888; margin: 4px 0 8px;">
        包含页面加载时的事件 — 通过 window.__RF_EVENTS__ 缓冲捕获。
      </p>
      <div style="background: #f8f8f8; padding: 12px; border-radius: 6px; font-size: 12px; max-height: 360px; overflow: auto;">
        <p v-if="events.length === 0" style="color: #888; margin: 0;">无事件</p>
        <table v-else style="border-collapse: collapse; width: 100%;">
          <thead>
            <tr style="text-align: left; border-bottom: 1px solid #ddd;">
              <th style="padding: 2px 6px;">#</th>
              <th style="padding: 2px 6px;">Type</th>
              <th style="padding: 2px 6px;">Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in events" :key="i" style="border-bottom: 1px solid #f0f0f0;">
              <td style="padding: 2px 6px; color: #aaa;">{{ i + 1 }}</td>
              <td style="padding: 2px 6px; font-weight: 600;" :style="{ color: typeColors[e.type] || '#333' }">{{ e.type.toUpperCase() }}</td>
              <td style="padding: 2px 6px;"><code style="word-break: break-all;">{{ JSON.stringify(e.detail) }}</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 测试指南 -->
    <div style="border: 1px solid #e1e4e8; border-radius: 8px; padding: 16px; background: #fffde7; font-size: 13px;">
      <strong>测试场景</strong>
      <ol style="padding-left: 20px; margin: 8px 0 0;">
        <li><b>JS + CSS 回退</b>：刷新，看 Network 中 JS 和 CSS 从 <code>.invalid</code> → <code>/</code></li>
        <li><b>熔断跳闸</b>：切换 About → About2，观察后者跳过已熔断的 CDN</li>
        <li><b>熔断冷却</b>：等 15 秒后切换路由</li>
        <li><b>跨 Tab</b>：新 Tab 打开同一页面</li>
        <li><b>手动重置</b>：点「清除」后刷新</li>
      </ol>
    </div>
  </main>
</template>
