export type Locale = 'zh' | 'en';

export const example = {
  path: '/assets/app.js',
  hosts: ['cdn1.example.com', 'cdn2.example.com', 'app.example.com'],
  retries: 1,
};

const [primary, backup] = example.hosts;
const primaryUrl = { value: `https://${primary}`, path: example.path };
const backupUrl = { value: `https://${backup}`, path: example.path };

type RecoveryStep = {
  kind: string;
  symbol: string;
  fields: { name: string; value: string; path?: string }[];
} & Record<Locale, { title: string; body: string }>;

export const homeCopy = {
  zh: {
    title: ['前端资源', '自动回退'],
    summary: '为 Vite 和 Webpack 的静态资源提供运行时重试、多 CDN 回退和回源，业务代码无需改动。',
    start: '快速开始',
    process: '回退如何工作',
    processIntro: `下方以备用 CDN 可用为例，演示 app.js 的恢复过程。每个地址最多重试 ${example.retries} 次。`,
    directory: '文档索引',
    directoryIntro: '按构建工具完成接入，再查阅配置、资源覆盖范围和上线检查。',
    license: 'MIT 许可证',
    coverage: '测试覆盖率',
  },
  en: {
    title: ['Frontend', 'asset fallback'],
    summary:
      'Give Vite and Webpack assets runtime retries, backup CDNs, and origin recovery without changing application code.',
    start: 'Quick start',
    process: 'How fallback works',
    processIntro: `Follow app.js when the backup CDN is available. This example allows ${example.retries} retry per URL.`,
    directory: 'Documentation',
    directoryIntro:
      'Start with your build tool, then look up options, resource coverage, and production checks.',
    license: 'MIT license',
    coverage: 'Test coverage',
  },
};

export const recoverySteps: RecoveryStep[] = [
  {
    kind: 'match',
    symbol: 'FallbackRule',
    fields: [
      { name: 'base', value: `https://${primary}/` },
      { name: 'urls', value: `['https://${backup}/', '/']` },
    ],
    zh: {
      title: '匹配前缀',
      body: '资源 URL 命中规则的 base 才能进入回退链。多个前缀匹配时，优先用最长的。',
    },
    en: {
      title: 'Match the prefix',
      body: 'An asset URL enters the recovery chain when it matches a rule base. The longest matching prefix wins.',
    },
  },
  {
    kind: 'retry',
    symbol: 'rf:retry',
    fields: [
      { name: 'url', ...primaryUrl },
      { name: 'attempt', value: String(example.retries) },
    ],
    zh: {
      title: '在原地址重试',
      body: '按配置重试当前 URL。指数退避和抖动可以错开集中发出的请求。',
    },
    en: {
      title: 'Retry the same URL',
      body: 'Retry the current URL within the configured limit. Exponential backoff and jitter spread out retries.',
    },
  },
  {
    kind: 'switch',
    symbol: 'rf:fallback',
    fields: [
      { name: 'from', ...primaryUrl },
      { name: 'to', ...backupUrl },
    ],
    zh: { title: '切换候选', body: '当前地址耗尽后，按 urls 顺序选下一个可用候选，保留资源路径。' },
    en: {
      title: 'Try the next candidate',
      body: 'Once retries are exhausted, move to the next eligible URL prefix in order and keep the asset path.',
    },
  },
  {
    kind: 'result',
    symbol: 'rf:success',
    fields: [
      { name: 'url', ...backupUrl },
      { name: 'attempts', value: String(example.retries + 2) },
    ],
    zh: {
      title: '派发结果',
      body: '恢复成功时派发 rf:success。回退链耗尽时监听 rf:error，接入告警或降级界面。',
    },
    en: {
      title: 'Report the outcome',
      body: 'Recovery emits rf:success. Listen for rf:error when the chain is exhausted to alert or show a fallback UI.',
    },
  },
];

export const guideGroups = [
  {
    label: { zh: '接入与配置', en: 'Integration' },
    links: [
      {
        path: '/guide/vite',
        zh: { title: 'Vite 集成', body: '对齐 base，验证动态 import 和预加载依赖。' },
        en: {
          title: 'Vite integration',
          body: 'Align base and verify dynamic imports and preloaded dependencies.',
        },
      },
      {
        path: '/guide/webpack',
        zh: {
          title: 'Webpack 集成',
          body: '配置 publicPath，了解 chunk loader 和入口脚本的恢复路径。',
        },
        en: {
          title: 'Webpack integration',
          body: 'Set publicPath and trace how the chunk loader and entry scripts recover.',
        },
      },
      {
        path: '/guide/configuration',
        zh: { title: '配置参考', body: '查询匹配规则、重试与熔断的参数及默认值。' },
        en: {
          title: 'Configuration',
          body: 'Look up matching rules, retries, circuit breaking, and defaults.',
        },
      },
      {
        path: '/guide/service-worker',
        zh: {
          title: 'Hybrid Service Worker',
          body: '按需覆盖图片、字体、媒体和符合条件的 CSS 子资源。',
        },
        en: {
          title: 'Hybrid Service Worker',
          body: 'Opt in to image, font, media, and eligible CSS subresource recovery.',
        },
      },
    ],
  },
  {
    label: { zh: '上线与排查', en: 'Production' },
    links: [
      {
        path: '/guide/troubleshooting',
        zh: { title: '故障排查', body: '对照请求和事件，定位规则、候选地址或缓存问题。' },
        en: {
          title: 'Troubleshooting',
          body: 'Match requests and events to rule, destination, or cache issues.',
        },
      },
      {
        path: '/guide/runtime-events',
        zh: { title: '运行时事件', body: '读取 rf:* 事件，串起重试、切换和最终结果。' },
        en: {
          title: 'Runtime events',
          body: 'Read rf:* events to connect retries, switches, and outcomes.',
        },
      },
      {
        path: '/guide/csp-sri',
        zh: { title: 'CSP 与 SRI', body: '核对 nonce、外链 runtime 和完整性校验策略。' },
        en: {
          title: 'CSP and SRI',
          body: 'Check nonce, the external runtime, and integrity policies.',
        },
      },
      {
        path: '/guide/best-practices',
        zh: { title: '最佳实践', body: '验证生产构建、配置监控，并准备紧急关停。' },
        en: {
          title: 'Best practices',
          body: 'Verify production builds, set up monitoring, and prepare a kill switch.',
        },
      },
      {
        path: '/api/',
        zh: { title: 'API 参考', body: '查看从源码生成的函数、类型和 Service Worker 接口。' },
        en: {
          title: 'API reference',
          body: 'Browse generated functions, types, and Service Worker APIs.',
        },
      },
    ],
  },
];
