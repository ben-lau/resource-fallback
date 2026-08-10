import { describe, expect, it } from 'vitest';
import { compileRuntimeConfig, type PreparedRule } from '../packages/core/src/internal/config';
import {
  beginAttempt,
  createRecoveryState,
  transitionAfterFailure,
  transitionAfterSuccess,
  type AttemptFailure,
  type RecoveryState,
} from '../packages/core/src/internal/recovery-engine';

const failure = (kind: AttemptFailure['kind'] = 'network'): AttemptFailure => ({ kind });

function rule(overrides: Partial<PreparedRule> = {}): PreparedRule {
  return {
    ...compileRuntimeConfig({
      rules: [
        {
          base: 'https://a.test/',
          urls: ['https://b.test/', 'https://c.test/'],
          retry: { max: 2, baseDelay: 100, maxDelay: 1000, jitter: false },
        },
      ],
    }).rules[0],
    ...overrides,
  };
}

function stateWithAttempts(input: RecoveryState): RecoveryState {
  return beginAttempt(input);
}

describe('recovery engine', () => {
  it('gives every candidate an independent retry budget', () => {
    const candidateRule = rule();
    const initial = createRecoveryState(candidateRule, 'https://a.test/x.js');
    let state = stateWithAttempts(initial);

    state = transitionAfterFailure(state, failure(), new Set(), candidateRule, () => 0.5).state;
    expect(state.attemptOnUrl).toBe(1);
    state = stateWithAttempts(state);
    state = transitionAfterFailure(state, failure(), new Set(), candidateRule, () => 0.5).state;
    state = stateWithAttempts(state);
    const switched = transitionAfterFailure(state, failure(), new Set(), candidateRule, () => 0.5);

    expect(switched.action).toMatchObject({
      kind: 'fallback',
      from: 'https://a.test/x.js',
      url: 'https://b.test/x.js',
    });
    expect(switched.state.currentUrl).toBe('https://b.test/x.js');
    expect(switched.state.attemptOnUrl).toBe(0);
    expect(switched.state.totalAttempts).toBe(3);
  });

  it('skips open candidates and produces exactly one exhausted action', () => {
    const candidateRule = rule();
    let state = stateWithAttempts(createRecoveryState(candidateRule, 'https://a.test/x.js'));
    state = transitionAfterFailure(state, failure(), new Set(), candidateRule, () => 0.5).state;
    state = stateWithAttempts(state);
    state = transitionAfterFailure(state, failure(), new Set(), candidateRule, () => 0.5).state;
    state = stateWithAttempts(state);
    const result = transitionAfterFailure(
      state,
      failure(),
      new Set(['b.test', 'c.test']),
      candidateRule,
      () => 0.5,
    );

    expect(result.action).toEqual({ kind: 'error', failure: { kind: 'network' } });
    expect(result.state.phase).toBe('done');
    expect(result.state.currentUrl).toBe('https://a.test/x.js');
  });

  it('keeps the origin-relative fallback available when the current CDN host is open', () => {
    const candidateRule = compileRuntimeConfig({
      rules: [
        {
          base: 'https://primary.test/',
          urls: ['https://secondary.test/', 'https://backup.test/', '/'],
          retry: { max: 0, baseDelay: 0, maxDelay: 0, jitter: false },
        },
      ],
    }).rules[0];
    const initialUrl = 'https://backup.test/assets/index.js';

    const result = transitionAfterFailure(
      beginAttempt(createRecoveryState(candidateRule, initialUrl)),
      failure(),
      new Set(['backup.test']),
      candidateRule,
      () => 0.5,
    );

    expect(result.action).toMatchObject({
      kind: 'fallback',
      from: initialUrl,
      url: '/assets/index.js',
    });
  });

  it('does not count an initial success as recovered behavior', () => {
    const result = transitionAfterSuccess(
      stateWithAttempts(createRecoveryState(rule(), 'https://a.test/x.js')),
    );

    expect(result.action).toEqual({ kind: 'success', url: 'https://a.test/x.js' });
    expect(result.state.recovered).toBe(false);
    expect(result.state.phase).toBe('done');
  });

  it('marks success after a retry and suppresses execution failures', () => {
    const candidateRule = rule();
    const initial = stateWithAttempts(createRecoveryState(candidateRule, 'https://a.test/x.js'));
    const retry = transitionAfterFailure(initial, failure(), new Set(), candidateRule, () => 0.5);
    const success = transitionAfterSuccess(stateWithAttempts(retry.state));
    expect(success.state.recovered).toBe(true);
    expect(success.action).toEqual({ kind: 'success', url: 'https://a.test/x.js' });

    const execution = transitionAfterFailure(
      initial,
      failure('execution'),
      new Set(),
      candidateRule,
      () => 0.5,
    );
    expect(execution.action).toEqual({
      kind: 'error',
      failure: { kind: 'execution' },
    });
    expect(execution.state.phase).toBe('done');
  });

  it('returns cancellation without selecting a fallback', () => {
    const candidateRule = rule();
    const result = transitionAfterFailure(
      stateWithAttempts(createRecoveryState(candidateRule, 'https://a.test/x.js')),
      failure('aborted'),
      new Set(),
      candidateRule,
      () => 0.5,
    );

    expect(result.action).toEqual({
      kind: 'cancelled',
      failure: { kind: 'aborted' },
    });
    expect(result.state.phase).toBe('done');
  });

  it('uses the injected random source for jitter and only increments real attempts', () => {
    const jitterRule = rule({
      retry: { max: 1, baseDelay: 100, maxDelay: 100, jitter: true },
    });
    const initial = createRecoveryState(jitterRule, 'https://a.test/x.js');
    expect(initial.totalAttempts).toBe(0);
    const started = beginAttempt(initial);
    expect(started.totalAttempts).toBe(1);

    const result = transitionAfterFailure(started, failure(), new Set(), jitterRule, () => 1);
    expect(result.action).toMatchObject({ kind: 'retry', delay: 125 });
    expect(result.state.totalAttempts).toBe(1);
  });
});
