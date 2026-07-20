import type { PreparedRule } from './config';

export type FailureKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'integrity'
  | 'csp'
  | 'execution'
  | 'load-error'
  | 'aborted'
  | 'unknown';

export interface AttemptFailure {
  readonly kind: FailureKind;
  readonly error?: unknown;
  readonly status?: number;
}

export interface RecoveryState {
  readonly initialUrl: string;
  readonly currentUrl: string;
  readonly ruleId: string;
  readonly candidateIndex: number;
  readonly attemptOnUrl: number;
  readonly totalAttempts: number;
  readonly phase: 'initial' | 'retry' | 'fallback' | 'done';
  readonly recovered: boolean;
}

export type RecoveryAction =
  | {
      readonly kind: 'retry';
      readonly url: string;
      readonly delay: number;
      readonly attempt: number;
    }
  | {
      readonly kind: 'fallback';
      readonly from: string;
      readonly url: string;
      readonly delay: number;
    }
  | { readonly kind: 'success'; readonly url: string }
  | { readonly kind: 'error'; readonly failure: AttemptFailure }
  | { readonly kind: 'cancelled'; readonly failure: { readonly kind: 'aborted' } };

export interface RecoveryTransition {
  readonly state: RecoveryState;
  readonly action: RecoveryAction;
}

export type OpenCircuitHosts = ReadonlySet<string>;

export type RandomSource = () => number;

export type RecoveryRule = PreparedRule;
