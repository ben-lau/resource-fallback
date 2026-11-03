<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { example, type Locale } from './home-copy';
import { data as traces, type Scenario, type TraceFrame } from './request-trace.data';

const props = defineProps<{ locale: Locale; guideLink: string }>();
const scenarios: Scenario[] = ['backup', 'origin', 'none'];
const stepDuration = 650;

const labels = {
  zh: {
    title: '请求演练',
    simulation: '模拟请求',
    play: '播放回退',
    finish: '查看结果',
    nodes: ['主 CDN', '备用 CDN', '源站'],
    states: {
      failed: '重试后失败',
      recovered: '已恢复',
      skipped: '未请求',
      requesting: '请求中',
      retrying: '重试中',
      switching: '切换中',
    },
    selector: '选择故障场景',
    options: { backup: '备用 CDN 可用', origin: '仅源站可用', none: '全部不可用' },
    log: '事件记录',
    waiting: '等待首个恢复事件。',
    guide: '故障排查',
    request: (node: string) => `正在请求 ${node} 上的资源。`,
    retry: (node: string, attempt: number) => `在 ${node} 上进行第 ${attempt} 次重试。`,
    fallback: (from: string, to: string) => `请求从 ${from} 切换到 ${to}。`,
    success: (node: string, attempts: number) => `第 ${attempts} 次尝试成功，资源来自${node}。`,
    error: (attempts: number) => `${attempts} 次尝试后，候选地址全部耗尽。`,
  },
  en: {
    title: 'Request replay',
    simulation: 'Simulation',
    play: 'Play trace',
    finish: 'Show result',
    nodes: ['Primary CDN', 'Backup CDN', 'Origin'],
    states: {
      failed: 'Retry failed',
      recovered: 'Recovered',
      skipped: 'Not requested',
      requesting: 'Requesting',
      retrying: 'Retrying',
      switching: 'Switching',
    },
    selector: 'Choose a failure scenario',
    options: { backup: 'Backup available', origin: 'Origin only', none: 'All unavailable' },
    log: 'Event log',
    waiting: 'Waiting for the first recovery event.',
    guide: 'Troubleshooting',
    request: (node: string) => `Requesting the asset from ${node}.`,
    retry: (node: string, attempt: number) => `${node} failed. Retrying the same URL (${attempt}).`,
    fallback: (from: string, to: string) => `Switching from ${from} to ${to}.`,
    success: (node: string, attempts: number) => `${node} recovered on attempt ${attempts}.`,
    error: (attempts: number) => `All destinations exhausted after ${attempts} attempts.`,
  },
};

const copy = computed(() => labels[props.locale]);
const scenario = ref<Scenario>('backup');
const interactive = ref(false);
const cursor = ref<number | null>(null);
const log = ref<HTMLDetailsElement>();
let timer: ReturnType<typeof setTimeout> | undefined;

const frames = computed(() => traces[scenario.value]);
const playing = computed(() => cursor.value !== null);
const frameIndex = computed(() => cursor.value ?? frames.value.length - 1);
const current = computed(() => frames.value[frameIndex.value]);
const events = computed(() => frames.value.slice(1, frameIndex.value + 1));

function stateAt(index: number) {
  const { node, kind } = current.value;
  if (index > node) return 'skipped';
  if (index < node || kind === 'error') return 'failed';
  if (kind === 'success') return 'recovered';
  if (kind === 'retry') return 'retrying';
  return kind === 'fallback' ? 'switching' : 'requesting';
}

function describe(frame: TraceFrame) {
  const { nodes } = copy.value;
  const node = nodes[frame.node];
  switch (frame.kind) {
    case 'request':
      return copy.value.request(node);
    case 'retry':
      return copy.value.retry(node, frame.attempt);
    case 'fallback':
      return copy.value.fallback(nodes[frame.from], node);
    case 'success':
      return copy.value.success(node, frame.attempts);
    case 'error':
      return copy.value.error(frame.attempts);
  }
}

function showResult() {
  clearTimeout(timer);
  cursor.value = null;
}

function advance() {
  if (cursor.value === null) return;
  const next = cursor.value + 1;
  if (next >= frames.value.length - 1) {
    showResult();
    return;
  }
  cursor.value = next;
  timer = setTimeout(advance, stepDuration);
}

function toggleReplay() {
  if (playing.value) {
    showResult();
  } else if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (log.value) log.value.open = true;
  } else {
    cursor.value = 0;
    timer = setTimeout(advance, stepDuration);
  }
}

watch(scenario, showResult, { flush: 'sync' });
onMounted(() => {
  interactive.value = true;
});
onUnmounted(() => clearTimeout(timer));
</script>

<template>
  <figure class="rf-trace" data-ui aria-labelledby="rf-trace-title">
    <figcaption class="trace-heading">
      <h2 id="rf-trace-title">{{ copy.title }}</h2>
      <p class="trace-request">
        <code>GET {{ example.path }}</code>
        <span>{{ copy.simulation }}</span>
      </p>
      <button v-if="interactive" type="button" class="trace-play" @click="toggleReplay">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M4 2.5v11L12 8z" />
          <path v-if="playing" d="M12 3h2v10h-2z" />
        </svg>
        {{ playing ? copy.finish : copy.play }}
      </button>
    </figcaption>

    <fieldset v-if="interactive" class="trace-options">
      <legend class="visually-hidden">{{ copy.selector }}</legend>
      <label v-for="option in scenarios" :key="option" class="trace-option">
        <input v-model="scenario" type="radio" name="rf-trace-scenario" :value="option" />
        <span>{{ copy.options[option] }}</span>
      </label>
    </fieldset>

    <div class="trace-track">
      <ol class="trace-path">
        <li
          v-for="(host, index) in example.hosts"
          :key="host"
          class="trace-node"
          :data-state="stateAt(index)"
          :aria-current="playing && index === current.node ? 'step' : undefined"
        >
          <span class="trace-marker" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none">
              <path class="trace-cross" d="m5 5 6 6m0-6-6 6" />
              <path class="trace-check" d="m4 8 2.5 2.5L12 5" />
            </svg>
          </span>
          <span class="trace-destination">
            <strong>{{ copy.nodes[index] }}</strong>
            <code>{{ host }}</code>
          </span>
          <span class="trace-state">{{ copy.states[stateAt(index)] }}</span>
        </li>
      </ol>
      <span
        v-if="playing"
        class="trace-signal"
        :style="{ '--trace-node': current.node }"
        aria-hidden="true"
        ><span :key="frameIndex"></span
      ></span>
    </div>

    <div class="trace-output">
      <p class="trace-result" :data-event="current.kind">
        <code v-if="current.kind !== 'request'">rf:{{ current.kind }}</code>
        <span>{{ describe(current) }}</span>
      </p>
      <span role="status" class="visually-hidden">{{ playing ? '' : describe(current) }}</span>

      <div class="trace-footer">
        <details ref="log" class="trace-log">
          <summary>
            {{ copy.log }} <span>({{ events.length }})</span>
          </summary>
          <div class="trace-log-entries" tabindex="0" role="region" :aria-label="copy.log">
            <ol v-if="events.length">
              <li v-for="(event, index) in events" :key="index" :data-event="event.kind">
                <code>rf:{{ event.kind }}</code>
                <span>{{ describe(event) }}</span>
              </li>
            </ol>
            <p v-else>{{ copy.waiting }}</p>
          </div>
        </details>
        <a :href="guideLink">
          {{ copy.guide }}
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
            <path d="M2 8h11m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.7" />
          </svg>
        </a>
      </div>
    </div>
  </figure>
</template>

<style scoped src="./request-trace.css"></style>
