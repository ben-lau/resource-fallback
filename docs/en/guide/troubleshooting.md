---
title: Troubleshooting
outline: [2, 3]
---

# Troubleshooting

Start with one failed static asset. Use Network to check which URLs were requested, then use the `rf:*` events to find where recovery reached.

## Start with the symptom {#symptoms}

| Signal                                                     | Next check                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| Blank entry or failed lazy route                           | [Check startup and error boundaries](#entry-failure)                 |
| Slow recovery or termination before exhaustion             | [Timeouts and budgets](./configuration.md#timeouts)                  |
| The primary CDN failed with no `rf:retry` or `rf:fallback` | [Check the runtime and rule match](#rule-match)                      |
| `rf:fallback` fired, but the next request failed           | [Check the destination and response](#candidate-response)            |
| `rf:error` fired and the user outcome is unclear           | [Distinguish a terminal error from cache recovery](#terminal-result) |
| Scripts recover, but images or fonts fail                  | [Check Hybrid Service Worker](#service-worker)                       |

::: tip Reproduce one failure at a time
Use a production build and a fresh browser context. Open Network, block one lazy-loaded chunk on the primary CDN, and visit its route. The page can boot, so you can correlate events for that asset.
:::

## Blank entry or failed lazy route {#entry-failure}

For a blank entry, verify the runtime, initializer, and entry asset actually execute. Register [entry degradation](./runtime-events.md#degraded-ui-for-entry-failures) before the entry; waiting for React/Vue boot is too late.

If only a route fails, start with that route's JS and CSS requests. Handle terminal recovery in an application error boundary; do not create a reload loop from `rf:error`. If the expected backup request never appears, inspect rule matching next.

## Check the runtime and rule match {#rule-match}

1. In Network, find the first failed URL, including its path. Compare it with the build's Vite `base` or Webpack `output.publicPath`, then check which `rules[].base` matches the actual request. The longest matching prefix wins.
2. Check the built HTML and Console. Confirm that the runtime and its initialization script loaded and that the [kill switch](./csp-sri.md) is inactive. With `externalRuntime`, check the runtime URL and the CSP permission for inline initialization.
3. Register [event listeners](./runtime-events.md) before triggering the lazy load. By default, Vite enables full dynamic import recovery in production builds. Follow the [verification steps](./quick-start.md#verification) to reproduce it.

If the same URL recovers after `rf:retry`, expect `rf:success` as the terminal event. With `retry.max: 0`, a matching load failure can go directly to the next destination.

## Check the destination and response {#candidate-response}

- Use `rf:fallback.detail.from` and `to` to identify the two requests. After the prefix changes, confirm that the generated filename and asset subdirectory exist at the destination.
- Inspect the response body and `Content-Type`. A static server's SPA routing fallback may return HTML for a missing JS file. Network can show `200` even when the module fails to load.
- Confirm that each destination serves the same build output. Check Console for cross-origin, CSP, and integrity errors. If you use SRI, check the files and integrity policy against the [CSP and SRI guide](./csp-sri.md).
- When a destination never receives a request, check the `urls` order, whether an earlier destination already recovered, and whether the host's circuit is open. Use [debug logging](./best-practices.md#enable-debug-logging) to investigate.

### The fallback URL lost a path segment {#candidate-prefix}

Suppose the initial request is `https://cdn1.example.com/app/assets/app.js` and the rule's `base` is `https://cdn1.example.com/app/`. The first fallback replaces the full matching prefix and carries forward `assets/app.js`.

| First candidate in `urls`       | Fallback request in Network                  |
| ------------------------------- | -------------------------------------------- |
| `https://cdn2.example.com/`     | `https://cdn2.example.com/assets/app.js`     |
| `https://cdn2.example.com/app/` | `https://cdn2.example.com/app/assets/app.js` |

Use the second prefix if the backup CDN also serves the build under `/app/`. The same applies to the page origin, where the candidate is `'/app/'`. Compare `rf:fallback.detail.to` with the deployed path, then verify the response body contains the expected asset.

## Distinguish error from cache recovery {#terminal-result}

`rf:success.detail.url` points to the recovered asset. For page-side recovery, `rf:error.detail.url` points to the current destination when the session ends. That can be a backup CDN or the origin. An entry failure UI should match the entry's [full set of candidate URLs](./runtime-events.md#degraded-ui-for-entry-failures).

Hybrid SW can still find a Cache API response after exhausting network destinations. In that case, `rf:error` describes the network outcome. Check Network and the actual resource on the page to see whether the cache served it.

## Check Hybrid Service Worker {#service-worker}

1. In a secure context, check `navigator.serviceWorker.controller?.scriptURL`. Confirm the expected worker controls the page and its `scope` includes the page URL. On a first visit, return to the page after the worker is ready and try again.
2. Check the request's resource type and owner. Images, fonts, media, and eligible CSS subresources can use [Hybrid SW](./service-worker.md). Scripts use the page-side adapters.
3. A cross-origin `no-cors` request can produce an opaque response whose status the worker cannot read. If recovery needs to act on readable HTTP statuses, check the candidate's CORS response and `fallbackOnOpaque`.

## Verify before release {#release-checks}

| Scenario                     | What to check in Network                              | Runtime events and page behavior                                           |
| ---------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Healthy primary CDN          | The initial request succeeds                          | An initial success emits no recovery event                                 |
| Backup CDN available         | The backup CDN serves the asset                       | `rf:fallback.detail.to` points to the backup CDN, followed by `rf:success` |
| Origin only                  | The page origin serves the asset at the expected path | `rf:success.detail.url` points to the origin                               |
| All destinations unavailable | The configured candidates are exhausted               | `rf:error` fires and the expected degraded UI appears                      |

Play the last three scenarios in the [homepage request replay](../index.md#rf-trace-title) and open the event log to see the order. The replay allows one retry per URL. When the primary CDN fails twice and the backup succeeds on its first request, `rf:success.detail.attempts` is `3`.

Verify the entry script and a lazy-loaded chunk separately. For Hybrid SW, test an image or font used by the page with both a cold and a populated cache.
