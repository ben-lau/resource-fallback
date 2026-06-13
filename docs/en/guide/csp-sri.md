---
title: CSP & SRI
---

# CSP & SRI

resource-fallback injects a runtime `<script>` into `<head>` by default. This page covers CSP compliance, SRI strategies, and kill switches.

## CSP: nonce support

Pass a nonce to the injected script tag:

```ts
resourceFallback({
  nonce: 'XYZ123',
  rules: [...],
});
```

CSP header example:

```
script-src 'nonce-XYZ123' https://cdn1.example.com https://cdn2.example.com;
```

The nonce is applied to the injected inline runtime script. Fallback domains used for script loading should also appear in `script-src` if scripts are loaded from those hosts.

## CSP: externalRuntime

When CSP forbids `unsafe-inline`, load the runtime as an external script:

```ts
resourceFallback({
  externalRuntime: true,
  externalRuntimePath: '/static/__rf/runtime.js',
  rules: [...],
});
```

Deploy `runtime.js` yourself — use `getRuntimeCode()` from `@resource-fallback/core` to get file contents:

```ts
import { getRuntimeCode, buildInjectedTags } from '@resource-fallback/core';
import { writeFileSync } from 'node:fs';

writeFileSync('public/static/__rf/runtime.js', getRuntimeCode());
```

CSP example:

```
script-src https://app.example.com/static/__rf/runtime.js https://cdn1.example.com;
```

::: tip hooks with externalRuntime
`hooks` (JS function callbacks) only work with `externalRuntime: true` because functions cannot be JSON-serialized into inline config.
:::

## SRI strategies

When Observer replaces `<script>` or `<link>` during fallback, the `sri` option controls `integrity` handling:

| Strategy          | Behavior                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `strip` (default) | Remove `integrity` on fallback — different CDNs typically produce different hashes               |
| `keep`            | Preserve `integrity`; browser verification failure triggers error and continues to next fallback |
| `strict`          | Same as `keep`, with more explicit semantics                                                     |

```ts
resourceFallback({
  sri: 'strip', // or 'keep' | 'strict'
  rules: [...],
});
```

::: info Preserving SRI across CDNs
To keep SRI on all CDNs, ensure **the same file produces the same hash on every CDN** — recommended: sync build artifacts to multiple object storage buckets.
:::

### SW and SRI

Service Worker returns different responses but **cannot modify** original HTML tag attributes. If a tag has `integrity` and fallback CDN content hash differs, browser verification fails even when SW fetch succeeds.

## Kill switch

Three ways to disable the runtime without a new release:

| Method          | Example                        | Use case                               |
| --------------- | ------------------------------ | -------------------------------------- |
| Global variable | `window.__RF_DISABLE__ = true` | Inline before runtime `<script>`       |
| Query parameter | Visit `?__rf=off`              | Temporary debugging                    |
| Cookie          | `__rf_disable=1`               | Gateway-level disable per session/user |

Customize names:

```ts
resourceFallback({
  disableGlobals: ['__RF_DISABLE__', '__MY_APP_RF_OFF__'],
  disableQueryParam: '__rf',
  disableCookie: '__rf_disable',
  rules: [...],
});
```

Kill-switch globals accept only `true`, `1`, `'1'`, or `'true'`.

Place global kill switch **before** the runtime script in HTML:

```html
<script>
  window.__RF_DISABLE__ = true;
</script>
<!-- runtime injected below -->
```

::: warning Emergency shutoff
Kill switch disables page runtime. If Hybrid SW is enabled, verify SW pass-through behavior separately — SW may continue serving cached fallback responses until unregistered.
:::

## Related docs

- [Configuration Reference](./configuration.md)
- [Runtime Events](./runtime-events.md)
- [Best Practices](./best-practices.md)
