---
title: CSP & SRI
---

# CSP & SRI

resource-fallback injects a runtime `<script>` into `<head>` by default. In the default mode, one inline script runs the runtime IIFE and calls `install(...)`; with `externalRuntime`, only the runtime IIFE becomes external and the automatic `install(...)` call remains inline. This page covers CSP compliance, SRI strategies, and kill switches.

## CSP: no `unsafe-eval` required

The runtime IIFE targets es2020 and uses native `import()` for dynamic loads — **not** `Function('u','return import(u)')`. CSP does **not** need `script-src 'unsafe-eval'`. Any automatically injected inline script still needs a `nonce`; `externalRuntime` does not authorize the automatic inline `install(...)` call.

## CSP: nonce support

Pass a nonce to every injected script tag, including the inline `install(...)` script used with `externalRuntime`:

```ts
resourceFallback({
  nonce: 'XYZ123',
  rules: [...],
});
```

CSP header example:

```
script-src 'self' 'nonce-XYZ123' https://cdn1.example.com https://cdn2.example.com;
```

The nonce is applied to every injected script tag. Fallback domains used for script loading should also appear in `script-src` if scripts are loaded from those hosts.

## CSP: externalRuntime (the automatic initializer still needs a nonce)

`externalRuntime` moves the runtime IIFE into an external script, which can reduce inline code. The plugin still injects a second inline `window.__RF__.install(...)` script, so CSP that forbids unauthorized inline scripts must also configure a nonce:

```ts
resourceFallback({
  nonce: 'XYZ123',
  externalRuntime: true,
  externalRuntimePath: '/static/__rf/runtime.js',
  rules: [...],
});
```

Deploy `runtime.js` yourself — use `getRuntimeCode()` from `@resource-fallback/core` to get file contents:

```ts
import { getRuntimeCode } from '@resource-fallback/core';
import { writeFileSync } from 'node:fs';

writeFileSync('public/static/__rf/runtime.js', getRuntimeCode());
```

CSP example:

```
script-src 'self' 'nonce-XYZ123' https://cdn1.example.com;
```

If the runtime file is not same-origin, add its origin to `script-src` as well.

::: tip hooks with externalRuntime
`externalRuntime` only changes where the runtime script is placed for CSP. It does **not** make build-config callbacks serializable. `buildInjectedTags()` and plugin-generated `window.__RF__.install(...)` calls still serialize config first, so function-valued `hooks` are dropped in auto-injected setups.
:::

If you manually call `window.__RF__.install()` in page code and pass live function objects yourself, hooks work without requiring `externalRuntime: true`. The key is avoiding build-time serialization:

```ts
window.__RF__.install({
  rules: [...],
  hooks: {
    onError: (e) => monitor.send('resource.error', e),
    onFallback: (e) => monitor.send('resource.fallback', e),
  },
});
```

For auto-injected setups, prefer DOM `rf:*` events. Under a strict CSP, `nonce` and `externalRuntime` are complementary: the nonce authorizes the inline initializer, while `externalRuntime` only controls where the runtime IIFE is placed.

## CSP sources by resource type

When CSP limits the origins for a resource type, include the primary and fallback origins actually used in the corresponding directive:

| Resource type                 | resource-fallback path              | Relevant CSP directive |
| ----------------------------- | ----------------------------------- | ---------------------- |
| JavaScript                    | Page Observer / build-tool adapters | `script-src`           |
| Stylesheets and CSS `@import` | Page Observer / Hybrid SW           | `style-src`            |
| Images, including CSS `url()` | Hybrid SW                           | `img-src`              |
| Fonts                         | Hybrid SW                           | `font-src`             |
| Audio and video               | Hybrid SW                           | `media-src`            |

This table covers CSP source restrictions only. Cross-origin fonts and Hybrid SW requests must still satisfy browser CORS, MIME, SRI, and related security constraints.

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

| Method          | Example                        | Use case                                                             |
| --------------- | ------------------------------ | -------------------------------------------------------------------- |
| Global variable | `window.__RF_DISABLE__ = true` | Nonced inline script or authorized external bootstrap before runtime |
| Query parameter | Visit `?__rf=off`              | Temporary debugging                                                  |
| Cookie          | `__rf_disable=1`               | Gateway-level disable per session/user                               |

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

### Strict CSP and the global kill switch

The inline global bootstrap is also subject to `script-src`. Use the same per-response nonce supplied to the CSP header and `resourceFallback({ nonce })` (`XYZ123` below is a placeholder), and run it **before** the runtime script:

```html
<script nonce="XYZ123">
  window.__RF_DISABLE__ = true;
</script>
<!-- runtime injected below -->
```

If the policy disallows an inline bootstrap entirely, put the same assignment in an external script authorized by `script-src` that runs before the runtime.

::: warning Emergency shutoff
Kill switch disables page runtime. If Hybrid SW is enabled, verify SW pass-through behavior separately — SW may continue serving cached fallback responses until unregistered.
:::

## Related docs

- [Configuration Reference](./configuration.md)
- [Runtime Events](./runtime-events.md)
- [Best Practices](./best-practices.md)
