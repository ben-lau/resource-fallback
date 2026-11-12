import type { MarkdownRenderer } from 'vitepress';

const apiPage = /(^|\/)api\//;

export function configureMarkdown(md: MarkdownRenderer) {
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
