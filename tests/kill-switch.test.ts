import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDisabled } from '../packages/core/src/runtime/kill-switch';

describe('kill-switch', () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__RF_DISABLE__;
    delete (window as unknown as Record<string, unknown>).__CUSTOM_DISABLE__;
    document.cookie = '__rf_disable=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    history.replaceState(null, '', '/');
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__RF_DISABLE__;
    delete (window as unknown as Record<string, unknown>).__CUSTOM_DISABLE__;
    document.cookie = '__rf_disable=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('returns false when nothing is set', () => {
    expect(isDisabled({ rules: [] })).toBe(false);
  });

  it('respects window.__RF_DISABLE__', () => {
    (window as unknown as Record<string, unknown>).__RF_DISABLE__ = true;
    expect(isDisabled({ rules: [] })).toBe(true);
  });

  it('respects extra disableGlobals', () => {
    (window as unknown as Record<string, unknown>).__CUSTOM_DISABLE__ = 1;
    expect(isDisabled({ rules: [], disableGlobals: ['__CUSTOM_DISABLE__'] })).toBe(true);
  });

  it('respects ?__rf=off query param', () => {
    history.replaceState(null, '', '/?__rf=off');
    expect(isDisabled({ rules: [] })).toBe(true);
  });

  it('respects __rf_disable=1 cookie', () => {
    document.cookie = '__rf_disable=1; path=/';
    expect(isDisabled({ rules: [] })).toBe(true);
  });

  it('does NOT disable for __rf_disable=10 (exact match)', () => {
    document.cookie = '__rf_disable=10; path=/';
    expect(isDisabled({ rules: [] })).toBe(false);
  });

  it('matches cookie among multiple cookies', () => {
    document.cookie = 'other=val';
    document.cookie = '__rf_disable=1';
    document.cookie = 'another=val2';
    expect(isDisabled({ rules: [] })).toBe(true);
  });

  it('does NOT disable for string "false" global', () => {
    (window as unknown as Record<string, unknown>).__RF_DISABLE__ = 'false';
    expect(isDisabled({ rules: [] })).toBe(false);
  });

  it('disables for string "true" global', () => {
    (window as unknown as Record<string, unknown>).__RF_DISABLE__ = 'true';
    expect(isDisabled({ rules: [] })).toBe(true);
  });

  it('disables for numeric 1 global', () => {
    (window as unknown as Record<string, unknown>).__RF_DISABLE__ = 1;
    expect(isDisabled({ rules: [] })).toBe(true);
  });

  it('does NOT disable for object {} global', () => {
    (window as unknown as Record<string, unknown>).__RF_DISABLE__ = {};
    expect(isDisabled({ rules: [] })).toBe(false);
  });
});
