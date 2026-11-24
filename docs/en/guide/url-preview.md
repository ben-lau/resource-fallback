---
title: URL prefix preview
description: Preview CDN prefix replacement, origin subpaths, and fallback order using your asset URL and rules.
---

# URL prefix preview

Enter the page URL, asset URL, and rule to inspect every resulting path. The preview shares rule compilation and candidate selection with the page recovery engine.

<UrlPrefixPreview />

## CDN fallback and origin subpaths {#origin-prefix}

After `https://cdn1.example.com/app/assets/app.js` matches base `https://cdn1.example.com/app/`, candidate `/app/` yields `/app/assets/app.js` on the page origin. Candidate `/` instead yields `/assets/app.js`. Match the origin prefix to its actual deployment directory.

## Read the result

- Rule prefixes gain a trailing slash and match case-sensitively. Multiple rules use longest-prefix priority.
- Enter the original URL passed by the adapter. Absolute URLs and relative paths are matched as supplied: `/app/` does not automatically match `https://cdn.example.com/app/`.
- The preview assumes preceding URLs fail, no circuit is open, and no deadline expires. Actual recovery is subject to those conditions.
- Page URL resolves relative candidates. `/app/` returns to the page origin, not the preceding CDN origin.

Publish identical files using [Deployment](./deployment.md#paths), then verify Network. See [candidate prefixes](./troubleshooting.md#candidate-prefix) for missing subpaths.
