---
title: Reusable Principles
---

# V. Reusable Principles

1. **When multiple load mechanisms coexist, define ownership first** (Webpack script / Observer / SW / SystemJS); then implement retry — otherwise request volume grows multiplicatively.

2. **ESM failure is cacheable state**: break it with an **explicit URL change strategy**, not just a different DOM API.

3. **Vite dynamic import: late is safer than early**: rewrite after **`writeBundle`** with **`es-module-lexer` + `MagicString`** to preserve **`__vitePreload` / `__vite__mapDeps` / async CSS** topology; avoid **`renderBuiltUrl`/`renderDynamicImport`** breaking analysis.

4. **Vite: `vite:preloadError` must `preventDefault()`, read payload from `payload`** — otherwise CSS preload failure throws and blocks **`__RF__.load()`**.

5. **When `base` and `match` diverge, don't open the build gate**: use **`shouldRewriteUrls`** to prevent accidental CDN URL assembly.

6. **Don't use `cloneNode` to swap script src**; create new elements + **attribute whitelist + SRI policy**.

7. **Use `getAttribute(src)` for prefix consistency** — avoid **`/` vs absolute URL** confusion.

8. **Use `joinAssetPrefix` for CDN prefix + filename** — avoid **`prod` + `js/x.js` → `prodjs`**.

9. **Webpack CSS chunk: suppress CSS loader reject in RuntimeModule**, not just Observer — otherwise **`import()` still fails**; iterate **`__webpack_require__.f` non-`j`**, not only **`miniCss`**.

10. **SystemJS and Observer must register URLs for mutual exclusion**.

11. **Resolver: `urls`-prefix match only when `isFallback === true`**; separate **circuit vs first-match semantics**; **duplicate match — last wins**.

12. **`rf:error` ≠ always ran fallback**: split **no-match** in UI and alerts.

13. **SW default path must align with scope**: `scope: '/'` → `/rf-sw.js`; don't make **`Service-Worker-Allowed`** a default deploy burden.

14. **SW config can't rely on page `postMessage` alone**: preload manifest at build time for early img/font/CSS subresources.

15. **Opaque response is a policy choice**: default conservative; use explicit **`fallbackOnOpaque`** when cross-origin opaque errors must trigger origin fallback.

16. **SW local debug: check origin** — localhost, 127.0.0.1, LAN IP differ; LAN HTTP is not secure context.

17. **Verify visual resources by real load**: img → **`naturalWidth`**; font → **`document.fonts.check()`**; background → Network/SW events; **`toBeVisible()`** only proves DOM exists.

18. **SW preload with `RegExp` cannot use bare `JSON.stringify`** — rules become `{}`, fetch never matches.

19. **SW events should target `clientId`** — broadcast pollutes multi-tab observability.

20. **SW ultimate failure should return `Response.error()`** — emit **`rf:error`** without fake 503 body.

21. **SW circuit must not share page `localStorage`** — page cross-tab state must not poison SW fetch decisions.

22. **Full fetch interception for arbitrary resources → lean SW**; **Webpack+Vite consistent runtime semantics → plugin + `__RF__` + Observer**.

---

Previous: [Case Studies](./case-studies.md) · Back to [Dev Experience Overview](./index.md)
