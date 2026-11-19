---
title: Compatibility
description: Distinguish declared bundler support, example dependencies, browser requirements, and continuous validation.
---

# Compatibility

Declared support, example dependencies, and CI coverage are separate. Verify failures with your production build configuration.

## Bundlers and plugins

| Combination              | Declaration or example dependency    | Continuous validation                                       |
| ------------------------ | ------------------------------------ | ----------------------------------------------------------- |
| Vite                     | Peer `>=4`; examples use Vite 7.x    | Vite + Vue production builds and Chromium E2E               |
| Webpack                  | Peer `>=5`; examples use Webpack 5.x | Webpack + React production builds and Chromium E2E          |
| html-webpack-plugin      | Optional peer `>=4`                  | Example HTML injection; manual injection when absent        |
| SystemJS / plugin-legacy | Instantiate integration exists       | Scenarios covered by example tests, not every legacy target |
| Workbox / other PWA      | No merged integration guarantee      | Design scope/routing first; see SW operations               |

Vite 4+ is the package's support declaration, not a CI matrix containing every major. Build and browser requirements also differ: packages declare Node `>=18`; unit tests currently run on Node 20/22/24.

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
