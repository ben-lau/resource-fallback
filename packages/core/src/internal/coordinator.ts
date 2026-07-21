import { hostOf } from '../runtime/circuit';
import type { HookBus } from '../runtime/hooks';
import type { PreparedRuntimeConfig, PreparedRule } from './config';
import { createInFlightRegistry, type InFlightSession } from './inflight-registry';
import {
  beginAttempt,
  createRecoveryState,
  transitionAfterFailure,
  transitionAfterSuccess,
  type AttemptFailure,
  type RecoveryState,
} from './recovery-engine';
import type { FailureKind, RecoveryOwner } from './recovery-types';

export type { FailureKind, RecoveryOwner } from './recovery-types';

export interface AttemptInput {
  readonly initialUrl: string;
  readonly url: string;
  readonly attempt: number;
  readonly totalAttempts: number;
  readonly phase: RecoveryState['phase'];
}

export type AttemptResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: AttemptFailure };

export interface RecoveryTransport<T> {
  attempt(input: AttemptInput, signal: AbortSignal): Promise<AttemptResult<T>>;
}

export interface RecoveryRequest<T> {
  readonly owner: RecoveryOwner;
  readonly logicalKey: string;
  readonly initialUrl: string;
  readonly ruleId?: string;
  readonly transport: RecoveryTransport<T>;
}

export interface CircuitRegistry {
  isOpen(host: string): boolean;
  recordFailure(host: string): void;
  recordSuccess(host: string): void;
  dispose?(): void;
}

export interface CoordinatorDeps {
  readonly config: PreparedRuntimeConfig;
  readonly bus?: HookBus;
  readonly circuit?: CircuitRegistry;
  readonly attemptTimeoutMs?: number;
  readonly sessionTimeoutMs?: number;
  readonly random?: () => number;
}

export interface RecoveryCoordinator {
  recover<T>(request: RecoveryRequest<T>): Promise<T>;
  cancelOwner(owner: RecoveryOwner): void;
  dispose(): void;
}

const NOOP_BUS: HookBus = {
  emitRetry() {},
  emitFallback() {},
  emitSuccess() {},
  emitError() {},
};

const NOOP_CIRCUIT: CircuitRegistry = {
  isOpen: () => false,
  recordFailure() {},
  recordSuccess() {},
};

export function createRecoveryCoordinator(deps: CoordinatorDeps): RecoveryCoordinator {
  const registry = createInFlightRegistry();
  const bus = deps.bus || NOOP_BUS;
  const circuit = deps.circuit || NOOP_CIRCUIT;
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? deps.config.deadlines.attemptMs;
  const sessionTimeoutMs = deps.sessionTimeoutMs ?? deps.config.deadlines.sessionMs;
  const random = deps.random || Math.random;
  let disposed = false;

  return {
    recover<T>(request: RecoveryRequest<T>): Promise<T> {
      if (disposed) return Promise.reject({ kind: 'aborted' } satisfies AttemptFailure);
      const key = recoveryKey(request.owner, request.logicalKey);
      return registry.getOrCreate(key, () =>
        createSession(request, {
          config: deps.config,
          bus,
          circuit,
          attemptTimeoutMs,
          sessionTimeoutMs,
          random,
        }),
      );
    },

    cancelOwner(owner: RecoveryOwner): void {
      registry.cancelWhere((key) => key.startsWith(`${owner}\0`));
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      registry.dispose();
      circuit.dispose?.();
    },
  };
}

export function recoveryKey(owner: RecoveryOwner, logicalKey: string): string {
  return `${owner}\0${logicalKey}`;
}

interface SessionDeps {
  readonly config: PreparedRuntimeConfig;
  readonly bus: HookBus;
  readonly circuit: CircuitRegistry;
  readonly attemptTimeoutMs: number;
  readonly sessionTimeoutMs: number;
  readonly random: () => number;
}

function createSession<T>(request: RecoveryRequest<T>, deps: SessionDeps): InFlightSession<T> {
  const controller = new AbortController();
  let resolveOuter!: (value: T) => void;
  let rejectOuter!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  let settled = false;
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelAttempt: ((failure: AttemptFailure) => void) | null = null;
  let cancelDelay: (() => void) | null = null;
  let currentUrl = request.initialUrl;
  let state: RecoveryState | undefined;
  let errorEmitted = false;
  let successEmitted = false;

  const emitErrorOnce = (reason: unknown) => {
    if (errorEmitted) return;
    errorEmitted = true;
    deps.bus.emitError({ url: currentUrl, reason });
  };

  const emitSuccessOnce = (attempts: number) => {
    if (successEmitted) return;
    successEmitted = true;
    deps.bus.emitSuccess({ url: currentUrl, attempts });
  };

  const finishReject = (failure: AttemptFailure, emitError: boolean) => {
    if (settled) return;
    settled = true;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = undefined;
    cancelAttempt?.(failure);
    cancelAttempt = null;
    cancelDelay?.();
    cancelDelay = null;
    controller.abort();
    if (emitError && failure.kind !== 'aborted') emitErrorOnce(failure);
    rejectOuter(failure);
  };

  const finishResolve = (value: T) => {
    if (settled) return;
    settled = true;
    if (sessionTimer) clearTimeout(sessionTimer);
    sessionTimer = undefined;
    cancelDelay?.();
    cancelDelay = null;
    controller.abort();
    resolveOuter(value);
  };

  const rule = findRule(deps.config, request);
  if (!rule) {
    finishReject(
      { kind: 'unknown', error: new Error(`no recovery rule matches ${request.initialUrl}`) },
      true,
    );
  } else {
    state = createRecoveryState(rule, request.initialUrl);
    sessionTimer = setTimeout(() => finishReject({ kind: 'timeout' }, true), deps.sessionTimeoutMs);
    void execute(rule);
  }

  return {
    promise,
    cancel: () => finishReject({ kind: 'aborted' }, false),
  };

  async function execute(ruleForSession: PreparedRule): Promise<void> {
    while (!settled && state && state.phase !== 'done') {
      state = beginAttempt(state);
      currentUrl = state.currentUrl;
      const result = await attempt(
        request.transport,
        state,
        controller.signal,
        deps.attemptTimeoutMs,
      );
      if (settled || !state) return;

      if (result.ok) {
        const wasRecovered = state.recovered;
        const transition = transitionAfterSuccess(state);
        state = transition.state;
        deps.circuit.recordSuccess(hostOf(currentUrl));
        if (wasRecovered) emitSuccessOnce(state.totalAttempts);
        finishResolve(result.value);
        return;
      }

      const failure = result.failure;
      const exhausted = state.attemptOnUrl + 1 > ruleForSession.retry.max;
      if (exhausted) deps.circuit.recordFailure(hostOf(currentUrl));
      const transition = transitionAfterFailure(
        state,
        failure,
        openHosts(ruleForSession, deps.circuit),
        ruleForSession,
        deps.random,
      );
      state = transition.state;

      if (transition.action.kind === 'retry') {
        deps.bus.emitRetry({
          url: transition.action.url,
          attempt: transition.action.attempt,
        });
        await wait(transition.action.delay);
        continue;
      }

      if (transition.action.kind === 'fallback') {
        currentUrl = transition.action.url;
        deps.bus.emitFallback({
          from: transition.action.from,
          to: transition.action.url,
          reason: 'retry-budget-exhausted',
        });
        await wait(transition.action.delay);
        continue;
      }

      if (transition.action.kind === 'error') {
        currentUrl = state.currentUrl;
        emitErrorOnce(transition.action.failure);
        finishReject(transition.action.failure, false);
        return;
      }

      if (transition.action.kind === 'cancelled') {
        finishReject(transition.action.failure, false);
      }
      return;
    }
  }

  function wait(delay: number): Promise<void> {
    if (delay <= 0 || settled) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => settle(), delay);
      const settle = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (cancelDelay === cancel) cancelDelay = null;
        resolve();
      };
      const cancel = () => settle();
      cancelDelay = cancel;
    });
  }

  function attempt<TValue>(
    transport: RecoveryTransport<TValue>,
    currentState: RecoveryState,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<AttemptResult<TValue>> {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(
        () => settle({ ok: false, failure: { kind: 'timeout' } }),
        timeoutMs,
      );
      const settle = (result: AttemptResult<TValue>) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (cancelAttempt === cancel) cancelAttempt = null;
        resolve(result);
      };
      const cancel = (failure: AttemptFailure) =>
        settle({ ok: false, failure } as AttemptResult<TValue>);
      cancelAttempt = cancel;

      try {
        const input: AttemptInput = {
          initialUrl: currentState.initialUrl,
          url: currentState.currentUrl,
          attempt: currentState.attemptOnUrl + 1,
          totalAttempts: currentState.totalAttempts,
          phase: currentState.phase,
        };
        Promise.resolve(transport.attempt(input, signal)).then(
          (result) => settle(result),
          (error) => settle({ ok: false, failure: failureFromThrown(error) }),
        );
      } catch (error) {
        settle({ ok: false, failure: failureFromThrown(error) });
      }
    });
  }
}

function findRule(
  config: PreparedRuntimeConfig,
  request: RecoveryRequest<unknown>,
): PreparedRule | undefined {
  if (request.ruleId) return config.rules.find((rule) => rule.id === request.ruleId);
  return config.rules.find((rule) => request.initialUrl.startsWith(rule.base));
}

function openHosts(rule: PreparedRule, circuit: CircuitRegistry): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const url of rule.urls) {
    const host = hostOf(url);
    if (host && circuit.isOpen(host)) hosts.add(host);
  }
  return hosts;
}

function failureFromThrown(error: unknown): AttemptFailure {
  if (isAttemptFailure(error)) return error;
  if (isAbortError(error)) return { kind: 'aborted', error };
  return { kind: 'unknown', error };
}

function isAttemptFailure(value: unknown): value is AttemptFailure {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === 'string' && FAILURE_KINDS.has(kind as FailureKind);
}

function isAbortError(error: unknown): boolean {
  return (
    !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError'
  );
}

const FAILURE_KINDS = new Set<FailureKind>([
  'network',
  'timeout',
  'http',
  'integrity',
  'csp',
  'execution',
  'load-error',
  'aborted',
  'unknown',
]);
