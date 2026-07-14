---
title: Dev Experience Overview
---

# resource-fallback Development & Integration Experience

For **maintainers and integrators**: highlights, challenges, comparisons with other open-source approaches, case studies (**background → thinking → solution**), and **22 reusable principles**.

> Third-party package names are cited for capability comparison only; refer to npm/GitHub for current APIs.

---

## Navigation

### [Engineering Highlights](./highlights.md)

What sets this project apart: unified decision engine, full build-output coverage, browser quirk alignment, ownership boundaries, observability and ops switches.

### [Technical Challenges](./challenges.md)

Why this is not "just add onerror": semantics, Vite, Webpack, ESM, config vs reality, Legacy.

### [OSS Comparison](./comparison.md)

Compared with webpack-retry-chunk-load-plugin, vite-plugin-cdn-import, webpack-fallback-directory-resolver-plugin, Service Worker routes, and pure ops approaches.

### [Case Studies](./case-studies.md)

Ten solved problems (4.1–4.10): Webpack double-handling, Vite dynamic import, ESM cache, Vite base / rule base gate, cloneNode, URL matching, SystemJS, Resolver semantics, observability events, Hybrid SW.

### [Reusable Principles](./principles.md)

22 takeaways covering ownership, ESM, Vite, Webpack, SystemJS, and SW.

---

### Known gaps (honest record)

- **Vue runtime `nextSibling` is null** (Observer `replaceChild` vs Vue patch linked-list race): reduce DOM surgery at framework boundaries or add app-level refresh fallback.
- **Vite dev dynamic import**: intentionally not rewritten; verify with **preview / production**.

---

### Common pitfalls in alternative implementations

Patterns seen in "string-replace build output" approaches — compare with this repo:

1. **Rewriting too early in `renderChunk` / `renderDynamicImport`** — breaks `__vite__mapDeps` / `__vitePreload` before they stabilize; lazy-loaded components lose CSS. Returning runtime from `renderBuiltUrl` for `hostType === 'js'` can block mapDeps generation — same symptom.
2. **Hardcoding `__vitePreload` source** — fragile after minification.
3. **Regex-only `import(` scanning** — false positives in comments/strings; use **`es-module-lexer` + `MagicString`** for statement-level replacement.
4. **Runtime `cloneNode(true)` to swap `<script src>`** — see case study §4.5.
5. **Webpack: DOM-only, no `__webpack_require__.f` CSS promise** — see case study §4.1 extension.

---

_Documentation matches source at time of writing; if implementation changes, refer to source and root README TODO._

---

Next: [Engineering Highlights](./highlights.md)
