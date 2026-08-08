export interface WebpackResourceMetadata {
  readonly key?: string;
  readonly chunkId?: string | number;
}

function defaultBaseUrl(): string | undefined {
  if (typeof document !== 'undefined' && document.baseURI) return document.baseURI;
  if (typeof location !== 'undefined' && location.href) return location.href;
  return undefined;
}

export function normalizeResourceUrl(value: string, baseUrl?: string): string {
  const base = baseUrl ?? defaultBaseUrl();
  try {
    const url = base ? new URL(value, base) : new URL(value);
    url.hash = '';
    url.searchParams.delete('__rf');
    return url.href;
  } catch {
    const fragmentless = value.replace(/#.*$/, '');
    const queryStart = fragmentless.indexOf('?');
    if (queryStart === -1) return fragmentless;

    const parameters = fragmentless
      .slice(queryStart + 1)
      .split('&')
      .filter((parameter) => parameter && parameter.split('=', 1)[0] !== '__rf');
    return parameters.length
      ? `${fragmentless.slice(0, queryStart)}?${parameters.join('&')}`
      : fragmentless.slice(0, queryStart);
  }
}

export function urlResourceKey(value: string, baseUrl?: string): string {
  return 'url:' + normalizeResourceUrl(value, baseUrl);
}

export function webpackResourceKey(
  value: string,
  metadata: WebpackResourceMetadata,
  baseUrl?: string,
): string {
  if (metadata.key) return 'chunk:' + metadata.key;
  if (metadata.chunkId !== undefined) return 'chunk:' + String(metadata.chunkId);
  return urlResourceKey(value, baseUrl);
}
