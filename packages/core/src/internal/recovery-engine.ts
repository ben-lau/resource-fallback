import { backoff } from '../runtime/retry';
import { hostOf } from '../runtime/circuit';
import type { PreparedRule } from './config';
import type {
  AttemptFailure,
  OpenCircuitHosts,
  RandomSource,
  RecoveryAction,
  RecoveryState,
  RecoveryTransition,
} from './recovery-types';

export type {
  AttemptFailure,
  FailureKind,
  OpenCircuitHosts,
  RandomSource,
  RecoveryAction,
  RecoveryState,
  RecoveryTransition,
} from './recovery-types';

const DEFAULT_RANDOM: RandomSource = () => 0.5;

export function createRecoveryState(rule: PreparedRule, initialUrl: string): RecoveryState {
  return {
    initialUrl,
    currentUrl: initialUrl,
    ruleId: rule.id,
    candidateIndex: findCandidateIndex(rule, initialUrl),
    attemptOnUrl: 0,
    totalAttempts: 0,
    phase: 'initial',
    recovered: false,
  };
}

/** Record that a transport has actually started an attempt. */
export function beginAttempt(state: RecoveryState): RecoveryState {
  if (state.phase === 'done') return state;
  return { ...state, totalAttempts: state.totalAttempts + 1 };
}

export function transitionAfterFailure(
  state: RecoveryState,
  failure: AttemptFailure,
  openHosts: OpenCircuitHosts,
  rule: PreparedRule,
  random: RandomSource = DEFAULT_RANDOM,
): RecoveryTransition {
  if (state.phase === 'done') return { state, action: { kind: 'error', failure } };
  if (failure.kind === 'aborted') {
    return terminal(state, { kind: 'cancelled', failure: { kind: 'aborted' } });
  }
  if (failure.kind === 'execution') return terminal(state, { kind: 'error', failure });

  const nextAttempt = state.attemptOnUrl + 1;
  if (nextAttempt <= rule.retry.max) {
    return {
      state: {
        ...state,
        attemptOnUrl: nextAttempt,
        phase: 'retry',
        recovered: true,
      },
      action: {
        kind: 'retry',
        url: state.currentUrl,
        delay: backoff(nextAttempt, rule.retry, random),
        attempt: nextAttempt,
      },
    };
  }

  const nextCandidateIndex = pickNextCandidate(rule, state, openHosts);
  if (nextCandidateIndex === -1) {
    return terminal(state, { kind: 'error', failure });
  }

  const nextUrl = swapToCandidate(rule, state, nextCandidateIndex);
  return {
    state: {
      ...state,
      currentUrl: nextUrl,
      candidateIndex: nextCandidateIndex,
      attemptOnUrl: 0,
      phase: 'fallback',
      recovered: true,
    },
    action: {
      kind: 'fallback',
      from: state.currentUrl,
      url: nextUrl,
      delay: backoff(1, rule.retry, random),
    },
  };
}

export function transitionAfterSuccess(state: RecoveryState): RecoveryTransition {
  if (state.phase === 'done') return { state, action: { kind: 'success', url: state.currentUrl } };
  return {
    state: { ...state, phase: 'done' },
    action: { kind: 'success', url: state.currentUrl },
  };
}

function terminal(state: RecoveryState, action: RecoveryAction): RecoveryTransition {
  return {
    state: { ...state, phase: 'done' },
    action,
  };
}

function findCandidateIndex(rule: PreparedRule, url: string): number {
  let match = -1;
  let matchLength = -1;
  for (let i = 0; i < rule.urls.length; i++) {
    const candidate = rule.urls[i];
    if (url.startsWith(candidate) && candidate.length > matchLength) {
      match = i;
      matchLength = candidate.length;
    }
  }
  return match;
}

function pickNextCandidate(
  rule: PreparedRule,
  state: RecoveryState,
  openHosts: OpenCircuitHosts,
): number {
  for (let index = state.candidateIndex + 1; index < rule.urls.length; index++) {
    // Relative candidates such as "/" are resolved against the page, not the
    // CDN URL that just failed. The fallback target must keep one stable host
    // identity across every recovery step.
    if (!openHosts.has(hostOf(rule.urls[index]))) return index;
  }
  return -1;
}

function swapToCandidate(rule: PreparedRule, state: RecoveryState, index: number): string {
  const fromPrefix = state.candidateIndex >= 0 ? rule.urls[state.candidateIndex] : rule.base;
  const targetPrefix = rule.urls[index];
  if (state.currentUrl.startsWith(fromPrefix)) {
    const rest = state.currentUrl.slice(fromPrefix.length).replace(/^\/+/, '');
    return joinPrefix(targetPrefix, rest);
  }
  return targetPrefix;
}

function joinPrefix(prefix: string, suffix: string): string {
  if (!suffix) return prefix.replace(/\/?$/, '') || '/';
  const separator = /[/\\]$/.test(prefix) ? '' : '/';
  return `${prefix}${separator}${suffix}`;
}
