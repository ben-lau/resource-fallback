import { compileRuntimeConfig } from '../../../packages/core/src/internal/config';
import {
  beginAttempt,
  createRecoveryState,
  transitionAfterFailure,
  transitionAfterSuccess,
} from '../../../packages/core/src/internal/recovery-engine';
import { example } from './home-copy';
import type {
  ErrorEvent,
  FallbackEvent,
  RetryEvent,
  SuccessEvent,
} from '../../../packages/core/src/types';

export type Scenario = 'backup' | 'origin' | 'none';

export type TraceFrame =
  | { kind: 'request'; node: number }
  | { kind: 'retry'; node: number; attempt: number; detail: RetryEvent }
  | { kind: 'fallback'; node: number; from: number; detail: FallbackEvent }
  | { kind: 'success'; node: number; attempts: number; detail: SuccessEvent }
  | { kind: 'error'; node: number; attempts: number; detail: ErrorEvent };

export declare const data: Record<Scenario, TraceFrame[]>;

const [primary, backup, origin] = example.hosts;
const rule = compileRuntimeConfig({
  rules: [
    {
      base: `https://${primary}/`,
      urls: [`https://${backup}/`, '/'],
      retry: { max: example.retries, jitter: false },
    },
  ],
}).rules[0];

function nodeOf(url: string) {
  const node = example.hosts.indexOf(new URL(url, `https://${origin}`).host);
  if (node === -1) throw new Error(`Unexpected host in request trace: ${url}`);
  return node;
}

// Record the core engine's decisions at build time with deterministic transport outcomes.
function simulate(availableHost?: string): TraceFrame[] {
  let state = createRecoveryState(rule, new URL(example.path, rule.base).href);
  const frames: TraceFrame[] = [{ kind: 'request', node: nodeOf(state.currentUrl) }];
  const openHosts = new Set<string>();
  const maxAttempts = example.hosts.length * (rule.retry.max + 1);

  for (let index = 0; index < maxAttempts; index++) {
    state = beginAttempt(state);
    const node = nodeOf(state.currentUrl);
    const succeeded = example.hosts[node] === availableHost;
    const { state: next, action } = succeeded
      ? transitionAfterSuccess(state)
      : transitionAfterFailure(state, { kind: 'network' }, openHosts, rule);

    switch (action.kind) {
      case 'retry':
        frames.push({
          kind: 'retry',
          node,
          attempt: action.attempt,
          detail: { url: action.url, attempt: action.attempt },
        });
        break;
      case 'fallback':
        frames.push({
          kind: 'fallback',
          node: nodeOf(action.url),
          from: node,
          detail: { from: action.from, to: action.url, reason: 'retry-budget-exhausted' },
        });
        break;
      case 'success':
        frames.push({
          kind: 'success',
          node,
          attempts: next.totalAttempts,
          detail: { url: next.currentUrl, attempts: next.totalAttempts },
        });
        return frames;
      case 'error':
        frames.push({
          kind: 'error',
          node,
          attempts: next.totalAttempts,
          detail: { url: next.currentUrl, reason: action.failure },
        });
        return frames;
      case 'cancelled':
        throw new Error('Unexpected cancellation in request trace');
    }
    state = next;
  }
  throw new Error('Request trace did not reach a terminal state');
}

export default {
  watch: ['./home-copy.ts', '../../../packages/core/src/**/*.ts'],
  load() {
    return { backup: simulate(backup), origin: simulate(origin), none: simulate() };
  },
};
