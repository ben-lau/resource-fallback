<script setup lang="ts">
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';
import DefaultTheme from 'vitepress/theme';

const { lang, page } = useData();
const english = computed(() => lang.value === 'en-US');
const prefix = computed(() => (english.value ? '/en' : ''));

const sections = {
  guide: { zh: '指南', en: 'Guide', path: '/guide/introduction' },
  design: { zh: '设计', en: 'Design', path: '/design/sw-comparison' },
  experience: { zh: '开发经验', en: 'Dev experience', path: '/experience/' },
  api: { zh: 'API', en: 'API', path: '/api/README' },
};

const pagePath = computed(
  () =>
    '/' +
    page.value.relativePath
      .replace(/^en\//, '')
      .replace(/\.md$/, '')
      .replace(/(^|\/)index$/, '$1'),
);

const section = computed(() => {
  const key = pagePath.value.split('/')[1];
  const entry = sections[key as keyof typeof sections];
  return entry?.path === pagePath.value ? undefined : entry;
});
</script>

<template>
  <DefaultTheme.Layout>
    <template #doc-before>
      <nav class="rf-crumbs" :aria-label="english ? 'Breadcrumb' : '面包屑导航'">
        <ol>
          <li>
            <a :href="withBase(prefix + '/')">{{ english ? 'Home' : '首页' }}</a>
          </li>
          <li v-if="section">
            <a :href="withBase(prefix + section.path)">{{ english ? section.en : section.zh }}</a>
          </li>
          <li aria-current="page">{{ page.title }}</li>
        </ol>
      </nav>
    </template>
  </DefaultTheme.Layout>
</template>
