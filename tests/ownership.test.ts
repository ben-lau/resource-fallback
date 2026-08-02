import { describe, expect, it } from 'vitest';

import { createOwnershipRegistry } from '../packages/core/src/internal/ownership';

describe('ownership registry', () => {
  it('lets the same owner join without acquiring a second lease', () => {
    const registry = createOwnershipRegistry();
    const first = registry.admit('vite', 'url:/a.js');
    const joined = registry.admit('vite', 'url:/a.js');
    const denied = registry.admit('observer', 'url:/a.js');

    expect(first.kind).toBe('acquired');
    expect(joined).toEqual({ kind: 'joined' });
    expect(denied).toEqual({ kind: 'denied' });
    if (first.kind === 'acquired') first.lease.release();
  });

  it('allows only one active lease per logical key', () => {
    const registry = createOwnershipRegistry();
    const first = registry.admit('webpack', 'chunk:42');

    expect(first).toMatchObject({
      kind: 'acquired',
      lease: { owner: 'webpack', logicalKey: 'chunk:42' },
    });
    expect(registry.admit('observer', 'chunk:42')).toEqual({ kind: 'denied' });
    expect(registry.isClaimed('chunk:42')).toBe(true);
  });

  it('releasing an old lease cannot release a replacement lease', () => {
    const registry = createOwnershipRegistry();
    const first = registry.admit('vite', 'url:/a.js');
    if (first.kind !== 'acquired') throw new Error('expected acquired lease');
    first.lease.release();
    const second = registry.admit('observer', 'url:/a.js');
    if (second.kind !== 'acquired') throw new Error('expected replacement lease');

    first.lease.release();
    expect(registry.isClaimed('url:/a.js')).toBe(true);
    second.lease.release();
    expect(registry.isClaimed('url:/a.js')).toBe(false);
  });

  it('rejects claims after disposal and treats release as idempotent', () => {
    const registry = createOwnershipRegistry();
    const lease = registry.admit('systemjs', 'systemjs:/a.js');
    if (lease.kind !== 'acquired') throw new Error('expected acquired lease');

    lease.lease.release();
    lease.lease.release();
    registry.dispose();

    expect(registry.admit('systemjs', 'systemjs:/a.js')).toEqual({ kind: 'denied' });
    expect(registry.isClaimed('systemjs:/a.js')).toBe(false);
  });
});
