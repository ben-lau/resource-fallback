import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

export default withMermaid(
  defineConfig({
    base: '/resource-fallback/',
    title: 'Resource Fallback',
    description: '零心智负担的前端资源回退方案',

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
    },

    themeConfig: {
      logo: '/logo.svg',
      socialLinks: [{ icon: 'github', link: 'https://github.com/ben-lau/resource-fallback' }],
      search: { provider: 'local' },
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
          sidebarMenuLabel: '菜单',
          darkModeSwitchLabel: '外观',
          langMenuLabel: '切换语言',
        },
      },
      en: {
        label: 'English',
        lang: 'en-US',
        description: 'Zero-intrusion frontend resource fallback for Webpack & Vite',
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
    { text: 'API', link: '/api/', activeMatch: '/api/' },
    { text: 'Changelog', link: '/en/changelog' },
  ];
}

function zhSidebar() {
  return {
    '/guide/': [
      {
        text: '开始',
        items: [
          { text: '简介', link: '/guide/introduction' },
          { text: '快速开始', link: '/guide/quick-start' },
          { text: '配置参考', link: '/guide/configuration' },
        ],
      },
      {
        text: '构建工具集成',
        items: [
          { text: 'Vite', link: '/guide/vite' },
          { text: 'Webpack', link: '/guide/webpack' },
          { text: 'Hybrid Service Worker', link: '/guide/service-worker' },
        ],
      },
      {
        text: '进阶',
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
    '/api/': apiSidebar(),
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
          { text: 'Configuration', link: '/en/guide/configuration' },
        ],
      },
      {
        text: 'Build Tool Integration',
        items: [
          { text: 'Vite', link: '/en/guide/vite' },
          { text: 'Webpack', link: '/en/guide/webpack' },
          { text: 'Hybrid Service Worker', link: '/en/guide/service-worker' },
        ],
      },
      {
        text: 'Advanced',
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
    '/api/': apiSidebar(),
  };
}

function apiSidebar() {
  return [
    {
      text: 'API Reference',
      items: [
        { text: 'Overview', link: '/api/' },
        { text: 'Functions & Helpers', link: '/api/index' },
        { text: 'Types & Interfaces', link: '/api/types' },
        { text: 'Service Worker', link: '/api/service-worker' },
      ],
    },
  ];
}
