---
title: SW operations
description: Inspect the controlling worker, update its manifest, disable the intended registration, and verify existing clients.
outline: [2, 3]
---

# SW operations

Hybrid SW persists across page lifetimes. Check the page runtime, registration, and controlled clients separately when enabling, updating, or disabling it.

## Identify the controller {#controller}

Run in the target page's Console:

```js
console.log('controller', navigator.serviceWorker.controller?.scriptURL);
console.table(
  (await navigator.serviceWorker.getRegistrations()).map((registration) => ({
    scope: registration.scope,
    active: registration.active?.scriptURL,
    waiting: registration.waiting?.scriptURL,
    installing: registration.installing?.scriptURL,
  })),
);
```

For `scope: '/app/'`, the default script is `/app/rf-sw.js` on the page origin. Verify it returns JavaScript, not HTML. `ready` alone does not prove the expected worker controls this page; inspect `controller`.

## Updates and caches {#updates}

1. Deploy generated `rf-sw.js` and its manifest with the same application build.
2. Registration uses `updateViaCache: 'none'` and calls `registration.update()`; still inspect actual installation/activation in Application tools.
3. Activating a new manifest version cleans old `resource-fallback-*` caches. Cache is read only after that version's network recovery chain is exhausted.
4. Test existing/new tabs, first/controlled visits, and cold/warm caches. `rf:error` may precede cached recovery, so verify the actual resource outcome.

Manifest version includes assets, rules, and key cache policies. Worker circuit state is independent from page localStorage.

## Disable configuration and shut down {#disable}

Page query, cookie, and global kill switches stop this page's installation path; they do not immediately disable an already-controlling worker:

1. Keep the original `path` and `scope`, and set `enabled: false`, so cleanup does not revert to `/rf-sw.js`.
2. Publish the new HTML/config. The runtime attempts to unregister registrations whose **active script path** equals that path. Existing clients do not necessarily lose control immediately.
3. For manual cleanup, inspect registrations first, then target the script and scope below.
4. Close tabs still controlled by the old worker, reopen the page, and inspect controller, Network, and actual resources. If another PWA controls the page, evaluate its intended integration.

```ts
serviceWorker: {
  enabled: false,
  path: '/app/rf-sw.js',
  scope: '/app/',
}
```

```js
const expectedScript = new URL('/app/rf-sw.js', location.origin).href;
const expectedScope = new URL('/app/', location.origin).href;
for (const registration of await navigator.serviceWorker.getRegistrations()) {
  const scripts = [registration.active, registration.waiting, registration.installing];
  if (
    registration.scope === expectedScope &&
    scripts.some((worker) => worker?.scriptURL === expectedScript)
  ) {
    console.log('unregistered', await registration.unregister());
  }
}
```

Target only the verified library registration. Do not unregister every worker or clear all origin storage. Remove only verified library cache names after confirming no old client needs them; disabling and cache deletion are separate operations.

## Existing PWA / Workbox {#existing-pwa}

Inspect existing scopes before integration. Registering a different script for the same scope affects the existing registration, so an independent `rf-sw.js` cannot simply be layered over another PWA. This repository does not continuously validate a merged Workbox integration. Design unified worker routes or isolated scopes, then verify fetch ownership, cache updates, and shutdown.

To re-enable, deploy matching resources and worker first, enable the option, then repeat [release acceptance](./deployment.md#verification).
