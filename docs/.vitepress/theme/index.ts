import DefaultTheme from 'vitepress/theme';
import DocsLayout from './DocsLayout.vue';
import UrlPrefixPreview from './UrlPrefixPreview.vue';
import './theme.css';
import './docs.css';
import './tools.css';

export default {
  extends: DefaultTheme,
  Layout: DocsLayout,
  enhanceApp({ app }) {
    app.component('UrlPrefixPreview', UrlPrefixPreview);
  },
};
