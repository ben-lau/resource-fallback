import { compileRuntimeConfig } from '../../../packages/core/src/internal/config';
import {
  beginAttempt,
  createRecoveryState,
  transitionAfterFailure,
} from '../../../packages/core/src/internal/recovery-engine';
import type { FallbackRule } from '../../../packages/core/src/types';

export interface PrefixPreviewInput {
  pageUrl: string;
  resourceUrl: string;
  rules: FallbackRule[];
  retries: number;
}

export function previewPrefixes(input: PrefixPreviewInput) {
  const page = httpUrl(input.pageUrl);
  httpUrl(input.resourceUrl, page.href);
  const config = compileRuntimeConfig({
    rules: input.rules,
    defaults: { retry: { max: input.retries } },
  });
  for (const rule of config.rules) {
    httpUrl(rule.base, page.href);
    for (const candidate of rule.urls) httpUrl(candidate, page.href);
  }
  // Match the adapter's URL as supplied, just as the page coordinator does.
  const rule = config.rules.find((entry) => input.resourceUrl.startsWith(entry.base));
  if (!rule) return { matched: false as const, chain: [] };

  let state = createRecoveryState(rule, input.resourceUrl);
  const sourcePrefix = state.candidateIndex >= 0 ? rule.urls[state.candidateIndex] : rule.base;
  const chain = [{ prefix: rule.base, url: httpUrl(state.currentUrl, page.href).href }];
  // Exhaust each URL's budget to preview candidate selection without sleeping or fetching.
  for (let index = 0; index < rule.urls.length; index++) {
    const transition = transitionAfterFailure(
      beginAttempt({ ...state, attemptOnUrl: rule.retry.max }),
      { kind: 'network' },
      new Set<string>(),
      rule,
    );
    if (transition.action.kind !== 'fallback') break;
    state = transition.state;
    chain.push({
      prefix: rule.urls[state.candidateIndex],
      url: httpUrl(state.currentUrl, page.href).href,
    });
  }
  return {
    matched: true as const,
    base: rule.base,
    suffix: input.resourceUrl.slice(sourcePrefix.length),
    retries: rule.retry.max,
    maximumAttempts: chain.length * (rule.retry.max + 1),
    chain,
  };
}

function httpUrl(value: string, base?: string): URL {
  const url = new URL(value, base);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Use an http:// or https:// URL or a relative asset path.');
  }
  return url;
}
