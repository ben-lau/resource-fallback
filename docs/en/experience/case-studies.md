---
title: Case Studies
---

# IV. Problems Solved in This Repo (Background → Thinking → Solution)

## 4.1 Webpack: global Observer and chunk runtime both handle the same failure

### Background

Webpack 5 async chunks load via runtime calling something like `__webpack_require__.l` to append `<script>` to the DOM. To cover **entry scripts**, **async JS**, and **CSS chunks**, the project uses both:

- Browser: **`window.addEventListener('error', …, true)`** for script/link target-phase errors
- Webpack: retry/fallback injected into the **script load path**

So **one script load failure** bubbles through both: runtime may retry from `script.onerror`, while capture-phase listener runs `resolver.resolve` → scheduleReplace — **two independent state machines**. Network shows roughly **double** the expected rounds for `retry.max` and `urls.length`; circuit breaker and logs look noisy.

Webpack tags async chunk `<script>` with **`data-webpack="..."`**. Extracted styles often appear as **`<link data-webpack="...">`**; webpack's chunk JS loader **does not symmetrically handle `<link>` failure chains** — if Observer fully exits, CSS chunks go unmanaged.

### Thinking

Confirm **double subscription**: disable one side, see if request rounds halve.

Ownership cannot be "skip everything with `data-webpack`" — that abandons CSS.

Conclusion: **each failure owned by exactly one path**; **CSS** has no symmetric runtime adapter, so **Observer must still see `<link>` errors**.

### Solution

In `packages/core/src/runtime/observer.ts`:

1. **`isWebpackChunkScript(el)`**: when `tagName === 'SCRIPT'` and **`data-webpack`** exists, **return** — async JS chunks handled only by **`@resource-fallback/webpack-plugin` RuntimeModule** wrapping `__webpack_require__.l`.

2. **No same exemption for `<link>`** — even with `data-webpack`, **LINK still goes to Observer** (mini-css-extract output).

3. **Entry bundles** usually lack `data-webpack` — Observer still covers them.

Expected: **one failure → one retry/fallback sequence**; rf events align with webpack console.

### Extension: async CSS chunk — Observer alone cannot stop **`Promise.all` reject**

**Background**: mini-css-extract, webpack **`experiments.css`**, etc. register **non-`j` loaders** on **`__webpack_require__.f`** (e.g. **`miniCss`**). Async splits with separate **`.css` chunks`** make `__webpack_require__.e(chunkId)` a **`Promise.all`** of `l.f.j` and CSS loader promises. **CSS `<link>` failure** → plugin **`onerror` rejects `ChunkLoadError`** (`code: 'CSS_CHUNK_LOAD_FAILED'`, **`request`** points at `.css` URL).

Observer can **replace `<link>`** in capture phase — **DOM may recover** — but **reject already happened**, entire **`import()` fails**, React/Vue lazy routes show **ErrorBoundary / white screen**. Same class as Vite **`vite:preloadError` not `preventDefault`** — **error channel short-circuits before recovery**.

Not limited to mini-css: any **non-`j`** loader on **`__webpack_require__.f`** with **reject + CSS-like URL** needs the same strategy.

**Solution**: In injected **`RuntimeModule`** (same stage as **`__webpack_require__.l` wrap**, **STAGE_TRIGGER**): **iterate `Object.keys(__webpack_require__.f)`, skip `"j"`**, wrap each unmarked function loader — after **`origFn(chunkId, promises)`**, **`.catch`** on newly added promise entries:

- If **`err.code === 'CSS_CHUNK_LOAD_FAILED'`** or **`err.request` matches `.css` suffix**: **`resolver.recordFailure(err.request)`**, **swallow reject** so **`Promise.all` does not fail**
- Other errors **rethrow** (don't break Module Federation remotes, etc.)

CSS loading still via Observer **`<link>`** (unchanged ownership). See **`examples/webpack-react`** lazy-b with **`*.css` chunk** E2E.

---

## 4.2 Vite: `import()` failure cannot be fixed by DOM alone; rewriting too early breaks preload/CSS topology

### Background

Vue/React Router lazy loads become:

```js
import('./views/About-xxxx.js');
```

Failure comes from **`import()` Promise**, not necessarily a replaceable static `<script src>`. Observer-only approach:

- White screen — **dynamic import rejection** never becomes "swap URL and retry"
- Or hidden: **async route CSS** depends on **`__vitePreload` / import graph** — rewriting before Rollup/Vite finishes breaks **preload map vs real imports** → **page loads but no styles**

Early attempts with `renderDynamicImport` alone fought **preload generation order**.

### Thinking

- Manual try/catch per `lazy` — unmaintainable
- Pure HTML/onerror — doesn't cover **`import()` graph**
- **Latest safe point**: after Vite writes chunks to disk, when **`dynamicImports`, `__vitePreload`, CSS refs are final** — **text-level auditable replacement**

### Solution

`packages/vite-plugin/src/index.ts`:

1. **No early transform** of blocks containing `__vitePreload`; use **`async writeBundle(options, bundle)`**

2. For each Rollup chunk: skip if no `dynamicImports`; read **final source** from disk

3. **`es-module-lexer` `parse(code)`**: only **`imp.d >= 0`** (dynamic); **`imp.n`** must be string literal; normalize path relative to chunk dir; verify in **`chunk.dynamicImports`**

4. **`MagicString`**: `s.overwrite(imp.ss, imp.se, …)` → full statement:

   `window.__RF__.load(JSON.stringify(normalizedRelativePath))`

5. **`__RF__.load`** in `packages/core/src/runtime/adapter-vite.ts`: native browser **`import(url)`** in the loop (IIFE targets es2020 — no `Function(...)` / `unsafe-eval`), with the same **`resolver`**, preserving **preload topology** while adding retry/fallback/cache bust.

Gate: **§4.4 `shouldRewriteUrls`** — only rewrite when Vite `base` equals a rule `base` after `ensureTrailingSlash`.

### Extension: `vite:preloadError` can block subsequent JS dynamic load

**Background**: **`__vitePreload`** dispatches **`vite:preloadError`** (cancelable) on CSS preload failure; **`defaultPrevented` false → throw**. If dynamic import became **`__vitePreload(..., () => __RF__.load(...))`**, **CSS preload failure throws first** — **`__RF__.load()` never runs** — About chunk JS never loads.

Payload is on **`event.payload`**, not `detail`; without **`preventDefault()`**, behavior equals unhandled.

**Solution**: In `installViteAdapter`, on **`vite:preloadError`**: **`preventDefault()`**, parse URL from **`payload`**, **`recordFailure`** / observability; **CSS entity load** still via Observer **`<link rel="stylesheet">`**.

---

## 4.3 Browser: ES Module failed URL / module map cache; re-inserting same URL is ineffective

### Background

For **`type="module"`** or runtime **`import(specifier)`**: once an absolute URL fails, browser **caches failure**. **`replaceChild` with same `src`** may not trigger new GET or re-enters same failed module record — "rf:retry" fires but Network is flat.

When switching to **new host** in `urls`, carrying retry-only query long-term **dilutes CDN edge cache**.

### Thinking

- Classic script: new tag often triggers new request — no default cache bust
- **`type="module"` / dynamic import**: need **new URL string for module loader** — **`?__rf=attempt-nonce`**; strip when switching **fallback host**
- Observer and **`__RF__.load`** must **align** append/strip semantics

### Solution

**Observer** (`observer.ts`):

1. **`needsCacheBust(el)`**: **`SCRIPT` + `type === 'module'`** only
2. **retry**: `appendRetryParam(result.url, attempt)` on same logical URL
3. **fallback**: `fetchUrl = stripRetryParam(result.url)`; reset **`data-rf-attempt`** for new host retry budget

**Vite adapter** (`adapter-vite.ts`): **`__RF__.load`** uses **`appendRetryParam`** on retry after catch — same rationale.

Expected: each real retry shows **changed URL or host** in Network.

---

## 4.4 Vite `base: '/'` but rules use CDN rule `base` — async chunks wrongly point at CDN

### Background

Common misconfiguration:

- Local Vite **`base: '/'`**, production should be CDN Vite `base`
- Repo has **CDN rule `base`/`urls` hardcoded** while CI **Vite `base` not switched**

Historical root cause (old API): **`matchesFilename` treated string `match` as matching any filename** → **`resolveBuiltUrl(any file)`** became CDN URL even in dev/preview. Current API requires string rule **`base`** and a rewrite gate that compares Vite `base` to rule `base` after trailing-slash normalization.

Symptoms: **Vite `base` is `/` but lazy load hits `https://cdn.../assets/xxx.js`** — Mixed Content/CORS; violates "don't change semantics when misaligned".

### Thinking

Two gates:

1. **Build-time rewrite**: only when **Vite `base` is strictly equal to at least one rule `base`**
2. **Runtime Observer**: manual CDN `<script src>` whose prefix matches rule `base` can still fallback without rewriting Vite chunks

### Solution

`vite-plugin` **`configResolved`**:

- **`shouldRewriteUrls = options.rules.some((r) => ensureTrailingSlash(viteBase) === ensureTrailingSlash(r.base))`** — trailing-slash normalization; no RegExp / function
- **`writeBundle`**: `if (!shouldRewriteUrls) return;`

| Scenario                                              | Behavior                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| Vite `base` strictly equals a rule `base`             | Rewrite literal dynamic import → **`__RF__.load`**                              |
| Vite `base` is `/`, rules target CDN only (not equal) | **No rewrite**; hand-written CDN scripts still Observer if they hit rule `base` |

---

## 4.5 `<script>` `cloneNode` to preserve attrs then change `src` — new script may not execute

### Background

Intuitive fix: **`el.cloneNode(true)`**, change `src`, **`replaceChild`**. Cloned script may inherit internal slots — spec may **forbid re-fetch** → silent Network, stuck half-init. Not like cloning a `div`.

### Thinking

**Create fresh element** with **attribute whitelist** — align SRI/nonce/CSP.

### Solution

`observer.ts` **`cloneTag`** (actually **create**, not clone):

1. **`document.createElement`** new script/link
2. **`SCRIPT_FORWARDED_ATTRS` / `LINK_FORWARDED_ATTRS`** whitelist
3. **`sri`**: `strip` skips `integrity`; `keep`/`strict` preserve
4. Mark **`data-rf-attempt` / `data-rf-managed`**; **`fresh.src = newUrl`**
5. **`replaceChild`** or **`setTimeout(swap, delay)`**

Works with §4.3 URL rewrite: **new node** + stripped or `__rf` URL.

---

## 4.6 Rule `base: '/'` but runtime reads `script.src` as absolute URL — prefix match fails

### Background

Config uses site-root prefix **`base: '/'`**. **`<script src="/assets/index.js">`** → **`.src`** normalizes to **`https://origin/assets/…`**. String prefix **`url.indexOf('/') === 0`** fails on **`https://…`** — Observer never intervenes.

### Thinking

Compare **same URL dimension** as config — use **`getAttribute('src')`/`href`**, not canonicalized `.src`.

### Solution

`readUrl(el)`: **`el.getAttribute('src')` or `getAttribute('href')`** only.

**`base: '/'` + `<script src="/assets/…">`** still prefix-matches. Ensure **rule `base` matches the attribute literal** if frameworks write absolute URLs.

---

## 4.7 SystemJS (legacy) vs Observer fighting the same load — double fallback or gaps

### Background

`@vitejs/plugin-legacy` uses **SystemJS**. Without coordination, global Observer and SystemJS adapter both handle failures → **double requests** or conflicting DOM rewrites.

### Thinking

Same as §4.1: **ownership first**. SystemJS needs **runtime URL registration** — Observer skips registered URLs.

**Option A (rejected)**: fully replace `instantiate`, create own `<script>` — duplicates SystemJS internals.

**Option B (adopted)**: thin wrap **`instantiate`**, delegate to **`origInstantiate`**, retry/fallback in **`.catch()`**, register URL in **`systemjsManagedUrls` Set**.

### Solution

Observer: if **`readUrl(el)` in `systemjsManagedUrls`**, **return**. Legacy and modern share **circuit + urls semantics** without double-counting retries.

---

## 4.8 Resolver: try initial URL first, circuit vs `urls`, `findPrepared`/`isFallback`

### Background

Product requirements:

1. **Each session still tries primary CDN first**
2. **Skip dead fallback hosts**
3. **Don't mis-route odd URLs** via accidental url-prefix match

### Thinking

`packages/core/src/runtime/resolver.ts`:

- **`findPrepared(url, isFallback)`**: scan **end to start** (last rule wins); always **prefix-match rule `base`**; **only if `isFallback === true`** allow **`url.indexOf(r.raw.urls[j])===0`**
- **`resolve`**: no match → **`giveup: 'no-match'`**; retry budget → retry; else **`recordFailure(host)`** → **`pickNextUrl`**
- **Path strip / swap**: rule `base` may differ from `urls` list prefixes
- **`resolveBuiltUrl`**: filename → first URL via rule `base`; **circuit does not skip first-load URL**; **last matching rule wins**; still **must pair with §4.4 gate**

Use **`joinAssetPrefix`** in **`swap`** to avoid **`prod` + `js/foo.js` → `prodjs/foo.js`**.

---

## 4.9 Observability: `giveup`/no-match also fires `rf:error` — not "full fallback ran"

### Background

Debug listeners push all **`rf:*`** to **`window.__RF_EVENTS__`**. Unmatched script failure → **`giveup: 'no-match'`** → **`emitError`**. Counting any **`rf:error`** as "library intercepted" is **false positive**.

Monitoring treating all **`rf:error`** as incidents → **alert noise** (third-party scripts).

### Solution

Demos: only **`retry` or `fallback`** in new event slice means **"entered fallback state machine"**; **`error` only** → UI shows **"not intercepted (expected)"**. Production: filter **`detail.reason`**.

---

## 4.10 Hybrid Service Worker: images/fonts/CSS subresources — SW is not universal onerror

### Background

Hybrid SW **supplements** Observer/Vite/Webpack/SystemJS — covers **`img`, `@font-face`, CSS `url()`, media, controlled `@import`**.

Typical SW pitfalls exposed:

- Default **`path: '/__rf/sw.js'` + `scope: '/'`** needs **`Service-Worker-Allowed: /`** — bad library default
- **Page `postMessage` too late** — early img/font requests before config
- **`no-cors` img/CSS** → opaque response, can't read status; fake CDN errors look like success
- **LAN IP HTTP** not secure context — SW won't register
- **Old SW persists** after rebuild
- **`toBeVisible()` ≠ resource loaded** — check `naturalWidth`, `document.fonts.check()`, SW events

### Thinking

**Hybrid ownership**:

- **script / dynamic import / webpack async / SystemJS** → page adapters (Promise, module map, CSS reject, SRI)
- **image / font / media / CSS subresources** → SW
- **Top-level stylesheet** → Observer (avoid duplicate `<link>` handling)
- **CSS `@import`** only when `destination === 'style'` and referrer matches manifest CSS

### Solution

1. **Default path follows scope**: `/` → `/rf-sw.js`, `/app/` → `/app/rf-sw.js`
2. **Manifest preloaded in SW file** via **`self.__RF_SW_PRELOAD__`** — rules use string rule `base` only (JSON-serializable; no RegExp / function match)
3. **`fallbackOnOpaque` opt-in** for cross-origin opaque as failure
4. **Conservative Cache API** — fallback 2xx only; versioned namespace; cleanup on activate
5. **Vite/Webpack emit SW + manifest**; webpack from `getAssets()` + HtmlWebpackPlugin tags
6. **Events via `clientId`**; ultimate reject → **`rf:error` + `Response.error()`**; SW **isolated circuit** (no page `localStorage`)

### Troubleshooting

- Secure context: localhost/127.0.0.1/HTTPS
- Clear SW + caches before judging new build
- Check **`navigator.serviceWorker.controller?.scriptURL`**
- Fonts: use real `.ttf/.woff2`, assert **`document.fonts.check()`**

### Highlight

Not "add another SW" — **clear owner, timing, observability per resource type**; manifest preload removes postMessage race; `clientId` targeting; `Response.error()` preserves network semantics.

---

Previous: [OSS Comparison](./comparison.md) · Next: [Reusable Principles](./principles.md)
