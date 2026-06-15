export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', ['core', 'vite-plugin', 'webpack-plugin', 'docs', 'ci', 'deps']],
    'subject-max-length': [2, 'always', 100],
  },
};
