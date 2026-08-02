import type { RecoveryOwner } from './recovery-types';

export interface OwnershipLease {
  readonly owner: RecoveryOwner;
  readonly logicalKey: string;
  release(): void;
}

export type OwnershipAdmission =
  | { readonly kind: 'acquired'; readonly lease: OwnershipLease }
  | { readonly kind: 'joined' }
  | { readonly kind: 'denied' };

export interface OwnershipRegistry {
  admit(owner: RecoveryOwner, logicalKey: string): OwnershipAdmission;
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
    admit(owner, logicalKey) {
      if (disposed) return { kind: 'denied' } as const;
      const current = active.get(logicalKey);
      if (current) {
        return current.owner === owner
          ? ({ kind: 'joined' } as const)
          : ({ kind: 'denied' } as const);
      }

      const token = Symbol(logicalKey);
      active.set(logicalKey, { owner, token });
      let released = false;
      const lease: OwnershipLease = {
        owner,
        logicalKey,
        release() {
          if (released) return;
          released = true;
          const activeLease = active.get(logicalKey);
          if (activeLease?.token === token) active.delete(logicalKey);
        },
      };

      return { kind: 'acquired', lease } as const;
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
