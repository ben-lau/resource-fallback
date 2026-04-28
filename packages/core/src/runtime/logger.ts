import type { DebugFlag } from '../types';

const PREFIX = '[resource-fallback]';

export interface Logger {
  enabled: boolean;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  debug: (message: string, data?: unknown) => void;
}

const NOOP: Logger['info'] = () => {};

export function createLogger(flag: DebugFlag | undefined): Logger {
  const enabled = resolveFlag(flag);
  if (!enabled || typeof console === 'undefined') {
    return { enabled: false, info: NOOP, warn: NOOP, error: NOOP, debug: NOOP };
  }
  return {
    enabled: true,
    info: (m, d) => console.info(PREFIX, m, d ?? ''),
    warn: (m, d) => console.warn(PREFIX, m, d ?? ''),
    error: (m, d) => console.error(PREFIX, m, d ?? ''),
    debug: (m, d) => console.debug(PREFIX, m, d ?? ''),
  };
}

function resolveFlag(flag: DebugFlag | undefined): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  if (flag === 'auto' || flag === undefined) {
    try {
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem('__RF_DEBUG__');
        return !!v && v !== '0' && v !== 'false';
      }
    } catch {
      /* localStorage may be blocked */
    }
    return false;
  }
  return false;
}
