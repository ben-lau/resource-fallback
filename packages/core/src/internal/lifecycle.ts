export interface LifecycleManager {
  add(cleanup: () => void): () => void;
  disposed(): boolean;
  dispose(): void;
}

interface CleanupEntry {
  active: boolean;
  cleanup: () => void;
}

export function createLifecycleManager(): LifecycleManager {
  const entries: CleanupEntry[] = [];
  let isDisposed = false;

  return {
    add(cleanup) {
      if (isDisposed) {
        cleanup();
        return () => {};
      }

      const entry: CleanupEntry = { active: true, cleanup };
      entries.push(entry);
      return () => {
        if (!entry.active) return;
        entry.active = false;
        cleanup();
      };
    },

    disposed() {
      return isDisposed;
    },

    dispose() {
      if (isDisposed) return;
      isDisposed = true;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!entry.active) continue;
        entry.active = false;
        entry.cleanup();
      }
      entries.length = 0;
    },
  };
}
