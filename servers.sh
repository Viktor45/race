#!/bin/bash

# Script to extract DoH server URLs (/dns-query) from the official curl wiki
# Source: https://raw.githubusercontent.com/wiki/curl/curl/DNS-over-HTTPS.md

URL="https://raw.githubusercontent.com/wiki/curl/curl/DNS-over-HTTPS.md"
MD_FILE="servers.md"

echo "📥 Downloading DoH server list from curl wiki..."
if ! curl -fsSL "$URL" -o "$MD_FILE"; then
  echo "❌ Error: failed to download $URL" >&2
  exit 1
fi

echo "🔍 Extracting and processing URLs..."

# Extract all URLs containing '/dns-query'
# Handles URLs embedded in Markdown, code blocks, lists, etc.
# Extract potential URLs, then clean each line to keep only valid URL part up to first invalid character
grep -oE 'https?://[^[:space:]|`<>"]*' "$MD_FILE" \
  | grep -E '/dns-query(/.*)?$' \
  | sed 's|/dns-query[^/[:space:]|`<>"]*|/dns-query|g' \
  | sort -u >servers.txt

rm "$MD_FILE"

echo "✅ DoH server URLs have been extracted to servers.txt"
