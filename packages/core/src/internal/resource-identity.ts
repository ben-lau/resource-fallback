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
    return value
      .replace(/#.*$/, '')
      .replace(/([?&])__rf=[^&#]*&?/g, '$1')
      .replace(/[?&]$/, '');
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
