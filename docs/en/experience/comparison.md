---
title: OSS Comparison
---

# III. Comparison with Other Open-Source Approaches

Similar needs in the community are often split into **"Webpack only"**, **"swap dependencies to CDN"**, or **"intercept everything in SW"**. This repo chooses **plugin + small runtime** — each approach has strengths.

### 3.1 vs [webpack-retry-chunk-load-plugin](https://www.npmjs.com/package/webpack-retry-chunk-load-plugin)

|                          | webpack-retry-chunk-load-plugin (typical)                                                                                        | resource-fallback (this repo)                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Pros**                 | Focused on Webpack async chunks; mature, clear entry point.                                                                      | **Vite** in addition to Webpack; unified **circuit breaker, multi-prefix URLs, kill switch, DOM CSS chunks**. |
| **Cons** (for our goals) | Does not naturally cover **Vite**, **pure `<script>/<link>` safety net**, **SystemJS legacy**, or shared **resolver semantics**. | Broader maintenance surface; must avoid **double handling between Webpack and Observer**.                     |

### 3.2 vs [vite-plugin-cdn-import](https://www.npmjs.com/package/vite-plugin-cdn-import), [vite-plugin-cdn2](https://www.npmjs.com/package/vite-plugin-cdn2)

|                          | Typical CDN-import plugins                                                                                 | resource-fallback (this repo)                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pros**                 | Point **React/Vue deps** to CDN — smaller bundles, faster builds.                                          | **Runtime retry and multi-source fallback** (including origin) when **your own built assets fail** — orthogonal to "swap deps at build time". |
| **Cons** (for our goals) | Mostly **static URL strategy**; not the same problem as **rule-chain switching when primary CDN is down**. | Does not replace "externalize business deps to CDN"; use a dedicated CDN plugin if that's all you need.                                       |

### 3.3 vs [webpack-fallback-directory-resolver-plugin](https://www.npmjs.com/package/webpack-fallback-directory-resolver-plugin)

|                                 | Resolver-level "directory fallback"                                                | resource-fallback (this repo)                                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Pros**                        | Fixes "file not found" at **module resolution** time.                              | Fixes **URL load failures already initiated in the browser** (network/CDN/CORS) — different layer from **build-time resolve**. |
| **Cons** (for runtime fallback) | **Cannot** equivalently replace "retry and swap source when live chunk URL fails". | Does not participate in "source file not found" build-time fallback.                                                           |

### 3.4 vs Service Worker (e.g. custom Workbox routing)

|          | SW fetch interception                                                                             | resource-fallback (this repo)                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pros** | Broader resource types (fonts, images, subresource fetch); huge control plane.                    | **No SW registration/update/compatibility burden** by default; aligns with **Webpack/Vite plugins** — familiar SPA deploy path. Hybrid SW available opt-in. |
| **Cons** | Lifecycle, HTTPS, same-origin, modeling `fetch` vs **`<script>` failure**; heavier ops/debugging. | Without SW: coverage limited to **script/style loading and builder-reachable paths**.                                                                       |

### 3.5 vs pure ops (publicPath switch, DNS, multi-cloud routing)

|          | Ops-side switching                                                                | resource-fallback (this repo)                                                                                                      |
| -------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Pros** | Site-wide consistency; "no patch" user experience.                                | **Within a single page lifecycle**, already-issued HTML/asset URLs can still **retry and swap sources** without immediate release. |
| **Cons** | **Cached entry pages** may still point at bad domains; regional jitter is coarse. | **Extra client logic**; team must accept runtime script and semantic boundaries.                                                   |

**Summary**: Strengths are **multi-builder adaptation + unified runtime state machine + alignment with browser/webpack/vite edge cases**; weaknesses include **no universal fetch interception without SW**, and **intentionally uncovered** areas like **Vite dev dynamic import**.

---

Previous: [Technical Challenges](./challenges.md) · Next: [Case Studies](./case-studies.md)
