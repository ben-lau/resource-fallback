import type { RecoveryOwner } from './recovery-types';

export interface OwnershipLease {
  readonly owner: RecoveryOwner;
  readonly logicalKey: string;
  release(): void;
}

export interface OwnershipRegistry {
  claim(owner: RecoveryOwner, logicalKey: string): OwnershipLease | undefined;
  isClaimed(logicalKey: string): boolean;
  dispose(): void;
}

interface ActiveLease {
  readonly owner: RecoveryOwner;
  readonly token: symbol;
}

export function createOwnershipRegistry(): OwnershipRegistry {
  const active = new Map<string, ActiveLease>();
  let disposed = false;

  return {
    claim(owner, logicalKey) {
      if (disposed || active.has(logicalKey)) return undefined;

      const token = Symbol(logicalKey);
      active.set(logicalKey, { owner, token });
      let released = false;

      return {
        owner,
        logicalKey,
        release() {
          if (released) return;
          released = true;
          const current = active.get(logicalKey);
          if (current?.token === token) active.delete(logicalKey);
        },
      };
    },

    isClaimed(logicalKey) {
      return active.has(logicalKey);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      active.clear();
    },
  };
}
