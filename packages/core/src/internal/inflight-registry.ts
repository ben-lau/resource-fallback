export interface InFlightSession<T> {
  readonly promise: Promise<T>;
  readonly cancel: () => void;
}

export type InFlightKey = string;

export interface InFlightRegistry {
  getOrCreate<T>(key: InFlightKey, create: () => InFlightSession<T>): Promise<T>;
  cancelWhere(predicate: (key: InFlightKey) => boolean): void;
  dispose(): void;
  size(): number;
}

interface Entry<T> extends InFlightSession<T> {
  readonly key: InFlightKey;
}

export function createInFlightRegistry(): InFlightRegistry {
  const entries = new Map<InFlightKey, Entry<unknown>>();
  let disposed = false;

  function getOrCreate<T>(key: InFlightKey, create: () => InFlightSession<T>): Promise<T> {
    if (disposed) throw new Error('in-flight registry is disposed');
    const existing = entries.get(key);
    if (existing) return existing.promise as Promise<T>;

    const session = create();
    const entry: Entry<T> = { key, promise: session.promise, cancel: session.cancel };
    entries.set(key, entry as Entry<unknown>);
    const remove = () => {
      if (entries.get(key) === entry) entries.delete(key);
    };
    session.promise.then(remove, remove);
    return session.promise;
  }

  return {
    getOrCreate,
    cancelWhere(predicate) {
      for (const [key, entry] of entries) {
        if (predicate(key)) entry.cancel();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) entry.cancel();
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}
