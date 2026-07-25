import { describe, expect, it } from 'vitest';

import { createOwnershipRegistry } from '../packages/core/src/internal/ownership';

describe('ownership registry', () => {
  it('allows only one active lease per logical key', () => {
    const registry = createOwnershipRegistry();
    const first = registry.claim('webpack', 'chunk:42');

    expect(first).toMatchObject({ owner: 'webpack', logicalKey: 'chunk:42' });
    expect(registry.claim('observer', 'chunk:42')).toBeUndefined();
    expect(registry.isClaimed('chunk:42')).toBe(true);
  });

  it('releasing an old lease cannot release a replacement lease', () => {
    const registry = createOwnershipRegistry();
    const first = registry.claim('vite', 'url:/a.js')!;
    first.release();
    const second = registry.claim('observer', 'url:/a.js')!;

    first.release();
    expect(registry.isClaimed('url:/a.js')).toBe(true);
    second.release();
    expect(registry.isClaimed('url:/a.js')).toBe(false);
  });

  it('rejects claims after disposal and treats release as idempotent', () => {
    const registry = createOwnershipRegistry();
    const lease = registry.claim('systemjs', 'systemjs:/a.js')!;

    lease.release();
    lease.release();
    registry.dispose();

    expect(registry.claim('systemjs', 'systemjs:/a.js')).toBeUndefined();
    expect(registry.isClaimed('systemjs:/a.js')).toBe(false);
  });
});
