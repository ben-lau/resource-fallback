import DefaultTheme from 'vitepress/theme';
import DocsLayout from './DocsLayout.vue';
import './theme.css';
import './docs.css';

export default {
  extends: DefaultTheme,
  Layout: DocsLayout,
};
