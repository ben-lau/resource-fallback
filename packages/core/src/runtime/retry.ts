import type { RetryOptions } from '../types';

export const RETRY_DEFAULTS: Required<RetryOptions> = {
  max: 2,
  baseDelay: 300,
  maxDelay: 3000,
  jitter: true,
};

export function mergeRetry(
  defaults: RetryOptions | undefined,
  rule: RetryOptions | undefined,
): Required<RetryOptions> {
  return {
    max: pick(rule?.max, defaults?.max, RETRY_DEFAULTS.max),
    baseDelay: pick(rule?.baseDelay, defaults?.baseDelay, RETRY_DEFAULTS.baseDelay),
    maxDelay: pick(rule?.maxDelay, defaults?.maxDelay, RETRY_DEFAULTS.maxDelay),
    jitter: pick(rule?.jitter, defaults?.jitter, RETRY_DEFAULTS.jitter),
  };
}

function pick<T>(a: T | undefined, b: T | undefined, c: T): T {
  if (a !== undefined) return a;
  if (b !== undefined) return b;
  return c;
}

/**
 * 计算指数退避延迟（毫秒）。
 * `attempt` 从 1 开始（1 表示首次失败之后）。
 *
 * delay = min(maxDelay, baseDelay * 2^(attempt - 1))
 * 可选 ±25% 抖动（防止多个客户端同步重试）。
 */
export function backoff(attempt: number, opts: Required<RetryOptions>): number {
  const safeAttempt = Math.max(1, attempt);
  const exp = opts.baseDelay * Math.pow(2, safeAttempt - 1);
  const capped = Math.min(opts.maxDelay, exp);
  if (!opts.jitter) return capped;
  const jitter = capped * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}
