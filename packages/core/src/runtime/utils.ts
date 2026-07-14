import type { FallbackRule } from '../types';
import { rfError } from '../error';

/** 三元 fallback：优先取 a，其次 b，最后 c。 */
export function pick<T>(a: T | undefined, b: T | undefined, c: T): T {
  if (a !== undefined) return a;
  if (b !== undefined) return b;
  return c;
}

/**
 * 规范化 URL / 路径前缀的尾斜杠。
 * 空字符串与纯 `/` 保持原样；其余缺尾 `/` 或 `\` 则补上 `/`。
 * 供 runtime、Vite 改写闸门与构建期序列化共用。
 */
export function ensureTrailingSlash(prefix: string): string {
  if (!prefix || prefix.endsWith('/') || prefix.endsWith('\\')) return prefix;
  return `${prefix}/`;
}

/** 校验并规范化单条规则的 `base` / `urls` 尾斜杠。 */
export function normalizeFallbackRule(rule: FallbackRule): FallbackRule {
  if (typeof rule.base !== 'string' || !rule.base) {
    throw rfError('FallbackRule.base must be a non-empty string');
  }
  if (!Array.isArray(rule.urls)) {
    throw rfError('FallbackRule.urls must be an array of string prefixes');
  }
  return {
    ...rule,
    base: ensureTrailingSlash(rule.base),
    urls: rule.urls.map((u) => {
      if (typeof u !== 'string') {
        throw rfError('FallbackRule.urls entries must be strings');
      }
      return ensureTrailingSlash(u);
    }),
  };
}

export function normalizeFallbackRules(rules: FallbackRule[] | undefined): FallbackRule[] {
  return (rules || []).map(normalizeFallbackRule);
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
