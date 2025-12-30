# Instructions for AI Agents (Copilot)

Concise, practical guidance to quickly become productive in this repository.

---

### 1. Project Objective

- This is a lightweight static web application / PWA: a single-page app with a service worker and manifest.
- Core artifacts: [`index.html`](index.html), [`script.js`](script.js), [`style.css`](style.css), [`sw.js`](sw.js), [`manifest.json`](manifest.json).

---

### 2. High-Level Architecture

- **Client-side logic**: Delivered as static files; all behavior resides in `script.js`.
- **Offline support**: Implemented via [`sw.js`](sw.js) (Service Worker).
- **PWA configuration**: Defined in [`manifest.json`](manifest.json).
- **Deployment & integration assets**: Domain/server lists in [`domains.txt`](domains.txt) and [`servers.txt`](servers.txt); automation scripts in [`servers.sh`](servers.sh).

---

### 3. Key Workflows

- **Local testing**: No build step — serve files directly using a static server, e.g.:
  ```bash
  python3 -m http.server 8000
  ```
- **PWA / offline**: Verify service worker registration in browser DevTools — see [`script.js`](script.js) and [`sw.js`](sw.js).
- **Deployment**: Refer to [`servers.sh`](servers.sh) and [`servers.txt`](servers.txt). Scripts use simple tools (`ssh`, `curl`). Always review contents before execution.

---

### 4. Project Conventions & Patterns

- **Minimalism**: Vanilla HTML/CSS/JS — no bundlers or transpilers.
- **Separation of concerns**: Behavioral logic lives in `script.js`; styling in `style.css`.
- **Asset management**: When adding new static files, update both `manifest.json` and, if needed, the cache logic in `sw.js`.

---

### 5. Integration Points & External Dependencies

- **Service Worker** ([`sw.js`](sw.js)): Intercepts network requests — URL changes affect caching behavior.
- **Manifest** ([`manifest.json`](manifest.json)): Controls PWA installation and icons; version updates must be handled carefully to ensure client-side refreshes.
- **Deployment script** ([`servers.sh`](servers.sh)): May access external servers — ensure proper environment variables and SSH key handling.

---

### 6. Example Tasks Where AI Can Help

- Add a new caching endpoint to `sw.js` and validate it using the local server.
- Refactor `script.js` into a modular ES6 structure while maintaining compatibility with static hosting.
- Update `manifest.json` and add favicon/icon assets to the root directory.

---

### 7. What NOT to Do

- **Do not introduce complex build tooling** unless explicitly requested — the project is intentionally static and dependency-free.
- **Do not modify `servers.sh` or `servers.txt` for production** without explicit approval — they contain real hostnames and deployment targets.

---

### 8. Key Files & Entry Points

- **Main entry**: [`index.html`](index.html)
- **Core logic**: [`script.js`](script.js)
- **Offline & caching**: [`sw.js`](sw.js)
- **PWA manifest**: [`manifest.json`](manifest.json)
- **Deployment targets**: [`servers.sh`](servers.sh), [`servers.txt`](servers.txt)
- **Test domains**: [`domains.txt`](domains.txt)

---

### 9. Request for Clarification

If anything is unclear, specify which area you’d like to expand (e.g., CI, testing, deployment, security), and I’ll provide detailed guidance.
