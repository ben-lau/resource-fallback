---
title: Reusable Principles
---

# V. Reusable Principles

1. **When multiple load mechanisms coexist, define ownership first** (Webpack script / Observer / SW / SystemJS); then implement retry — otherwise request volume grows multiplicatively.

2. **ESM failure is cacheable state**: break it with an **explicit URL change strategy**, not just a different DOM API.

3. **Vite dynamic import: late is safer than early**: the current implementation rewrites after **`writeBundle`** with **`es-module-lexer` + `MagicString`** to preserve **`__vitePreload` / `__vite__mapDeps` / async CSS** topology; treat **`renderBuiltUrl` / `renderDynamicImport`** as earlier, rejected approaches.

4. **Vite: `vite:preloadError` must `preventDefault()`, read payload from `payload`** — otherwise CSS preload failure throws and blocks **`__RF__.load()`**. The current page runtime only suppresses that throw; it does not turn the preload event itself into an old-Resolver failure record.

5. **When Vite `base` and rule `base` diverge, don't open the build gate**: use **`shouldRewriteUrls` (compare after `ensureTrailingSlash` on both sides)** to prevent accidental CDN URL assembly.

6. **Don't use `cloneNode` to swap script src**; create new elements + **attribute whitelist + SRI policy**.

7. **Use `getAttribute(src)` for prefix consistency** — avoid **`/` vs absolute URL** confusion.

8. **Use `joinAssetPrefix` for CDN prefix + filename** — avoid **`prod` + `js/x.js` → `prodjs`**.

9. **Webpack CSS chunk: suppress CSS loader reject in RuntimeModule**, not just Observer — otherwise **`import()` still fails**; iterate **`__webpack_require__.f` non-`j`**, not only **`miniCss`**.

10. **SystemJS and Observer must register URLs for mutual exclusion**.

11. **Only the SW legacy Resolver keeps the `isFallback === true` → `urls`-prefix-match rule**. Page-side recovery is now coordinated by `RecoveryCoordinator`, so do not treat Resolver match order, duplicate rule `base` precedence, or per-rule circuits as current page API.

12. **Page-side `rf:error` is a terminal signal, not a stable reason-string contract**: if you need evidence that fallback actually started, prefer `rf:retry` / `rf:fallback`; keep `no-match` / `rules-exhausted` discussion in historical or SW-specific contexts.

13. **SW default path must align with scope**: `scope: '/'` → `/rf-sw.js`; don't make **`Service-Worker-Allowed`** a default deploy burden.

14. **SW config can't rely on page `postMessage` alone**: preload manifest at build time for early img/font/CSS subresources.

15. **Opaque response is a policy choice**: default conservative; use **`fallbackOnOpaque`** to probe CORS and handle readable cross-origin HTTP errors, while remembering that opaque responses remain accepted when CORS is unavailable.

16. **SW local debug: check origin** — localhost, 127.0.0.1, LAN IP differ; LAN HTTP is not secure context.

17. **Verify visual resources by real load**: img → **`naturalWidth`**; font → **`document.fonts.check()`**; background → Network/SW events; **`toBeVisible()`** only proves DOM exists.

18. **Rules use string rule `base` only** — no RegExp / function matchers; SW preload embeds JSON-serializable config.

19. **SW events should target `clientId`** — broadcast pollutes multi-tab observability.

20. **SW ultimate failure should return `Response.error()`** — emit **`rf:error`** without fake 503 body.

21. **SW circuit must not share page `localStorage`** — page cross-tab state must not poison SW fetch decisions.

22. **Full fetch interception for arbitrary resources → lean SW**; **Webpack+Vite consistent runtime semantics → plugin + `__RF__` + Observer**.

---

Previous: [Case Studies](./case-studies.md) · Back to [Dev Experience Overview](./index.md)
