import type { CircuitOptions } from '../types';

export const CIRCUIT_DEFAULTS: Required<CircuitOptions> = {
  threshold: 5,
  cooldown: 30_000,
  shareAcrossTabs: true,
  storageTtl: 120_000,
};

const STORAGE_KEY = '__rf_circuit__';

interface HostState {
  fails: number;
  openedAt: number;
}

interface StoredHostState extends HostState {
  /** Epoch ms when this entry was written. Used for TTL eviction. */
  updatedAt: number;
}

type StateMap = Record<string, HostState>;
type StoredStateMap = Record<string, StoredHostState>;

export interface CircuitBreaker {
  isOpen(host: string): boolean;
  recordFailure(host: string): void;
  recordSuccess(host: string): void;
  snapshot(): StateMap;
  dispose(): void;
}

export function mergeCircuit(
  defaults: CircuitOptions | undefined,
  rule: CircuitOptions | undefined,
): Required<CircuitOptions> {
  return {
    threshold: pick(rule?.threshold, defaults?.threshold, CIRCUIT_DEFAULTS.threshold),
    cooldown: pick(rule?.cooldown, defaults?.cooldown, CIRCUIT_DEFAULTS.cooldown),
    shareAcrossTabs: pick(
      rule?.shareAcrossTabs,
      defaults?.shareAcrossTabs,
      CIRCUIT_DEFAULTS.shareAcrossTabs,
    ),
    storageTtl: pick(rule?.storageTtl, defaults?.storageTtl, CIRCUIT_DEFAULTS.storageTtl),
  };
}

function pick<T>(a: T | undefined, b: T | undefined, c: T): T {
  if (a !== undefined) return a;
  if (b !== undefined) return b;
  return c;
}

export function hostOf(url: string): string {
  try {
    return new URL(url, typeof location !== 'undefined' ? location.href : 'http://x/').host;
  } catch {
    return url;
  }
}

export function createCircuitBreaker(opts: Required<CircuitOptions>): CircuitBreaker {
  const memory: StateMap = {};
  let onStorage: ((e: StorageEvent) => void) | null = null;

  function now(): number {
    return Date.now();
  }

  function load(): StateMap {
    if (!opts.shareAcrossTabs) return memory;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return memory;
      const parsed = JSON.parse(raw) as StoredStateMap;
      const cutoff = now() - opts.storageTtl;
      Object.keys(parsed).forEach((k) => {
        const entry = parsed[k];
        if (entry.updatedAt && entry.updatedAt < cutoff) return;
        memory[k] = { fails: entry.fails, openedAt: entry.openedAt };
      });
      return memory;
    } catch {
      return memory;
    }
  }

  function save(): void {
    if (!opts.shareAcrossTabs) return;
    try {
      const stored: StoredStateMap = {};
      const ts = now();
      const cutoff = ts - opts.storageTtl;
      Object.keys(memory).forEach((k) => {
        const s = memory[k];
        if (s.fails === 0 && s.openedAt === 0) return;
        stored[k] = { fails: s.fails, openedAt: s.openedAt, updatedAt: ts };
      });
      const cleared = new Set<string>();
      Object.keys(memory).forEach((k) => {
        const s = memory[k];
        if (s.fails === 0 && s.openedAt === 0) cleared.add(k);
      });
      const existing = readRaw();
      if (existing) {
        Object.keys(existing).forEach((k) => {
          if (stored[k] || cleared.has(k)) return;
          if (existing[k].updatedAt && existing[k].updatedAt < cutoff) return;
          stored[k] = existing[k];
        });
      }
      if (Object.keys(stored).length === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      }
    } catch {
      /* quota exceeded or storage unavailable */
    }
  }

  function readRaw(): StoredStateMap | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as StoredStateMap) : null;
    } catch {
      return null;
    }
  }

  function getState(host: string): HostState {
    load();
    return memory[host] || { fails: 0, openedAt: 0 };
  }

  if (opts.shareAcrossTabs && typeof window !== 'undefined') {
    onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      load();
    };
    window.addEventListener('storage', onStorage);
  }

  return {
    isOpen(host) {
      const s = getState(host);
      if (!s.openedAt) return false;
      if (now() - s.openedAt >= opts.cooldown) {
        memory[host] = { fails: 0, openedAt: 0 };
        save();
        return false;
      }
      return true;
    },
    recordFailure(host) {
      const s = getState(host);
      const fails = s.fails + 1;
      const openedAt = fails >= opts.threshold ? now() : s.openedAt;
      memory[host] = { fails, openedAt };
      save();
    },
    recordSuccess(host) {
      if (!memory[host]) return;
      memory[host] = { fails: 0, openedAt: 0 };
      save();
    },
    snapshot() {
      load();
      return JSON.parse(JSON.stringify(memory));
    },
    dispose() {
      if (onStorage && typeof window !== 'undefined') {
        window.removeEventListener('storage', onStorage);
        onStorage = null;
      }
    },
  };
}
