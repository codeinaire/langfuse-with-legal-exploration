#!/usr/bin/env bash
# Measures the Next.js build bundle size and records it in project/bundle-sizes.md
# Run: npm run measure-bundle
# Run with title: npm run measure-bundle -- "my title here"

set -euo pipefail

REPORT_FILE="project/bundle-sizes.md"
TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "uncommitted")

# Title: use argument if provided, otherwise try GitButler branch name, fallback to git branch
# Accepts both:  measure-bundle "my title"  and  measure-bundle --title="my title"
TITLE=""
for arg in "$@"; do
  case "$arg" in
    --title=*) TITLE="${arg#--title=}" ;;
    --*) ;;  # ignore other flags
    *) [ -z "$TITLE" ] && TITLE="$arg" ;;
  esac
done

if [ -z "$TITLE" ]; then
  # Try to get the active GitButler virtual branch name
  TITLE=$(bts 2>/dev/null | grep -E "^\┊╭┄|^\├╯" -B1 | grep -oE '\[.*\]' | head -1 | tr -d '[]' || true)
  if [ -z "$TITLE" ]; then
    TITLE=$(git branch --show-current 2>/dev/null || echo "unknown")
  fi
fi

echo "Building project..."
npm run build --silent 2>&1 | tail -5

echo "Measuring bundle sizes..."

# Client JS (gzipped)
CLIENT_JS_RAW=$(find .next/static -name "*.js" -exec cat {} + 2>/dev/null | wc -c | tr -d ' ')
CLIENT_JS_GZIP=$(find .next/static -name "*.js" -exec cat {} + 2>/dev/null | gzip -c | wc -c | tr -d ' ')

# Client CSS (gzipped)
CLIENT_CSS_RAW=$(find .next/static -name "*.css" -exec cat {} + 2>/dev/null | wc -c | tr -d ' ')
CLIENT_CSS_GZIP=$(find .next/static -name "*.css" -exec cat {} + 2>/dev/null | gzip -c | wc -c | tr -d ' ')

# Server chunks
SERVER_SIZE=$(du -sk .next/server 2>/dev/null | cut -f1)

# Total .next directory
TOTAL_SIZE=$(du -sm .next 2>/dev/null | cut -f1)

# Count JS/CSS chunks
JS_CHUNK_COUNT=$(find .next/static -name "*.js" 2>/dev/null | wc -l | tr -d ' ')
CSS_CHUNK_COUNT=$(find .next/static -name "*.css" 2>/dev/null | wc -l | tr -d ' ')

# Number of dependencies
DEP_COUNT=$(node -e "const p=require('./package.json'); console.log(Object.keys(p.dependencies||{}).length)")
DEV_DEP_COUNT=$(node -e "const p=require('./package.json'); console.log(Object.keys(p.devDependencies||{}).length)")

# node_modules size
NODE_MODULES_SIZE=$(du -sm node_modules 2>/dev/null | cut -f1)

# Format bytes to human readable
format_bytes() {
  local bytes=$1
  if [ "$bytes" -ge 1048576 ]; then
    echo "$(echo "scale=1; $bytes / 1048576" | bc)MB"
  elif [ "$bytes" -ge 1024 ]; then
    echo "$(echo "scale=1; $bytes / 1024" | bc)KB"
  else
    echo "${bytes}B"
  fi
}

CLIENT_JS_DISPLAY=$(format_bytes "$CLIENT_JS_GZIP")
CLIENT_CSS_DISPLAY=$(format_bytes "$CLIENT_CSS_GZIP")
CLIENT_JS_RAW_DISPLAY=$(format_bytes "$CLIENT_JS_RAW")
CLIENT_CSS_RAW_DISPLAY=$(format_bytes "$CLIENT_CSS_RAW")

NEW_ROW="| ${TITLE} | ${TIMESTAMP} | ${GIT_SHA} | ${CLIENT_JS_DISPLAY} | ${CLIENT_CSS_DISPLAY} | ${CLIENT_JS_RAW_DISPLAY} | ${CLIENT_CSS_RAW_DISPLAY} | ${SERVER_SIZE}KB | ${TOTAL_SIZE}MB | ${NODE_MODULES_SIZE}MB | ${JS_CHUNK_COUNT} | ${CSS_CHUNK_COUNT} | ${DEP_COUNT} | ${DEV_DEP_COUNT} |"

TABLE_HEADER="| Title | Timestamp | Commit | Client JS (gzip) | Client CSS (gzip) | Client JS (raw) | Client CSS (raw) | Server | Total .next | node_modules | JS Chunks | CSS Chunks | Deps | Dev Deps |"
TABLE_SEPARATOR="|-------|-----------|--------|-------------------|--------------------|-----------------|------------------|--------|-------------|--------------|-----------|------------|------|----------|"

mkdir -p "$(dirname "$REPORT_FILE")"

if [ ! -f "$REPORT_FILE" ]; then
  printf "# Bundle Size History\n\nMeasured using \`npm run measure-bundle\`. Client sizes are gzipped.\n\n%s\n%s\n%s\n" \
    "$TABLE_HEADER" "$TABLE_SEPARATOR" "$NEW_ROW" > "$REPORT_FILE"
else
  # Read existing data rows (everything after the separator line).
  # Match both unformatted (|---) and formatter-aligned (| --- ) styles.
  EXISTING_ROWS=$(awk '/^\| *---/{found=1; next} found' "$REPORT_FILE")

  # Rewrite the file: header + new row first + existing rows
  printf "# Bundle Size History\n\nMeasured using \`npm run measure-bundle\`. Client sizes are gzipped.\n\n%s\n%s\n%s\n" \
    "$TABLE_HEADER" "$TABLE_SEPARATOR" "$NEW_ROW" > "$REPORT_FILE"

  if [ -n "$EXISTING_ROWS" ]; then
    echo "$EXISTING_ROWS" >> "$REPORT_FILE"
  fi
fi

echo ""
echo "Bundle size recorded:"
echo "  Title:      ${TITLE}"
echo "  Client JS:  ${CLIENT_JS_DISPLAY} (${CLIENT_JS_RAW_DISPLAY} raw)"
echo "  Client CSS: ${CLIENT_CSS_DISPLAY} (${CLIENT_CSS_RAW_DISPLAY} raw)"
echo "  Server:     ${SERVER_SIZE}KB"
echo "  Total:      ${TOTAL_SIZE}MB"
echo "  Commit:     ${GIT_SHA}"
echo ""
echo "Report: ${REPORT_FILE}"
