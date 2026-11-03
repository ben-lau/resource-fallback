export type Locale = 'zh' | 'en';

export const example = {
  path: '/assets/app.js',
  hosts: ['cdn1.example.com', 'cdn2.example.com', 'app.example.com'],
  retries: 1,
};

export const homeCopy = {
  zh: {
    title: '前端资源回退',
    summary: 'Vite 与 Webpack 静态资源的运行时重试、CDN 回退与回源。',
    start: '快速开始',
    directory: '阅读路线',
    coverage: '测试覆盖率',
    license: 'MIT 许可证',
  },
  en: {
    title: 'Frontend asset fallback',
    summary: 'Runtime retries, backup CDNs, and origin recovery for Vite and Webpack assets.',
    start: 'Quick start',
    directory: 'Reading routes',
    coverage: 'Test coverage',
    license: 'MIT license',
  },
};

type ReadingRoute = {
  file: string;
  code: string;
} & Record<
  Locale,
  {
    title: string;
    body: string;
    links: { label: string; path: string }[];
  }
>;

export const readingRoutes: ReadingRoute[] = [
  {
    file: 'vite.config.ts',
    code: `resourceFallback({
  rules: [{
    base: 'https://${example.hosts[0]}/',
    urls: [
      'https://${example.hosts[1]}/',
      '/',
    ],
    retry: { max: ${example.retries} },
  }],
})`,
    zh: {
      title: '接入构建',
      body: '为构建产物指定匹配前缀和候选地址，再验证主 CDN 失效后的加载结果。',
      links: [
        { label: '快速开始', path: '/guide/quick-start' },
        { label: 'Webpack 接入', path: '/guide/webpack' },
      ],
    },
    en: {
      title: 'Set up the build',
      body: 'Match the deployed asset prefix, set the fallback order, and test a primary CDN outage.',
      links: [
        { label: 'Quick start', path: '/guide/quick-start' },
        { label: 'Webpack setup', path: '/guide/webpack' },
      ],
    },
  },
  {
    file: 'fallback-events.js',
    code: `window.addEventListener(
  'rf:fallback',
  ({ detail }) => {
    console.log(detail.from, detail.to);
  },
);`,
    zh: {
      title: '定位故障',
      body: '沿着运行时事件检查请求经过哪些地址、在哪里恢复，以及何时耗尽候选。',
      links: [
        { label: '故障排查', path: '/guide/troubleshooting' },
        { label: '运行时事件', path: '/guide/runtime-events' },
      ],
    },
    en: {
      title: 'Trace a failure',
      body: 'Follow runtime events to see which URLs were tried, where recovery succeeded, or when the chain ran out.',
      links: [
        { label: 'Troubleshooting', path: '/guide/troubleshooting' },
        { label: 'Runtime events', path: '/guide/runtime-events' },
      ],
    },
  },
  {
    file: 'FallbackRule',
    code: `interface FallbackRule {
  base: string;
  urls: string[];
  retry?: RetryOptions;
  circuit?: CircuitOptions;
}`,
    zh: {
      title: '查阅接口',
      body: '查阅回退规则、重试预算、熔断策略和插件参数的类型与默认值。',
      links: [
        { label: '配置参考', path: '/guide/configuration' },
        { label: 'API', path: '/api/' },
      ],
    },
    en: {
      title: 'Look up the API',
      body: 'Find types and defaults for fallback rules, retry budgets, circuit breakers, and plugin options.',
      links: [
        { label: 'Configuration', path: '/guide/configuration' },
        { label: 'API', path: '/api/' },
      ],
    },
  },
];
