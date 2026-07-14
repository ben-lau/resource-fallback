import type { FallbackRule, ResolveResult, RuntimeConfig } from '../types';
import { backoff, mergeRetry } from './retry';
import { createCircuitBreaker, hostOf, mergeCircuit } from './circuit';
import { normalizeFallbackRule } from './utils';

interface PreparedRule {
  raw: FallbackRule;
  retry: ReturnType<typeof mergeRetry>;
  circuit: ReturnType<typeof mergeCircuit>;
  breaker: ReturnType<typeof createCircuitBreaker>;
}

export interface Resolver {
  /**
   * 在 `currentUrl` 失败后决定下一步操作。
   *
   * @param currentUrl   刚刚失败的 URL
   * @param attemptOnUrl 1-indexed；到目前为止在该 URL 上观察到的失败次数
   *                     （调用方在 fallback 后会重置为 1）
   * @param isFallback   当前 URL 是否已处于 fallback 阶段（来自 urls 列表）。
   *                     为 false 时表示仍在初始链接上重试——初始链接只通过
   *                     base 前缀匹配，且失败不计入熔断器。
   */
  resolve(currentUrl: string, attemptOnUrl: number, isFallback?: boolean): ResolveResult;

  /**
   * 返回规则为未带后缀的内置资源名优先使用的候选 URL 前缀。
   * 供 Vite `experimental.renderBuiltUrl` 钩子使用。
   * 如果没有匹配规则则原样返回文件名。
   */
  resolveBuiltUrl(filename: string): string;

  /** 查找适用于某 URL 的规则。 */
  findRule(url: string): FallbackRule | undefined;

  /** 将某 host 标记为失败（驱动熔断器）。 */
  recordFailure(url: string): void;

  /** 将某 host 标记为成功。 */
  recordSuccess(url: string): void;
}

export function createResolver(config: RuntimeConfig): Resolver {
  const prepared: PreparedRule[] = (config.rules || []).map((r) => {
    const rule = normalizeFallbackRule(r);
    const circuit = mergeCircuit(config.defaults?.circuit, rule.circuit);
    return {
      raw: rule,
      retry: mergeRetry(config.defaults?.retry, rule.retry),
      circuit,
      breaker: createCircuitBreaker(circuit),
    };
  });

  function findPrepared(url: string, isFallback?: boolean): PreparedRule | undefined {
    // 从后向前遍历——当多条规则的 base 重复时，以最后一条为准。
    for (let i = prepared.length - 1; i >= 0; i--) {
      const r = prepared[i];
      if (url.indexOf(r.raw.base) === 0) return r;
      // 仅在 fallback 阶段才通过 urls 前缀匹配。初始资源只通过 base 识别，
      // 避免全新资源的 URL 恰好以某条规则的 urls 开头而误入 fallback 逻辑。
      if (isFallback) {
        for (let j = 0; j < r.raw.urls.length; j++) {
          if (url.indexOf(r.raw.urls[j]) === 0) return r;
        }
      }
    }
    return undefined;
  }

  /**
   * 找到 url 在 urls 数组中的位置以及用于截取资产路径的前缀。
   *
   * 当 base 和 urls[0] 指向不同前缀时，url 不会匹配任何 urls 前缀。
   * 此时使用 base 作为前缀来提取资产路径，并返回 urlIndex=-1 表示
   * 「在 urls 列表之前」，让 pickNextUrl 从 urls[0] 开始。
   */
  function findMatchContext(rule: FallbackRule, url: string): { urlIndex: number; prefix: string } {
    for (let i = 0; i < rule.urls.length; i++) {
      if (url.indexOf(rule.urls[i]) === 0) return { urlIndex: i, prefix: rule.urls[i] };
    }
    if (url.indexOf(rule.base) === 0) {
      return { urlIndex: -1, prefix: rule.base };
    }
    // 已通过 findPrepared 命中规则（含 isFallback 的 urls 路径），但当前 URL
    // 既不以 base 也不以任一 urls 开头——理论上不应到达；保底用 base。
    return { urlIndex: -1, prefix: rule.base };
  }

  function swap(currentUrl: string, fromPrefix: string, toPrefix: string): string {
    if (fromPrefix && currentUrl.indexOf(fromPrefix) === 0) {
      const rest = currentUrl.slice(fromPrefix.length).replace(/^\/+/, '');
      return joinAssetPrefix(toPrefix, rest);
    }
    return toPrefix;
  }

  function pickNextUrl(
    rule: FallbackRule,
    fromIdx: number,
    br: ReturnType<typeof createCircuitBreaker>,
  ): number {
    for (let j = fromIdx + 1; j < rule.urls.length; j++) {
      if (!br.isOpen(hostOf(rule.urls[j]))) return j;
    }
    return -1;
  }

  return {
    findRule(url) {
      return findPrepared(url)?.raw;
    },

    resolve(currentUrl, attemptOnUrl, isFallback) {
      const p = findPrepared(currentUrl, isFallback);
      if (!p) return { kind: 'giveup', reason: 'no-match' };
      const rule = p.raw;
      const ctx = findMatchContext(rule, currentUrl);

      if (attemptOnUrl <= p.retry.max) {
        return {
          kind: 'retry',
          url: currentUrl,
          delay: backoff(attemptOnUrl, p.retry),
          attempt: attemptOnUrl,
        };
      }

      // 始终记录失败到熔断器。初始链接（isFallback=false）仍然会被 findPrepared
      // 通过 base 前缀匹配到（匹配不受熔断器影响），所以初始链接始终会被尝试。
      // 记录失败让 resolveBuiltUrl（Vite modulepreload）和 pickNextUrl 能跳过
      // 已知不可用的 host，选择更优的候选。
      p.breaker.recordFailure(hostOf(currentUrl));
      const j = pickNextUrl(rule, ctx.urlIndex, p.breaker);
      if (j === -1) return { kind: 'giveup', reason: 'rules-exhausted' };
      return {
        kind: 'fallback',
        from: currentUrl,
        url: swap(currentUrl, ctx.prefix, rule.urls[j]),
        delay: backoff(1, p.retry),
        attempt: attemptOnUrl,
      };
    },

    resolveBuiltUrl(filename) {
      // 初始链接（base URL）始终优先返回，不受熔断器影响——
      // 与 resolve() 的语义一致：初始链接永远尝试。
      // __RF__.load 内部的 retry/fallback 循环负责在失败后切换到 urls 列表。
      // 多规则时后来者胜。
      if (prepared.length === 0) return filename;
      return joinAssetPrefix(prepared[prepared.length - 1].raw.base, filename);
    },

    recordFailure(url) {
      const p = findPrepared(url, true) || findPrepared(url);
      if (p) p.breaker.recordFailure(hostOf(url));
    },

    recordSuccess(url) {
      const p = findPrepared(url, true) || findPrepared(url);
      if (p) p.breaker.recordSuccess(hostOf(url));
    },
  };
}

/**
 * Vite/Rollup 传给 `renderBuiltUrl` 的文件名通常不带前导 `/`（如 `js/chunk.js`）。
 * 若 `base` / `urls[i]` 写成无前导目录分隔的形式（漏掉末尾 `/`），
 * 字符串相加会得到 `.../edu-study-platform-prod` + `js/x.js` → `...prodjs/x.js`。
 */
function joinAssetPrefix(prefix: string, filename: string): string {
  if (!filename) return prefix.replace(/\/?$/, '') || '/';
  const name = filename.replace(/^\/+/, '');
  const sep = /[/\\]$/.test(prefix) ? '' : '/';
  return `${prefix}${sep}${name}`;
}
