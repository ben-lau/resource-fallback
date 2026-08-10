import { describe, expect, it } from 'vitest';

import { generateWebpackRuntimeBridge } from '../packages/webpack-plugin/src/runtime-bridge';

describe('webpack runtime bridge contract', () => {
  it('uses the private coordinator bridge instead of the removed resolver', () => {
    const source = generateWebpackRuntimeBridge();

    expect(source).not.toContain('resolver');
    expect(source).toContain('window.__RF__.internal');
    expect(source).toContain('internal.recover');
    expect(source).toContain('__rf_wrapped');
  });
});
