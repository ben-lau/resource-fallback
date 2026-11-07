export type Locale = 'zh' | 'en';

export const example = {
  path: '/assets/app.js',
  hosts: ['cdn1.example.com', 'cdn2.example.com', 'app.example.com'],
  retries: 1,
};

export const exampleConfig = `resourceFallback({
  rules: [{
    base: 'https://${example.hosts[0]}/',
    urls: [
      'https://${example.hosts[1]}/',
      '/',
    ],
    retry: { max: ${example.retries} },
  }],
})`;

export const homeCopy = {
  zh: {
    title: '前端资源回退',
    summary: '为 Vite 和 Webpack 构建的资源提供运行时重试、备用 CDN 和回源。',
    start: '快速开始',
    explain: '看懂这次回退',
    caseTitle: '从演练到接入',
    caseBody:
      '示例先匹配主 CDN，重试失败后切换到备用 CDN，最后尝试页面源站。把这份规则里的地址换成你的部署前缀，就可以用自己的构建验证同样的流程。',
    caseLink: '对照配置与事件',
    directory: '按任务查阅',
    coverage: '测试覆盖率',
    license: 'MIT 许可证',
  },
  en: {
    title: 'Frontend asset fallback',
    summary: 'Runtime retries, backup CDNs, and origin recovery for Vite and Webpack assets.',
    start: 'Quick start',
    explain: 'Read the replay',
    caseTitle: 'Use the replay as a starting point',
    caseBody:
      'The rule matches the primary CDN, retries once, then tries the backup CDN and the page origin in order. Replace the prefixes with your deployment paths to verify the same sequence in your own build.',
    caseLink: 'Match the rule to the events',
    directory: 'Find the right guide',
    coverage: 'Test coverage',
    license: 'MIT license',
  },
};

export const guideEntries = {
  zh: [
    {
      title: '接入构建',
      body: '安装插件并用生产构建验证第一次回退。',
      links: [
        { label: 'Vite 集成', path: '/guide/vite' },
        { label: 'Webpack 集成', path: '/guide/webpack' },
      ],
    },
    {
      title: '排查失败请求',
      body: '按实际请求地址和运行时事件找出失败环节。',
      links: [
        { label: '故障排查', path: '/guide/troubleshooting' },
        { label: '运行时事件', path: '/guide/runtime-events' },
      ],
    },
    {
      title: '查阅接口',
      body: '核对回退顺序、重试预算、熔断和插件参数。',
      links: [
        { label: '配置参考', path: '/guide/configuration' },
        { label: 'API 参考', path: '/api/README' },
      ],
    },
  ],
  en: [
    {
      title: 'Set up your build',
      body: 'Install the plugin and verify the first fallback in a production build.',
      links: [
        { label: 'Vite integration', path: '/guide/vite' },
        { label: 'Webpack integration', path: '/guide/webpack' },
      ],
    },
    {
      title: 'Diagnose a failed request',
      body: 'Match the requested URLs to runtime events to see where recovery failed.',
      links: [
        { label: 'Troubleshooting', path: '/guide/troubleshooting' },
        { label: 'Runtime events', path: '/guide/runtime-events' },
      ],
    },
    {
      title: 'Look up the API',
      body: 'Check fallback order, retry budgets, circuit breakers, and plugin options.',
      links: [
        { label: 'Configuration', path: '/guide/configuration' },
        { label: 'API reference', path: '/api/README' },
      ],
    },
  ],
};
