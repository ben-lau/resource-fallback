import type { RuntimeConfig } from '../types';

/**
 * 三个独立的紧急开关。任何一个都可以在不重新部署的情况下禁用运行时：
 *
 *  1. 全局标志，如在 HTML 中内联设置 `window.__RF_DISABLE__ = true`
 *     （或在我们的 `<script>` 执行前由 A/B 平台设置）。
 *  2. URL 查询参数（`?__rf=off`）——便于临时排查问题。
 *  3. Cookie（`__rf_disable=1`）——便于通过网关按会话禁用。
 */
export function isDisabled(cfg: RuntimeConfig): boolean {
  if (typeof window === 'undefined') return true;

  const globals = cfg.disableGlobals && cfg.disableGlobals.length
    ? cfg.disableGlobals.concat(['__RF_DISABLE__'])
    : ['__RF_DISABLE__'];

  for (let i = 0; i < globals.length; i++) {
    const v = (window as unknown as Record<string, unknown>)[globals[i]];
    if (v) return true;
  }

  try {
    const qp = cfg.disableQueryParam || '__rf';
    const search = (typeof location !== 'undefined' && location.search) || '';
    if (search) {
      const params = new URLSearchParams(search);
      if (params.get(qp) === 'off') return true;
    }
  } catch {
    /* URLSearchParams 可能不可用；忽略 */
  }

  try {
    const ck = cfg.disableCookie || '__rf_disable';
    const cookies = (typeof document !== 'undefined' && document.cookie) || '';
    if (cookies) {
      const parts = cookies.split(';');
      for (let i = 0; i < parts.length; i++) {
        const trimmed = parts[i].replace(/^\s+/, '');
        if (trimmed.indexOf(ck + '=1') === 0) return true;
      }
    }
  } catch {
    /* document.cookie 在某些沙箱中会抛异常 */
  }

  return false;
}
