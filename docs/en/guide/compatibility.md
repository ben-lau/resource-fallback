---
title: Compatibility
description: Distinguish declared bundler support, example dependencies, browser requirements, and continuous validation.
---

# Compatibility

Declared support, example dependencies, and CI coverage are separate. Verify failures with your production build configuration.

## Bundlers and plugins

| Combination              | Declaration or example dependency    | Continuous validation                                                            |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------- |
| Vite                     | Peer `>=4`; examples use Vite 7.x    | Vite + Vue production builds and Chromium E2E                                    |
| Webpack                  | Peer `>=5`; examples use Webpack 5.x | Webpack + React production builds and Chromium E2E                               |
| html-webpack-plugin      | Optional peer `>=4`                  | Example HTML injection; manual injection when absent                             |
| SystemJS / plugin-legacy | Instantiate integration exists       | Scenarios covered by example tests, not every legacy target                      |
| Workbox / other PWA      | No merged integration guarantee      | Design scope/routing first; see [SW operations](./sw-operations.md#existing-pwa) |

### npm release verification

Before publishing to npm, clean consumer projects install the candidate `.tgz` files and verify the ESM and CommonJS entries, production builds, and recovery of entry scripts and lazy chunks from the origin when the primary CDN fails in Chromium.

| Bundler                           | Node.js   |
| --------------------------------- | --------- |
| Vite 4.0.0                        | 18        |
| Vite 7 and 8                      | 22        |
| Webpack 5 + html-webpack-plugin 5 | 18 and 22 |

Packages declare support for Vite `>=4` and Node `>=18`. Regular CI runs unit tests on Node 20/22/24, and the release checks cover the combinations above.

## Browsers and runtime modes

The runtime IIFE targets ES2020 and uses native dynamic `import()`. The SystemJS adapter does not automatically transpile the runtime to legacy syntax; SystemJS integration does not imply support for IE or every older browser.

| Environment               | Current status                                                                |
| ------------------------- | ----------------------------------------------------------------------------- |
| Chromium                  | Continuous browser E2E engine for examples                                    |
| Firefox / WebKit / Safari | Not currently in the CI browser matrix; verify target versions before release |
| Hybrid SW                 | Requires browser support, a secure context, and a controlled page             |
| Vite dev                  | Disabled by default; full dynamic-import recovery is outside coverage         |
| Worker / SSR              | Page runtime skips installation outside the browser                           |

Use [Coverage](./coverage.md) and [release acceptance](./deployment.md#verification) to test entry, lazy JS/CSS, and the required SW resources separately.
