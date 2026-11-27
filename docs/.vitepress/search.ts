/** Self-contained: VitePress serializes this function into the search client. */
export function tokenizeSearch(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/\p{Script=Han}+|[a-z0-9_]+(?::[a-z0-9_]+)*/gu) ?? [];
  const tokens = new Set<string>();
  for (const word of words) {
    if (!/\p{Script=Han}/u.test(word)) {
      tokens.add(word);
      continue;
    }
    // Use adjacent Han pairs consistently on server and client.
    if (word.length === 1) tokens.add(word);
    const characters = Array.from(word);
    for (let index = 0; index < characters.length - 1; index++) {
      tokens.add(characters.slice(index, index + 2).join(''));
    }
  }
  return [...tokens];
}

/** Prefer current, actionable guides over historical discussions and raw API entries. */
export function boostSearchDocument(id: string): number {
  if (/\/guide\/runtime-events(?:\.html)?#rf-/.test(id)) return 8;
  if (/\/guide\/troubleshooting/.test(id)) return 5;
  if (/\/guide\/(configuration|coverage|deployment|sw-operations|url-preview)/.test(id)) return 4;
  if (/\/reference\//.test(id)) return 3;
  if (/\/guide\//.test(id)) return 2;
  if (/\/api\//.test(id)) return 0.35;
  if (/\/(experience|design)\//.test(id)) return 0.25;
  if (/\/changelog/.test(id)) return 0.1;
  return 1;
}
