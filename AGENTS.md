# AGENTS.md

## Project Overview

**race** is a fully client-side DoH (DNS-over-HTTPS) latency tester — a static PWA written in vanilla HTML/CSS/JS with **zero dependencies and no build step**. It benchmarks network latency and DNS resolution correctness of public DoH resolvers entirely in the browser. Licensed GPL-3.0; deployed to GitHub Pages.

## Directory Layout

- `index.html` — single page entry point (repo root)
- `src/script.js` — all application logic (single file, no modules)
- `src/theme.js` — tiny pre-paint bootstrap that applies the saved theme from `localStorage` before first render (loaded in `<head>`; exists because CSP forbids inline scripts)
- `src/style.css` — styling; theme via CSS custom properties
- `sw.js` — service worker (offline cache); **must stay at repo root** for correct scope
- `src/manifest.json` — PWA manifest
- `data/servers.txt` — built-in DoH resolver list (**auto-generated, see below**)
- `data/domains.txt` — sample domain file (`example.com`); not fetched by the app — domains come from the UI input or a user-uploaded file, but it is precached by the service worker
- `data/servers.sh` — fetch script that regenerates `servers.txt` from the curl DoH wiki
- `images/` — icons/favicons
- `.github/workflows/` — Pages deploy + server-list auto-update

## Commands

There is no build, typecheck, lint, or test tooling — none should be introduced unless explicitly requested.

```bash
# Local development (any static server works; fetch() needs http://, not file://)
python3 -m http.server 8000

# Manually regenerate the resolver list (normally done by CI)
./data/servers.sh
```

Verify changes by opening the app in a browser and running a test.

## Critical Gotcha: `data/servers.txt` is auto-generated

`.github/workflows/update-servers.yaml` runs `data/servers.sh` weekly (Sundays 02:00 UTC) and auto-commits changes to `data/servers.txt` (most commits in history are these auto-updates). **Do not hand-edit `data/servers.txt`** — changes will be overwritten. To change the list contents, modify the extraction logic in `data/servers.sh` instead.

## Architecture Notes

- **Resolver type detection**: a server URL containing `/resolve` is treated as a JSON API (`?name=…&type=A`); everything else is treated as RFC 8484 DoH (`POST` with `application/dns-message` body built in `makeDnsPacket()`).
- **Connectivity probe**: `testProvider()` tries `HEAD`, then `HEAD`/`GET` with `mode: 'no-cors'`. Most public resolvers don't send CORS headers, so an opaque no-cors response is the only way to prove reachability and measure latency; only if all attempts fail is the server reported as `Network unreachable`. Don't "simplify" this back to plain CORS requests.
- **Concurrency**: servers are tested in batches of `BATCH_SIZE` (5) with a `TIMEOUT_MS` (5000) per request — constants at the top of `src/script.js`.
- **Latency color thresholds** (≤50 ms green, ≤150 ms yellow, >150 ms red) are duplicated in both `renderResultItem()` and `renderBars()` — update both when changing them.
- **Service worker**: `sw.js` lives at the repo root (its scope must cover `index.html`), has a hardcoded `urlsToCache` list and `CACHE_NAME` (`doh-tester-v4`), and is registered at the bottom of `src/script.js`. When adding static assets — or after changing any cached asset — add them to the cache list and bump the cache name, otherwise returning visitors keep getting the stale cached copy. The worker does **not** call `skipWaiting()` on install; instead the page shows an "Update available" toast and sends a `skip-waiting` message when the user confirms the reload (so an update never swaps in under a running test). `data/` files use network-first caching so the weekly auto-updated server list isn't hidden behind stale cache.
- **CSP**: `index.html` carries a `Content-Security-Policy` meta tag with `script-src 'self'` — inline scripts will not run; keep all JS in `src/script.js` and `src/theme.js`. `connect-src *` is intentional (arbitrary DoH endpoints).
- **Theming**: dark mode has three layers that must stay in sync — `:root` light defaults, `:root[data-theme='dark']` for the explicit user choice (persisted in `localStorage` under `theme`), and `@media (prefers-color-scheme: dark)` scoped to `:root:not([data-theme])` for OS preference. `src/theme.js` sets `data-theme` before first paint; the toggle button logic lives in `src/script.js` (`getEffectiveTheme()`/`updateThemeButton()`). When adding colors, define them in all three blocks.
- `.nojekyll` exists for GitHub Pages; don't remove it.

## Coding Conventions

- Tabs for indentation, no semicolons, single quotes, ES6+ vanilla JS (no modules, no frameworks, no bundlers).
- DOM access via `document.getElementById()`; UI state toggled with a `hidden` class.
- CSS: use the existing custom properties (`--bg-body`, `--primary`, `--bar-bg`, etc.) rather than hardcoded colors; dark mode is a mix of `:root[data-theme='dark']` (user choice) and `@media (prefers-color-scheme: dark)` on `:root:not([data-theme])` (OS default) — see Theming above.
- List files (`servers.txt`, `domains.txt`) are parsed by `parseList()`: one entry per line, `#` comments and blank lines ignored.

## Docs Worth Reading First

- `README.md` — features and user-facing behavior
- `.github/copilot-instructions.md` — earlier agent notes (mostly accurate, but its description of `servers.sh` as a deployment/ssh script is wrong — it's the wiki fetch script)
- `CONTRIBUTING.md` — PR/issue workflow
