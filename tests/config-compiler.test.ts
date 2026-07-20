import { describe, expect, it } from 'vitest';
import { compileRuntimeConfig } from '../packages/core/src/internal/config';

describe('compileRuntimeConfig', () => {
  it('normalizes, assigns stable ids, merges defaults, and freezes output', () => {
    const result = compileRuntimeConfig({
      rules: [{ base: 'https://a.test', urls: ['https://b.test'] }],
      defaults: { retry: { max: 1 } },
    });

    expect(result.rules[0]).toMatchObject({
      id: 'rule-0',
      base: 'https://a.test/',
      urls: ['https://b.test/'],
    });
    expect(result.rules[0].retry.max).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rules[0])).toBe(true);
    expect(Object.isFrozen(result.rules[0].retry)).toBe(true);
    expect(Object.isFrozen(result.rules[0].circuit)).toBe(true);
  });

  it.each([
    [{ base: '', urls: ['https://b.test/'] }, 'base'],
    [{ base: 'https://a.test/', urls: [] }, 'urls'],
    [{ base: 'https://a.test/', urls: ['https://b.test/', 'https://b.test/'] }, 'duplicate'],
  ])('rejects invalid rule %j', (rule, fragment) => {
    expect(() => compileRuntimeConfig({ rules: [rule] })).toThrow(fragment);
  });

  it('rejects duplicate candidates within a rule and malformed numeric values', () => {
    expect(() =>
      compileRuntimeConfig({
        rules: [{ base: 'https://a.test/', urls: ['https://b.test/', 'https://b.test/'] }],
      }),
    ).toThrow('duplicate');

    expect(() =>
      compileRuntimeConfig({
        rules: [{ base: 'https://a.test/', urls: ['https://b.test/'], retry: { max: -1 } }],
      }),
    ).toThrow('retry.max');

    expect(() =>
      compileRuntimeConfig({
        rules: [
          {
            base: 'https://a.test/',
            urls: ['https://b.test/'],
            circuit: { threshold: Number.NaN },
          },
        ],
      }),
    ).toThrow('circuit.threshold');
  });

  it('orders overlapping rules by longest base prefix', () => {
    const result = compileRuntimeConfig({
      rules: [
        { base: 'https://cdn.test/', urls: ['https://fallback.test/'] },
        { base: 'https://cdn.test/app/', urls: ['https://fallback.test/app/'] },
      ],
    });

    expect(result.rules.map((rule) => rule.base)).toEqual([
      'https://cdn.test/app/',
      'https://cdn.test/',
    ]);
  });
});
