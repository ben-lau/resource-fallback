---
title: Best Practices
---

# Best Practices

Production recommendations for configuring, debugging, and operating resource-fallback.

## Rule configuration

### Align rule `base` with Vite `base` / `publicPath`

| Build tool | Align rule `base` with |
| ---------- | ---------------------- |
| Vite       | Vite `base`            |
| Webpack    | `output.publicPath`    |

If the first resource URL does not match the rule `base`, the runtime never enters retry/fallback. Vite's config `base` and `FallbackRule.base` share a name — keep them equal in practice.

### urls order is fallback order

Recommended chain:

```
Primary CDN → Backup CDN → Self-hosted static origin → Same-origin '/'
```

The last entry is usually `'/'` (relative origin) to avoid hitting a broken CDN again.

```ts
{
  base: 'https://cdn.example.com/',
  urls: [
    'https://cdn-backup.example.com/',
    'https://static.mysite.com/',
    '/', // origin — always last
  ],
}
```

### Use trailing slashes on CDN prefixes

Prefix URLs should end with `/` (e.g. `https://cdn.example.com/`). The runtime uses `joinAssetPrefix` to avoid malformed paths like `...prod` + `js/foo.js` → `...prodjs/foo.js`.

### Per-rule retry and circuit

Override per rule when different asset classes need different policies:

```ts
rules: [
  {
    base: 'https://cdn.example.com/',
    urls: ['https://cdn-backup.example.com/', '/'],
    retry: { max: 2, baseDelay: 300 },
    circuit: { threshold: 3, cooldown: 30000 },
  },
],
defaults: {
  retry: { max: 2 },
  circuit: { threshold: 5, cooldown: 30000, shareAcrossTabs: true },
},
```

Keep `retry.max` between 1–3. Excessive retries increase user wait time.

## CDN prefix notes

- **Same artifact on all CDNs** — required for `sri: 'keep'` / `'strict'`
- **CORS headers on fonts** — fallback font origins need `Access-Control-Allow-Origin` for cross-origin `@font-face`
- **preconnect** — leave `injectPreconnect: true` (default) to reduce DNS + TLS latency on fallback hosts

## Debugging tips

### Enable debug logging

```js
localStorage.__RF_DEBUG__ = '1';
location.reload();
```

Or set `debug: true` in config (always logs — use sparingly in production).

### Verify in the right environment

| Environment                 | Dynamic import fallback |
| --------------------------- | ----------------------- |
| Vite `dev`                  | ✗ Not supported         |
| Vite `preview` / production | ✓                       |
| Webpack production          | ✓                       |

### Network panel checklist

1. First request to primary CDN fails
2. Retries on same host (with `__rf=` on module scripts)
3. Fallback to next URL in `urls`
4. Final success or `rf:error`

### Hybrid SW debugging

- Use `localhost`, `127.0.0.1`, or HTTPS — not LAN IP over HTTP
- Clear old SW + caches after rebuild
- Verify `navigator.serviceWorker.controller?.scriptURL` matches current build

## Monitoring

Filter `rf:error` by reason:

```ts
window.addEventListener('rf:error', (e) => {
  if (e.detail.reason === 'no-match') return; // expected for third-party scripts
  analytics.track('resource_fallback_exhausted', e.detail);
});
```

Track fallback chains:

```ts
window.addEventListener('rf:fallback', (e) => {
  analytics.track('resource_fallback_switch', {
    from: e.detail.from,
    to: e.detail.to,
  });
});
```

See [Runtime Events](./runtime-events.md) for full API.

## Entry and lazy-route fallback UI

1. **Entry bundle** — add `rf:error` listener in `index.html` before app scripts
2. **Lazy routes** — wrap `React.lazy` / async components with ErrorBoundary
3. **Do not auto-reload on `rf:error`** — the library intentionally leaves recovery to the application

## Sync script limitations

When a classic (non-module) `<script>` fails:

- Browser fires `error` only — **already-executed code is irreversible**
- The plugin replaces the DOM node and reloads, but re-execution may cause side effects if globals were partially mounted
- When all URLs are exhausted, **only `rf:error` fires** — no automatic `location.reload()`

Hybrid SW does not take over scripts and does not guarantee strict ordering for synchronous classic scripts. Strong ordering requires a future opt-in ScriptSequencer capability.

## Related docs

- [Quick Start](./quick-start.md)
- [Configuration Reference](./configuration.md)
- [Dev Experience: Principles](../experience/principles.md)
