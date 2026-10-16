import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(
  defineConfig({
    base: '/resource-fallback/',
    title: 'Resource Fallback',
    description: '为 Vite 和 Webpack 构建产物提供运行时重试、多 CDN 回退和回源。',

    head: [['link', { rel: 'icon', href: '/resource-fallback/logo.svg' }]],

    lastUpdated: true,
    cleanUrls: true,

    srcExclude: [
      'superpowers/**',
      'experience-report.zh-CN.md',
      'sw-resource-fallback-comparison.zh-CN.md',
    ],

    markdown: {
      lineNumbers: true,
      config(md) {
        md.core.ruler.after('anchor', 'resource-fallback-api-anchor', (state) => {
          if (!/(^|\/)api\/types\.md$/.test(state.env.relativePath ?? '')) return;

          // TypeDoc links to a suffixed re-export anchor while VitePress uses the heading slug.
          const index = state.tokens.findIndex(
            (token) => token.attrGet('id') === 'htmltagattributes',
          );
          if (
            index === -1 ||
            state.tokens.some((token) => token.attrGet('id') === 'htmltagattributes-1')
          )
            return;

          const alias = new state.Token('html_block', '', 0);
          alias.content = '<span id="htmltagattributes-1" aria-hidden="true"></span>\n';
          state.tokens.splice(index, 0, alias);
        });
      },
    },

    themeConfig: {
      logo: '/logo.svg',
      socialLinks: [{ icon: 'github', link: 'https://github.com/ben-lau/resource-fallback' }],
      search: {
        provider: 'local',
        options: {
          locales: {
            root: {
              translations: {
                button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
                modal: {
                  displayDetails: '显示详情',
                  resetButtonTitle: '清除搜索',
                  backButtonTitle: '返回',
                  noResultsText: '没有找到结果',
                  footer: {
                    selectText: '打开',
                    selectKeyAriaLabel: '回车键',
                    navigateText: '切换结果',
                    navigateUpKeyAriaLabel: '向上键',
                    navigateDownKeyAriaLabel: '向下键',
                    closeText: '关闭',
                    closeKeyAriaLabel: 'Esc 键',
                  },
                },
              },
            },
          },
        },
      },
      editLink: {
        pattern: 'https://github.com/ben-lau/resource-fallback/edit/main/docs/:path',
      },
    },

    locales: {
      root: {
        label: '简体中文',
        lang: 'zh-CN',
        themeConfig: {
          nav: zhNav(),
          sidebar: zhSidebar(),
          outline: { label: '本页目录' },
          lastUpdated: { text: '最后更新' },
          editLink: {
            text: '在 GitHub 上编辑此页',
            pattern: 'https://github.com/ben-lau/resource-fallback/edit/main/docs/:path',
          },
          docFooter: { prev: '上一篇', next: '下一篇' },
          returnToTopLabel: '返回顶部',
          sidebarMenuLabel: '文档目录',
          darkModeSwitchLabel: '外观',
          langMenuLabel: '切换语言',
        },
      },
      en: {
        label: 'English',
        lang: 'en-US',
        description:
          'Runtime retries, CDN fallback, and origin recovery for Vite and Webpack builds.',
        themeConfig: {
          nav: enNav(),
          sidebar: enSidebar(),
          editLink: {
            text: 'Edit this page on GitHub',
            pattern: 'https://github.com/ben-lau/resource-fallback/edit/main/docs/:path',
          },
        },
      },
    },

    vite: {
      ssr: {
        noExternal: ['vitepress-plugin-mermaid', 'mermaid'],
      },
      optimizeDeps: {
        include: ['mermaid'],
      },
    },

    mermaid: {},
  }),
);

function zhNav() {
  return [
    { text: '指南', link: '/guide/introduction', activeMatch: '/guide/' },
    {
      text: '深入',
      items: [
        { text: '开发经验', link: '/experience/' },
        { text: 'SW 设计对比', link: '/design/sw-comparison' },
      ],
    },
    { text: 'API', link: '/api/', activeMatch: '/api/' },
    { text: '更新日志', link: '/changelog' },
  ];
}

function enNav() {
  return [
    { text: 'Guide', link: '/en/guide/introduction', activeMatch: '/en/guide/' },
    {
      text: 'Deep Dive',
      items: [
        { text: 'Dev Experience', link: '/en/experience/' },
        { text: 'SW Design', link: '/en/design/sw-comparison' },
      ],
    },
    { text: 'API', link: '/en/api/', activeMatch: '/en/api/' },
    { text: 'Changelog', link: '/en/changelog' },
  ];
}

function zhSidebar() {
  return {
    '/guide/': [
      {
        text: '开始使用',
        items: [
          { text: '简介', link: '/guide/introduction' },
          { text: '快速开始', link: '/guide/quick-start' },
        ],
      },
      {
        text: '构建工具集成',
        items: [
          { text: 'Vite', link: '/guide/vite' },
          { text: 'Webpack', link: '/guide/webpack' },
          { text: '配置参考', link: '/guide/configuration' },
          { text: 'Hybrid Service Worker', link: '/guide/service-worker' },
        ],
      },
      {
        text: '上线与排查',
        items: [
          { text: '运行时事件', link: '/guide/runtime-events' },
          { text: 'CSP 与 SRI', link: '/guide/csp-sri' },
          { text: '最佳实践', link: '/guide/best-practices' },
        ],
      },
    ],
    '/experience/': [
      {
        text: '开发经验',
        items: [
          { text: '概述', link: '/experience/' },
          { text: '工程亮点', link: '/experience/highlights' },
          { text: '技术难点', link: '/experience/challenges' },
          { text: '开源方案对比', link: '/experience/comparison' },
          { text: '问题案例', link: '/experience/case-studies' },
          { text: '可复用原则', link: '/experience/principles' },
        ],
      },
    ],
    '/design/': [
      {
        text: '设计文档',
        items: [{ text: 'SW 资源回退对比', link: '/design/sw-comparison' }],
      },
    ],
    '/api/': apiSidebar('zh'),
  };
}

function enSidebar() {
  return {
    '/en/guide/': [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/en/guide/introduction' },
          { text: 'Quick Start', link: '/en/guide/quick-start' },
        ],
      },
      {
        text: 'Build Tool Integration',
        items: [
          { text: 'Vite', link: '/en/guide/vite' },
          { text: 'Webpack', link: '/en/guide/webpack' },
          { text: 'Configuration', link: '/en/guide/configuration' },
          { text: 'Hybrid Service Worker', link: '/en/guide/service-worker' },
        ],
      },
      {
        text: 'Production',
        items: [
          { text: 'Runtime Events', link: '/en/guide/runtime-events' },
          { text: 'CSP & SRI', link: '/en/guide/csp-sri' },
          { text: 'Best Practices', link: '/en/guide/best-practices' },
        ],
      },
    ],
    '/en/experience/': [
      {
        text: 'Dev Experience',
        items: [
          { text: 'Overview', link: '/en/experience/' },
          { text: 'Highlights', link: '/en/experience/highlights' },
          { text: 'Challenges', link: '/en/experience/challenges' },
          { text: 'OSS Comparison', link: '/en/experience/comparison' },
          { text: 'Case Studies', link: '/en/experience/case-studies' },
          { text: 'Principles', link: '/en/experience/principles' },
        ],
      },
    ],
    '/en/design/': [
      {
        text: 'Design Docs',
        items: [{ text: 'SW Fallback Comparison', link: '/en/design/sw-comparison' }],
      },
    ],
    '/en/api/': apiSidebar('en'),
  };
}

function apiSidebar(locale: 'zh' | 'en') {
  const root = locale === 'en' ? '/en/api/' : '/api/';
  return [
    {
      text: locale === 'en' ? 'API Reference' : 'API 参考',
      items: [
        { text: locale === 'en' ? 'Overview' : '概览', link: root + 'README' },
        { text: locale === 'en' ? 'Functions & Helpers' : '函数与工具', link: root },
        { text: locale === 'en' ? 'Types & Interfaces' : '类型与接口', link: root + 'types' },
        { text: 'Service Worker', link: root + 'service-worker' },
      ],
    },
  ];
}
