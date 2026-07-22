import { describe, expect, it, vi } from 'vitest';
import { createHookBus, type RecoveryEvent } from '../packages/core/src/runtime/hooks';
import { createLogger } from '../packages/core/src/runtime/logger';

describe('event bus', () => {
  it('emits transitions in order and suppresses duplicate terminal events per session', () => {
    const bus = createHookBus({}, createLogger(false));
    const events: string[] = [];
    const retry = vi.spyOn(bus, 'emitRetry').mockImplementation(() => events.push('retry'));
    const success = vi.spyOn(bus, 'emitSuccess').mockImplementation(() => events.push('success'));
    const error = vi.spyOn(bus, 'emitError').mockImplementation(() => events.push('error'));

    bus.transition('session-a', {
      type: 'retry',
      event: { url: 'https://a.test/x.js', attempt: 1 },
    });
    bus.transition('session-a', {
      type: 'success',
      event: { url: 'https://b.test/x.js', attempts: 2 },
    });
    bus.transition('session-a', {
      type: 'error',
      event: { url: 'https://b.test/x.js', reason: 'late' },
    });

    expect(events).toEqual(['retry', 'success']);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('closes a session without allowing a late transition', () => {
    const bus = createHookBus({}, createLogger(false));
    const fallback = vi.spyOn(bus, 'emitFallback');
    const event: RecoveryEvent = {
      type: 'fallback',
      event: { from: 'https://a.test/x.js', to: 'https://b.test/x.js' },
    };

    bus.close('session-a');
    bus.transition('session-a', event);
    expect(fallback).not.toHaveBeenCalled();
    bus.dispose();
  });
});
