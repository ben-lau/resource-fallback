import { defineConfigWithTheme, type DefaultTheme } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import metadata from '../../package.json';
import { configureMarkdown } from './markdown';

const apiPage = /(^|\/)api\//;

export default withMermaid(
  defineConfigWithTheme<DefaultTheme.Config & { docVersion?: string }>({
    base: '/resource-fallback/',
    title: 'Resource Fallback',
    description: '为 Vite 和 Webpack 构建产物提供运行时重试、多 CDN 回退和回源。',

    head: [['link', { rel: 'icon', href: '/resource-fallback/logo.svg' }]],

    lastUpdated: true,
    cleanUrls: true,

    transformPageData(page) {
      const { relativePath, frontmatter } = page;
      if (apiPage.test(relativePath)) {
        frontmatter.outline ??= [2, 3];
        frontmatter.pageClass = 'rf-api-page';
        const english = relativePath.startsWith('en/');
        const names = {
          index: ['函数与工具', 'Functions and helpers'],
          types: ['类型与接口', 'Types and interfaces'],
          'service-worker': ['Service Worker 工具', 'Service Worker helpers'],
        };
        const key = relativePath.split('/').pop()?.replace('.md', '') as keyof typeof names;
        if (names[key]) page.title = frontmatter.title = names[key][english ? 1 : 0];
      }
      if (/(^|\/)reference\//.test(relativePath)) frontmatter.pageClass = 'rf-api-page';
    },

    srcExclude: [
      'superpowers/**',
      'experience-report.zh-CN.md',
      'sw-resource-fallback-comparison.zh-CN.md',
    ],

    markdown: {
      lineNumbers: true,
      theme: { light: 'github-light', dark: 'github-dark-default' },
      config: configureMarkdown,
    },

    themeConfig: {
      docVersion: metadata.version,
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
        pattern: sourceEditLink,
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
            pattern: sourceEditLink,
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
            pattern: sourceEditLink,
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

function zhNav(): DefaultTheme.NavItem[] {
  return [
    { text: '指南', link: '/guide/introduction', activeMatch: '/guide/' },
    {
      text: '深入',
      items: [
        { text: '开发经验', link: '/experience/' },
        { text: '工作原理', link: '/design/architecture' },
        { text: 'SW 设计对比', link: '/design/sw-comparison' },
      ],
    },
    { text: 'API', link: '/reference/', activeMatch: '/(api|reference)/' },
    { text: '更新日志', link: '/changelog' },
  ];
}

function enNav(): DefaultTheme.NavItem[] {
  return [
    { text: 'Guide', link: '/en/guide/introduction', activeMatch: '/en/guide/' },
    {
      text: 'Deep Dive',
      items: [
        { text: 'Dev Experience', link: '/en/experience/' },
        { text: 'How it works', link: '/en/design/architecture' },
        { text: 'SW Design', link: '/en/design/sw-comparison' },
      ],
    },
    { text: 'API', link: '/en/reference/', activeMatch: '/en/(api|reference)/' },
    { text: 'Changelog', link: '/en/changelog' },
  ];
}

function zhSidebar() {
  return {
    '/guide/': guideSidebar('zh'),
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
        items: [
          { text: '工作原理', link: '/design/architecture' },
          { text: 'SW 资源回退对比', link: '/design/sw-comparison' },
        ],
      },
    ],
    '/api/': apiSidebar('zh'),
    '/reference/': apiSidebar('zh'),
  };
}

function enSidebar() {
  return {
    '/en/guide/': guideSidebar('en'),
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
        items: [
          { text: 'How it works', link: '/en/design/architecture' },
          { text: 'SW Fallback Comparison', link: '/en/design/sw-comparison' },
        ],
      },
    ],
    '/en/api/': apiSidebar('en'),
    '/en/reference/': apiSidebar('en'),
  };
}

function guideSidebar(locale: 'zh' | 'en') {
  const english = locale === 'en';
  const root = english ? '/en/guide/' : '/guide/';
  const group = (zh: string, en: string, items: Array<[string, string, string]>) => ({
    text: english ? en : zh,
    items: items.map(([path, chinese, translated]) => ({
      text: english ? translated : chinese,
      link: root + path,
    })),
  });
  return [
    group('开始使用', 'Getting started', [
      ['introduction', '简介', 'Introduction'],
      ['coverage', '覆盖范围与限制', 'Coverage and limits'],
      ['compatibility', '兼容性', 'Compatibility'],
      ['quick-start', '快速开始', 'Quick start'],
    ]),
    group('构建工具集成', 'Build integrations', [
      ['vite', 'Vite', 'Vite'],
      ['webpack', 'Webpack', 'Webpack'],
      ['manual-integration', '手动集成', 'Manual integration'],
    ]),
    group('上线与运维', 'Production', [
      ['configuration', '配置参考', 'Configuration'],
      ['deployment', '生产部署', 'Deployment'],
      ['service-worker', 'Hybrid Service Worker', 'Hybrid Service Worker'],
      ['sw-operations', 'SW 运维', 'SW operations'],
      ['runtime-events', '运行时事件', 'Runtime events'],
      ['csp-sri', 'CSP 与 SRI', 'CSP and SRI'],
      ['migration', '升级与迁移', 'Upgrading'],
    ]),
    group('排查与验证', 'Diagnose and verify', [
      ['troubleshooting', '故障排查', 'Troubleshooting'],
      ['url-preview', 'URL 前缀预览', 'URL prefix preview'],
      ['best-practices', '最佳实践', 'Best practices'],
    ]),
  ];
}

function apiSidebar(locale: 'zh' | 'en') {
  const english = locale === 'en';
  const root = english ? '/en' : '';
  return [
    {
      text: english ? 'API guides' : 'API 使用指南',
      items: [
        { text: english ? 'Choose an API' : '按任务查找', link: root + '/reference/' },
        { text: english ? 'Browser runtime' : '浏览器运行时', link: root + '/reference/runtime' },
        { text: english ? 'Configuration' : '配置与选项', link: root + '/guide/configuration' },
        { text: english ? 'Runtime events' : '运行时事件', link: root + '/guide/runtime-events' },
      ],
    },
    {
      text: english ? 'Generated reference' : '完整类型参考',
      collapsed: false,
      items: [
        { text: english ? 'Modules' : '模块概览', link: root + '/api/README' },
        { text: english ? 'Functions and helpers' : '函数与工具', link: root + '/api/' },
        { text: english ? 'Types and interfaces' : '类型与接口', link: root + '/api/types' },
        {
          text: english ? 'Service Worker helpers' : 'Service Worker 工具',
          link: root + '/api/service-worker',
        },
      ],
    },
  ];
}

function sourceEditLink({ relativePath }: { relativePath: string }) {
  const match = relativePath.match(/^(?:en\/)?api\/(README|index|types|service-worker)\.md$/);
  const path = match
    ? 'packages/core/src/' + (match[1] === 'README' ? 'index' : match[1]) + '.ts'
    : 'docs/' + relativePath;
  return 'https://github.com/ben-lau/resource-fallback/edit/main/' + path;
}
