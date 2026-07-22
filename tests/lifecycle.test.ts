import { describe, expect, it } from 'vitest';
import { createLifecycleManager } from '../packages/core/src/internal/lifecycle';

describe('lifecycle manager', () => {
  it('runs registered cleanup exactly once in reverse order', () => {
    const calls: number[] = [];
    const lifecycle = createLifecycleManager();
    lifecycle.add(() => calls.push(1));
    lifecycle.add(() => calls.push(2));
    lifecycle.dispose();
    lifecycle.dispose();
    expect(calls).toEqual([2, 1]);
    expect(lifecycle.disposed()).toBe(true);
  });

  it('removes an individual cleanup and runs additions after disposal immediately', () => {
    const calls: string[] = [];
    const lifecycle = createLifecycleManager();
    const remove = lifecycle.add(() => calls.push('removed'));
    lifecycle.add(() => calls.push('kept'));
    remove();
    lifecycle.dispose();
    lifecycle.add(() => calls.push('late'));
    expect(calls).toEqual(['removed', 'kept', 'late']);
  });
});
