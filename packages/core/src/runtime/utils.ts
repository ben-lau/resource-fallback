/** 三元 fallback：优先取 a，其次 b，最后 c。 */
export function pick<T>(a: T | undefined, b: T | undefined, c: T): T {
  if (a !== undefined) return a;
  if (b !== undefined) return b;
  return c;
}

/** 去掉 URL 中已有的 `__rf=` 查询参数。 */
export function stripRetryParam(url: string): string {
  return url.replace(/([?&])__rf=[^&#]*&?/g, (_m, sep) => sep).replace(/[?&]$/, '');
}

/** 追加 `__rf=<attempt-nonce>` 用于 ESM module cache bust。 */
export function appendRetryParam(url: string, attempt: number): string {
  const clean = stripRetryParam(url);
  const nonce = attempt + '-' + Math.floor(Math.random() * 1e6).toString(36);
  return clean + (clean.indexOf('?') === -1 ? '?' : '&') + '__rf=' + nonce;
}
