# race — DoH Latency Tester

> Measure network latency and DNS resolution performance of public DNS-over-HTTPS (DoH) resolvers — directly in your browser.

**race** is a fully client-side benchmarking tool for [DNS-over-HTTPS (RFC 8484)](https://datatracker.ietf.org/doc/html/rfc8484) and JSON-based DNS APIs. It tests 200+ public resolvers, ranks them by latency in real time, and verifies that each one actually resolves DNS correctly. No backend, no tracking, no data leaves your browser.

**Live demo:** [viktor45.github.io/race](https://viktor45.github.io/race/)

---

## Features

- **Dual-layer testing**
  - **Network latency** — round-trip time of a connectivity probe to each resolver
  - **DNS resolution** — a real DNS query for your chosen domain to verify the resolver actually works (`✅ DNS OK` / `⚠️ DNS failed`)
- **200+ built-in resolvers** — curated from the [curl DoH wiki](https://github.com/curl/curl/wiki/DNS-over-HTTPS) and refreshed automatically every week
- **Live results** — the list re-sorts by latency as results arrive, with color-coded progress bars:
  - 🟢 ≤ 50 ms — excellent
  - 🟡 ≤ 150 ms — acceptable
  - 🔴 > 150 ms — slow
- **Summary & filtering** — live stats (tested / fastest / median / failed), filter chips by speed class, and search by URL
- **Custom inputs** — upload your own server list (`servers.txt`) and test against your own domain(s)
- **CSV export & sharing** — save the results as CSV, or share them via the system share sheet where the browser supports it
- **Light / dark theme** — follows your OS preference, with a manual toggle that remembers your choice
- **Works offline** — installable PWA with a service worker cache, an install button, an offline indicator, and an in-app update notification
- **Zero dependencies** — plain HTML/CSS/JS, no build step

---

## Quick Start

### Use the hosted version

Open [viktor45.github.io/race](https://viktor45.github.io/race/), click **Start Test**, and wait for the results.

### Run locally

```bash
git clone https://github.com/viktor45/race.git
cd race
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

> ⚠️ **Don't open `index.html` via `file://`** — the app loads its resolver list with `fetch()`, which browsers block for local files. Any static HTTP server works (`npx serve`, `php -S`, nginx, etc.).

---

## How to Use

1. Click **Start Test** to benchmark the built-in resolver list.
2. *(Optional)* Open **Settings** to:
   - upload your own `servers.txt` — one DoH URL per line, e.g. `https://1.1.1.1/dns-query`
   - set a domain to validate against (default: `example.com`), or upload a `domains.txt` file
3. Watch results appear and sort themselves by latency. Hover over a latency value to see the DNS status of that resolver. Use the filter chips or the search field to narrow the list.
4. Click **Cancel** to stop a run early, **Export CSV** to download the results, or **Share** to send them via the system share sheet.
5. *(Optional)* Click **Install** in the top bar to install the app and use it offline.

---

## How It Works

For each resolver, the tool runs two checks:

1. **Connectivity probe** — a `no-cors` `HEAD` request, falling back to a `no-cors` `GET`. Most public resolvers don't send CORS headers, and a browser can't tell a CORS block apart from a real network failure, so the probe deliberately avoids CORS mode: an opaque `no-cors` response resolves whenever the server answers at all, which proves reachability and measures the round-trip time regardless of CORS. Servers that simply don't allow CORS still get a latency in ms; only genuinely unreachable servers (DNS failure, connection refused, timeout) are reported as unreachable.
2. **DNS validation** — a real DNS query for your test domain:
   - URLs containing `/resolve` are treated as JSON DNS APIs (`?name=…&type=A`)
   - everything else is queried via RFC 8484 (`POST` with an `application/dns-message` body built in the browser)

Resolvers are tested in **batches of 5** with a **5-second timeout** per request, to avoid browser throttling and to be fair to public infrastructure.

---

## Built-In Resolver List

The default list lives in `data/servers.txt` and contains 200+ public resolvers — Cloudflare, Google, Quad9, AdGuard, NextDNS, ControlD, Mullvad, and many more.

It is regenerated automatically every week from the [curl DoH wiki](https://github.com/curl/curl/wiki/DNS-over-HTTPS) by a GitHub Actions workflow, so the built-in list stays current without any manual work.

---

## Project Structure

```
index.html          single-page entry point
src/script.js       all application logic
src/style.css       styling and theming
src/theme.js        applies the saved theme before first paint
sw.js               service worker (offline cache) — must stay at repo root
src/manifest.json   PWA manifest
data/servers.txt    built-in resolver list (auto-generated, do not edit by hand)
data/servers.sh     script that regenerates servers.txt from the curl wiki
images/             icons and favicons
```

---

## Hosting Your Own Copy

The app is static — deploy it anywhere that serves files. This repository ships a GitHub Actions workflow (`.github/workflows/static.yml`) that deploys to GitHub Pages on every push to `main`. If you fork the repo, enable Pages under **Settings → Pages** with the source set to **GitHub Actions**.

---

## License

GPL-3.0 — see [LICENSE](LICENSE).

---

## Acknowledgements

- Resolver list: [curl/curl Wiki — DNS-over-HTTPS](https://github.com/curl/curl/wiki/DNS-over-HTTPS)
- Icons: [Material Symbols](https://fonts.google.com/icons?icon.set=Material+Symbols)

---

> 🔒 Everything runs locally in your browser. No telemetry, no analytics, no data sent anywhere except the resolvers you test.
