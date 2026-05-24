---
"@resource-fallback/core": minor
"@resource-fallback/vite-plugin": minor
"@resource-fallback/webpack-plugin": minor
---

Add opt-in Hybrid Service Worker fallback support for non-script resources.

This release adds manifest-based Service Worker interception for images, fonts, media, CSS subresources, and controlled CSS imports while keeping script loading owned by the existing page-side adapters. It also emits SW assets from both Vite and Webpack plugins, preloads SW configuration to avoid first-load races, hardens SW event delivery and error handling, and documents the new behavior with examples and tests.
