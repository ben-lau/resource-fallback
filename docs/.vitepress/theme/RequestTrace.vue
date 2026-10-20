<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { example, type Locale } from './home-copy';

const props = defineProps<{ locale: Locale }>();
const scenarios = ['backup', 'origin', 'none'] as const;
type Scenario = (typeof scenarios)[number];

const labels = {
  zh: {
    title: '请求轨迹',
    example: '交互示例',
    nodes: ['主 CDN', '备用 CDN', '源站'],
    states: { failed: '重试后失败', recovered: '已恢复', skipped: '未请求' },
    selector: '可用的回退地址',
    options: { backup: '备用 CDN 可用', origin: '仅源站可用', none: '全部不可用' },
    result: {
      backup: '资源已从备用 CDN 加载。',
      origin: '资源已从页面源站加载。',
      none: '已用尽所有配置的地址。',
    },
  },
  en: {
    title: 'Request trace',
    example: 'Interactive example',
    nodes: ['Primary CDN', 'Backup CDN', 'Origin'],
    states: { failed: 'Failed after retry', recovered: 'Recovered', skipped: 'Not requested' },
    selector: 'Available fallback destination',
    options: { backup: 'Backup available', origin: 'Origin only', none: 'All unavailable' },
    result: {
      backup: 'Asset loaded from the backup CDN.',
      origin: 'Asset loaded from the page origin.',
      none: 'All configured addresses failed.',
    },
  },
};

const copy = computed(() => labels[props.locale]);
const scenario = ref<Scenario>('backup');
const interactive = ref(false);

const recoveryIndex = computed(() => ['primary', 'backup', 'origin'].indexOf(scenario.value));
const rows = computed(() =>
  example.hosts.map((host, index) => {
    if (index === recoveryIndex.value) return { host, state: 'recovered' as const };
    if (recoveryIndex.value >= 0 && index > recoveryIndex.value)
      return { host, state: 'skipped' as const };
    return { host, state: 'failed' as const };
  }),
);

onMounted(() => {
  interactive.value = true;
});
</script>

<template>
  <figure class="rf-trace" data-ui aria-labelledby="rf-trace-title">
    <figcaption class="trace-heading">
      <h2 id="rf-trace-title">{{ copy.title }}</h2>
      <span>{{ copy.example }}</span>
    </figcaption>
    <p class="trace-request">
      <code>GET {{ example.path }}</code>
    </p>

    <ol class="trace-path">
      <li v-for="(row, index) in rows" :key="row.host" class="trace-node" :data-state="row.state">
        <span class="trace-marker" aria-hidden="true"></span>
        <span class="trace-destination">
          <strong>{{ copy.nodes[index] }}</strong>
          <code>{{ row.host }}</code>
        </span>
        <span class="trace-state">{{ copy.states[row.state] }}</span>
      </li>
    </ol>

    <fieldset v-if="interactive" class="trace-options">
      <legend class="visually-hidden">{{ copy.selector }}</legend>
      <label v-for="option in scenarios" :key="option" class="trace-option">
        <input v-model="scenario" type="radio" name="rf-trace-scenario" :value="option" />
        <span>{{ copy.options[option] }}</span>
      </label>
    </fieldset>

    <p class="trace-result" role="status">
      <code>{{ scenario === 'none' ? 'rf:error' : 'rf:success' }}</code>
      <span>{{ copy.result[scenario] }}</span>
    </p>
  </figure>
</template>

<style scoped>
.rf-trace {
  position: relative;
  display: grid;
  align-content: center;
  gap: 14px;
  min-block-size: 25rem;
  margin: 0;
  padding: clamp(20px, 2.55vw, 40px);
  background: var(--rf-console);
  color: var(--rf-console-text);
  clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 0 100%);
}

.rf-trace code {
  font-family: var(--vp-font-family-mono);
}

.trace-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.trace-heading h2 {
  font-size: clamp(1.375rem, 2.05vw, 2rem);
  font-weight: 650;
  line-height: 1.25;
}

.trace-heading > span {
  color: var(--rf-console-muted);
  font-size: 0.875rem;
}

.trace-request {
  padding: 7px 14px;
  background: var(--rf-console-layer);
  font-size: clamp(0.9375rem, 1.3vw, 1.25rem);
  line-height: 1.45;
}

.trace-path {
  display: grid;
  gap: 10px;
  padding: 4px 0;
}

.trace-node {
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: start;
  gap: 14px;
}

.trace-node:not(:last-child)::after {
  position: absolute;
  inset-block: 12px -22px;
  inset-inline-start: 8px;
  width: 2px;
  background: var(--rf-console-accent);
  content: '';
}

.trace-node[data-state='recovered']::after,
.trace-node[data-state='skipped']::after {
  background: var(--rf-console-idle);
}

.trace-marker {
  z-index: 1;
  place-self: start center;
  width: 10px;
  height: 10px;
  margin-top: 8px;
  background: var(--rf-console-accent);
}

.trace-node[data-state='recovered'] .trace-marker {
  width: 14px;
  height: 14px;
  margin-top: 6px;
  border-radius: 50%;
}

.trace-node[data-state='skipped'] .trace-marker {
  border: 2px solid var(--rf-console-idle);
  border-radius: 50%;
  background: var(--rf-console);
}

.trace-destination {
  display: grid;
  gap: 2px;
  line-height: 1.4;
}

.trace-destination strong {
  font-weight: 650;
}

.trace-destination code,
.trace-state {
  color: var(--rf-console-muted);
  font-size: 0.875rem;
}

.trace-state {
  text-align: end;
}

.trace-node[data-state='recovered'] .trace-state {
  color: var(--rf-console-accent);
  font-weight: 650;
}

.trace-options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 5px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.trace-option {
  position: relative;
  min-width: 0;
  cursor: pointer;
}

.trace-option input {
  position: absolute;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: inherit;
}

.trace-option span {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 44px;
  padding: 5px;
  background: var(--rf-console-layer);
  font-size: clamp(0.8125rem, 1vw, 0.9375rem);
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
}

.trace-option input:checked + span {
  background: var(--rf-console-accent);
  color: var(--rf-console);
}

.trace-option input:focus-visible + span {
  outline: 2px solid var(--rf-console-text);
  outline-offset: 2px;
}

.trace-option input:hover + span {
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (prefers-reduced-motion: no-preference) {
  .trace-option input:active + span {
    transform: translateY(1px);
  }

  .trace-node[data-state='recovered'] .trace-marker {
    animation: trace-arrival 260ms ease-out;
  }

  @keyframes trace-arrival {
    from {
      opacity: 0.5;
      transform: scale(0.75);
    }
  }
}

.trace-result {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 12px;
  color: var(--rf-console-text);
  font-size: 0.9375rem;
  line-height: 1.5;
}

.trace-result code {
  color: var(--rf-console-accent);
}

@media (max-width: 479px) {
  .rf-trace {
    min-block-size: 0;
    gap: 12px;
  }

  .trace-node {
    gap: 8px;
  }
}

@media (forced-colors: active) {
  .trace-option input:checked + span {
    border: 2px solid SelectedItem;
  }

  .trace-marker {
    forced-color-adjust: none;
  }
}
</style>
