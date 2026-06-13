---
title: Runtime Events
---

# Runtime Events

resource-fallback exposes a DOM CustomEvent API and optional JS function hooks for monitoring, alerting, and degraded UI.

## Event reference

| Event         | When fired                                        | `detail` fields         |
| ------------- | ------------------------------------------------- | ----------------------- |
| `rf:retry`    | Same URL is retried                               | `{ url, attempt }`      |
| `rf:fallback` | Switched to next candidate URL                    | `{ from, to, reason? }` |
| `rf:success`  | Resource loaded after at least one retry/fallback | `{ url, attempts }`     |
| `rf:error`    | All candidates exhausted, or no-match giveup      | `{ url, reason? }`      |

`reason` on `rf:error` may be:

- `'rules-exhausted'` — matched rule but all URLs failed
- `'no-match'` — URL did not match any rule (Observer still emits for debugging; **not** a full fallback chain)

::: warning rf:error semantics
`rf:error` with `reason: 'no-match'` means the runtime **did not take over** — e.g. third-party scripts. Do not treat all `rf:error` events as production incidents.
:::

## DOM listener examples

### Basic logging

```ts
window.addEventListener('rf:retry', (e) => {
  console.log('[RF] retry', e.detail);
});

window.addEventListener('rf:fallback', (e) => {
  console.log('[RF] fallback', e.detail.from, '→', e.detail.to);
});

window.addEventListener('rf:success', (e) => {
  console.log('[RF] success', e.detail.url, 'after', e.detail.attempts, 'attempts');
});

window.addEventListener('rf:error', (e) => {
  console.error('[RF] error', e.detail);
});
```

### Degraded UI for entry failures

Place early in `index.html` before the app bundle:

```html
<script>
  window.addEventListener('rf:error', function (e) {
    if (e.detail.reason === 'rules-exhausted') {
      document.body.innerHTML =
        '<p style="padding:2rem;text-align:center">Resources failed to load. Please refresh.</p>';
    }
  });
</script>
```

### Detect whether fallback actually ran

When testing non-matching URLs, only count `retry` or `fallback` as "intercepted":

```ts
const events: Array<{ type: string; detail: unknown }> = [];

['rf:retry', 'rf:fallback', 'rf:success', 'rf:error'].forEach((type) => {
  window.addEventListener(type, (e) => {
    events.push({ type, detail: (e as CustomEvent).detail });
  });
});

function didFallbackRun(since: number) {
  return events.slice(since).some((e) => e.type === 'retry' || e.type === 'fallback');
}
```

## JS function hooks

When using `externalRuntime: true`, pass hooks in config (functions cannot be JSON-serialized for inline injection):

```ts
window.__RF__.install({
  rules: [...],
  hooks: {
    onRetry:    (e) => monitor.send('resource.retry', e),
    onFallback: (e) => monitor.send('resource.fallback', e),
    onSuccess:  (e) => monitor.send('resource.success', e),
    onError:    (e) => monitor.send('resource.error', e),
  },
});
```

Or configure hooks at build time when `externalRuntime` is enabled:

```ts
resourceFallback({
  externalRuntime: true,
  rules: [...],
  hooks: {
    onError: (e) => {
      if (e.reason !== 'no-match') sentry.captureMessage('rf.error', e);
    },
  },
});
```

## Monitoring integration

Recommended pattern — hook DOM events:

```ts
window.addEventListener('rf:retry', (e) => {
  monitor.send('resource.retry', e.detail);
});
window.addEventListener('rf:fallback', (e) => {
  monitor.send('resource.fallback', e.detail);
});
window.addEventListener('rf:error', (e) => {
  if (e.detail.reason === 'no-match') return;
  monitor.send('resource.error', e.detail);
});
```

### Dashboard suggestions

| Metric          | Source                                                       |
| --------------- | ------------------------------------------------------------ |
| Retry rate      | `rf:retry` count by host                                     |
| Fallback rate   | `rf:fallback` `from` → `to`                                  |
| Exhaustion rate | `rf:error` where `reason === 'rules-exhausted'`              |
| Circuit trips   | host skipped in fallback chain (via logging + circuit state) |

### Hybrid SW events

SW events are bridged to the same `rf:*` events on the page that triggered the fetch (`clientId`). Rare requests without `clientId` fall back to window broadcast.

## Debug mode

Set `debug: 'auto'` (default) and enable at runtime:

```js
localStorage.__RF_DEBUG__ = '1';
location.reload();
```

## Related docs

- [Best Practices](./best-practices.md)
- [CSP & SRI](./csp-sri.md)
- [Configuration Reference](./configuration.md)
