# race

Simple DoH Latency Tester

<!-- TOC -->
* [race](#race)
  * [✨ Features](#-features)
  * [🚀 Getting Started](#-getting-started)
    * [1. Clone or download this repository](#1-clone-or-download-this-repository)
    * [2. Open in browser](#2-open-in-browser)
  * [🧪 How to Use](#-how-to-use)
  * [📦 Built-In Resolver List](#-built-in-resolver-list)
  * [📊 Technical Details](#-technical-details)
  * [📜 License](#-license)
  * [🙌 Acknowledgements](#-acknowledgements)
<!-- TOC -->

> **Measure network latency and DNS resolution performance of public DoH resolvers — directly in your browser.**

A fully client-side, privacy-respecting tool for benchmarking [DNS-over-HTTPS (DoH)](https://datatracker.ietf.org/doc/html/rfc8484) and JSON-based DNS services. No data leaves your browser. No tracking. No backend required.

---

## ✨ Features

- **Dual-layer testing**
  - ✅ **Network latency**: `HEAD`/`GET` round-trip time to each resolver
  - ✅ **DNS resolution**: Validates correctness using your domain(s)
- **Smart batching**  
  Automatically processes servers in **batches of 5** to avoid browser throttling and respect public resolver resources.
- **Real-time UI**  
  Live-updating results with color-coded, proportional progress bars:
  - 🟢 **Green** (≤ 50 ms): Excellent
  - 🟡 **Yellow** (51–150 ms): Acceptable
  - 🔴 **Red** (> 150 ms): Poor
- **Flexible input**
  - Test a single domain (default: `example.com`)
  - Or upload a `domains.txt` file for extended validation
- **Zero dependencies**  
  Pure HTML/CSS/JS — deploy anywhere: GitHub Pages, Netlify, local filesystem.
- **Privacy by design**  
  All logic runs in-browser. No telemetry. No analytics.

---

## 🚀 Getting Started

### 1. Clone or download this repository

```bash
git clone https://github.com/viktor45/race.git
cd race
```

### 2. Open in browser

Simply open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge).

> 💡 **Project structure**: Code is organized in `src/` (JS/CSS), `data/` (txt files), `images/` (icons), with `index.html` in root.

> 💡 **Hosting tip**: Deploy to GitHub Pages in seconds:
>
> 1. Go to **Settings → Pages**
> 2. Set source to **Deploy from a branch**
> 3. Select `main` and `/root`

---

## 🧪 How to Use

1. **(Optional)** Prepare a `servers.txt` file with DoH URLs (one per line):

   ```txt
   https://1.1.1.1/dns-query
   https://8.8.8.8/resolve
   https://dns.google/dns-query
   ```

2. **Choose a domain** to test:
   - Enter manually (e.g., `example.com`)
   - **Or** upload `domains.txt` (one domain per line)

3. Click **Start Test**

4. **Interpret results**:
   - **Left**: Resolver URL
   - **Right**: Network latency (ms)
   - **Progress bar**: Visual performance indicator
   - **Tooltip**: Hover over latency to see DNS status (`✅ DNS OK` / `⚠️ DNS failed`)

5. **Export**: Click **Export CSV** to save results

---

## 📦 Built-In Resolver List

If no `servers.txt` is provided, the tool uses a curated list of **200+ public DoH servers** from the [curl DoH wiki](https://github.com/curl/curl/wiki/DNS-over-HTTPS), including:

- **Cloudflare** (`1.1.1.1`)
- **Google** (`8.8.8.8`)
- **Quad9** (`9.9.9.9`)
- **AdGuard**, **NextDNS**, **ControlD**, **Mullvad**, and 150+ others

> ✅ All entries support the standard `/dns-query` or `/resolve` endpoints.

---

## 📊 Technical Details

| Component   | Technology                                                 |
|-------------|------------------------------------------------------------|
| Frontend    | Vanilla JavaScript (ES6+)                                  |
| Styling     | CSS with native dark/light mode                            |
| DNS Query   | RFC 8484-compliant (`POST` with `application/dns-message`) |
| JSON API    | Google/Alibaba-style `/resolve`                            |
| Concurrency | Batched execution (max 5 concurrent requests)              |
| Output      | CSV export                                                 |

---

## 📜 License

This project is licensed under the **GPL-3.0 license** — see [LICENSE](LICENSE) for details.

---

## 🙌 Acknowledgements

- Public DoH server list: [curl/curl Wiki — DNS-over-HTTPS](https://github.com/curl/curl/wiki/DNS-over-HTTPS)
- Icons: [Material Symbols](https://fonts.google.com/icons?icon.set=Material+Symbols)
- Inspiration: [dnsleaktest.com](https://dnsleaktest.com), [browserleaks.com](https://browserleaks.com)

---

> 🔒 **Your privacy matters. This tool never sends your data anywhere.**  
> 🚀 **Test fast. Test fair. Test privately.**
