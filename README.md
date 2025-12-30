# race

Simple DoH Latency Tester

A lightweight, client-side web tool for benchmarking DNS-over-HTTPS (DoH) and JSON-based DNS resolver services.

## Overview

The **DoH Latency Tester** measures network responsiveness and DNS resolution capability of public DoH servers directly in the browser—without sending any data to external analytics or backend services.

It provides immediate visual feedback on:
- **Network latency** to each resolver (via `HEAD`/`GET`).
- **DNS functionality** (whether the server correctly resolves a given domain).
- **Relative performance ranking** with color-coded, proportional progress bars.

All tests run locally; no server-side component is required.

## Key Features

- **Dual-layer testing**:  
  1. **Primary**: Measures pure network round-trip time (RTT).  
  2. **Secondary**: Validates DNS resolution correctness.
- **Batch processing**: Automatically limits concurrent requests to **20 servers** to avoid browser throttling and respect public resolver resources.
- **Real-time visualization**: Results update dynamically during the test.
- **Flexible input**:  
  - Test a single domain (default: `example.com`).  
  - Upload a custom list (`domains.txt`) for extended validation.
- **Professional UI**: Clean, responsive design with dark/light mode support.
- **Privacy-safe**: Zero data leaves the user’s browser.

## Use Cases

- Compare public DoH resolvers (Cloudflare, Google, Quad9, etc.).
- Validate custom or private DoH endpoints.
- Troubleshoot DNS resolution issues.
- Benchmark network paths to DNS providers.

## How to Use

1. **Prepare server list** (optional):  
   Create a `servers.txt` file with one DoH URL per line (e.g., `https://1.1.1.1/dns-query` or `https://8.8.8.8/resolve`).  
   If omitted, the tool uses a built-in default list.

2. **Choose a domain to test**:  
   - Enter a domain manually (e.g., `example.com`).  
   - **Or** upload a `domains.txt` file (one domain per line) to test multiple domains (only the first is used for ranking).

3. **Start the test**:  
   Click **Start Test**. Results appear in real time.

4. **Interpret results**:  
   - **Left**: Full resolver URL.  
   - **Right**: Network latency in milliseconds.  
   - **Progress bar**:  
     - **Green** (≤ 50 ms): Excellent.  
     - **Yellow** (51–150 ms): Acceptable.  
     - **Red** (> 150 ms): Poor.  
   - Hover over latency to see DNS status (`✅ DNS OK` or `⚠️ DNS failed`).

5. **Export data**:  
   Click **Export CSV** to save results for further analysis.

## Requirements

- A modern browser (Chrome, Firefox, Safari, Edge) with JavaScript enabled.
- Internet access to reach public DoH servers.
- CORS support (some corporate networks may block DoH requests).

## Deployment

The application is **static** and can be:
- Hosted on **GitHub Pages**, Netlify, Vercel, or any web server.
- Run locally from the filesystem (via `file://`).

No installation or dependencies required.