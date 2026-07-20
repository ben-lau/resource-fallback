import { rfError } from '../error';
import type {
  CircuitOptions,
  FallbackRule,
  RetryOptions,
  RuntimeConfig,
  SriPolicy,
} from '../types';
import { mergeCircuit } from '../runtime/circuit';
import { mergeRetry } from '../runtime/retry';
import { normalizeFallbackRule } from '../runtime/utils';

const INTERNAL_DEADLINES = Object.freeze({
  attemptMs: 30_000,
  sessionMs: 120_000,
});

export interface ConfigIssue {
  readonly path: string;
  readonly message: string;
}

export interface PreparedRule {
  readonly id: string;
  readonly base: string;
  readonly urls: readonly string[];
  readonly retry: Readonly<Required<RetryOptions>>;
  readonly circuit: Readonly<Required<CircuitOptions>>;
}

export interface PreparedRuntimeConfig {
  readonly rules: readonly PreparedRule[];
  readonly sri: SriPolicy;
  readonly deadlines: Readonly<{ attemptMs: number; sessionMs: number }>;
}

/**
 * Compile raw user options into the immutable shape consumed by the recovery
 * runtime. The compatibility facade may still accept an empty rule list; it
 * is useful for installing the global stub without enabling recovery.
 */
export function compileRuntimeConfig(input: RuntimeConfig): PreparedRuntimeConfig {
  const rawRules = input.rules || [];
  const seenBases = new Map<string, number>();
  const prepared = rawRules.map((rawRule, index) => {
    const normalized = normalizeRule(rawRule, index);
    const previous = seenBases.get(normalized.base);
    if (previous !== undefined) {
      throw configError(
        `rules[${index}].base duplicates rules[${previous}].base: ${normalized.base}`,
      );
    }
    seenBases.set(normalized.base, index);

    const urls = validateCandidates(normalized, index);
    const retry = validateRetry(mergeRetry(input.defaults?.retry, normalized.retry), index);
    const circuit = validateCircuit(
      mergeCircuit(input.defaults?.circuit, normalized.circuit),
      index,
    );

    return {
      id: `rule-${index}`,
      base: normalized.base,
      urls,
      retry,
      circuit,
    } satisfies PreparedRule;
  });

  prepared.sort((a, b) => b.base.length - a.base.length);

  const sri = input.sri || 'strip';
  if (sri !== 'strip' && sri !== 'keep' && sri !== 'strict') {
    throw configError(`sri must be one of "strip", "keep", or "strict"`);
  }

  return deepFreeze({
    rules: prepared,
    sri,
    deadlines: { ...INTERNAL_DEADLINES },
  });
}

function normalizeRule(rule: FallbackRule, index: number): FallbackRule {
  try {
    return normalizeFallbackRule(rule);
  } catch (error) {
    throw configError(`rules[${index}]: ${messageOf(error)}`);
  }
}

function validateCandidates(rule: FallbackRule, index: number): readonly string[] {
  if (rule.urls.length === 0) {
    throw configError(`rules[${index}].urls must contain at least one candidate`);
  }

  const seen = new Set<string>();
  for (let candidateIndex = 0; candidateIndex < rule.urls.length; candidateIndex++) {
    const candidate = rule.urls[candidateIndex];
    if (!candidate) {
      throw configError(`rules[${index}].urls[${candidateIndex}] must be non-empty`);
    }
    if (seen.has(candidate)) {
      throw configError(`rules[${index}].urls contains duplicate candidate ${candidate}`);
    }
    seen.add(candidate);
  }
  return [...rule.urls];
}

function validateRetry(retry: Required<RetryOptions>, index: number): Required<RetryOptions> {
  assertNonNegativeInteger(retry.max, `rules[${index}].retry.max`);
  assertFiniteNonNegative(retry.baseDelay, `rules[${index}].retry.baseDelay`);
  assertFiniteNonNegative(retry.maxDelay, `rules[${index}].retry.maxDelay`);
  if (retry.maxDelay < retry.baseDelay) {
    throw configError(`rules[${index}].retry.maxDelay must be >= retry.baseDelay`);
  }
  if (typeof retry.jitter !== 'boolean') {
    throw configError(`rules[${index}].retry.jitter must be boolean`);
  }
  return { ...retry };
}

function validateCircuit(
  circuit: Required<CircuitOptions>,
  index: number,
): Required<CircuitOptions> {
  assertPositiveInteger(circuit.threshold, `rules[${index}].circuit.threshold`);
  assertFiniteNonNegative(circuit.cooldown, `rules[${index}].circuit.cooldown`);
  assertFiniteNonNegative(circuit.storageTtl, `rules[${index}].circuit.storageTtl`);
  if (typeof circuit.shareAcrossTabs !== 'boolean') {
    throw configError(`rules[${index}].circuit.shareAcrossTabs must be boolean`);
  }
  return { ...circuit };
}

function assertNonNegativeInteger(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw configError(`${path} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, path: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw configError(`${path} must be a positive integer`);
  }
}

function assertFiniteNonNegative(value: number, path: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw configError(`${path} must be a finite non-negative number`);
  }
}

function configError(message: string): Error {
  return rfError(`invalid runtime config: ${message}`);
}

function messageOf(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^\[resource-fallback\]\s*/, '')
    : String(error);
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
