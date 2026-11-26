import type { MarkdownRenderer } from 'vitepress';

const apiPage = /(^|\/)api\//;

export function configureMarkdown(md: MarkdownRenderer) {
  md.core.ruler.after('anchor', 'resource-fallback-api-titles', (state) => {
    const path = state.env.relativePath ?? '';
    if (!apiPage.test(path)) return;
    const english = path.startsWith('en/');
    const names: Record<string, [string, string]> = {
      index: ['函数与工具', 'Functions and helpers'],
      types: ['类型与接口', 'Types and interfaces'],
      'service-worker': ['Service Worker 工具', 'Service Worker helpers'],
    };
    const key = path.split('/').pop()?.replace('.md', '') ?? '';
    const heading = state.tokens.findIndex(
      (token) => token.type === 'heading_open' && token.tag === 'h1',
    );
    const inline = state.tokens[heading + 1];
    if (heading < 0 || !names[key] || !inline) return;
    const text = inline.children?.find((token) => token.type === 'text');
    if (text) text.content = names[key][english ? 1 : 0];
    inline.content = names[key][english ? 1 : 0];
  });

  // Attach real column labels at build time, so mobile tables work without JavaScript.
  md.core.ruler.after('anchor', 'resource-fallback-option-tables', (state) => {
    if (!/(^|\/)guide\/configuration\.md$/.test(state.env.relativePath ?? '')) return;
    let headers: string[] = [];
    let table: (typeof state.tokens)[number] | undefined;
    let column = 0;
    for (let index = 0; index < state.tokens.length; index++) {
      const token = state.tokens[index];
      if (token.type === 'table_open') {
        headers = [];
        table = token;
      }
      if (token.type === 'th_open') headers.push(state.tokens[index + 1].content);
      if (token.type === 'tbody_open') {
        table?.attrJoin('class', 'rf-option-table');
        table?.attrSet('role', 'table');
        token.attrSet('role', 'rowgroup');
      }
      if (token.type === 'thead_open') token.attrSet('role', 'rowgroup');
      if (token.type === 'tr_open') {
        column = 0;
        token.attrSet('role', 'row');
      }
      if (token.type === 'th_open') token.attrSet('role', 'columnheader');
      if (token.type === 'td_open') {
        token.attrSet('data-label', headers[column++] ?? '');
        token.attrSet('role', 'cell');
      }
    }
  });
  md.renderer.rules.table_open = (tokens, index, options, _env, renderer) => {
    tokens[index].attrSet('tabindex', '0');
    return renderer.renderToken(tokens, index, options);
  };
  md.renderer.rules.td_open = (tokens, index, options, _env, renderer) => {
    const open = renderer.renderToken(tokens, index, options);
    return tokens[index].attrGet('data-label') === null
      ? open
      : open + '<div class="rf-cell-value">';
  };
  md.renderer.rules.td_close = (tokens, index, options, _env, renderer) => {
    let previous = index - 1;
    while (previous >= 0 && tokens[previous].type !== 'td_open') previous--;
    const close = renderer.renderToken(tokens, index, options);
    return tokens[previous]?.attrGet('data-label') == null ? close : '</div>' + close;
  };

  md.core.ruler.after('anchor', 'resource-fallback-doc-header', (state) => {
    const { tokens } = state;
    const title = tokens.findIndex(
      (token) => token.type === 'heading_open' && token.tag === 'h1' && token.level === 0,
    );
    if (title === -1) return;

    // Weight CJK glyphs more heavily when deciding whether a heading needs a smaller scale.
    const measure = (text: string) => text.replace(/\p{Script=Han}/gu, 'xx').length;
    const longTitle = measure(tokens[title + 1].content) > 40;
    const afterTitle = title + 3;
    const shortLead =
      tokens[afterTitle]?.type === 'paragraph_open' &&
      measure(tokens[afterTitle + 1].content) <= 210;

    // The shared API breadcrumb already links to the module overview.
    const moduleNav =
      apiPage.test(state.env.relativePath ?? '') &&
      title === 3 &&
      tokens[0].type === 'paragraph_open' &&
      tokens[1].content.startsWith('[@resource-fallback/core](README.md) / ');
    const start = moduleNav ? 0 : title;
    const end = shortLead ? afterTitle + 3 : afterTitle;
    const open = new state.Token('html_block', '', 0);
    open.content = `<header class="rf-doc-header${longTitle ? ' rf-doc-header--long' : ''}">\n`;
    const close = new state.Token('html_block', '', 0);
    close.content = '</header>\n';
    tokens.splice(end, 0, close);
    tokens.splice(start, title - start, open);
  });
  md.core.ruler.after('anchor', 'resource-fallback-api-anchor', (state) => {
    if (!/(^|\/)api\/types\.md$/.test(state.env.relativePath ?? '')) return;

    // TypeDoc links to a suffixed re-export anchor while VitePress uses the heading slug.
    const index = state.tokens.findIndex((token) => token.attrGet('id') === 'htmltagattributes');
    if (index === -1 || state.tokens.some((token) => token.attrGet('id') === 'htmltagattributes-1'))
      return;

    const alias = new state.Token('html_block', '', 0);
    alias.content = '<span id="htmltagattributes-1" aria-hidden="true"></span>\n';
    state.tokens.splice(index, 0, alias);
  });
}
