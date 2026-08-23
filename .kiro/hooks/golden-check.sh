#!/bin/bash
# Kiro postToolUse hook: runs golden-file determinism tests
# when a file in src/engine/ is written.
#
# Detects deterministic-output regressions by comparing simulation output
# against committed golden files.

set -euo pipefail

EVENT=$(cat)

# Extract the file path from the write tool's input.
FILE_PATH=$(echo "$EVENT" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"path"[[:space:]]*:[[:space:]]*"//;s/"$//')

# Normalize: strip the cwd prefix if present to get a relative path
CWD=$(echo "$EVENT" | grep -o '"cwd"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"cwd"[[:space:]]*:[[:space:]]*"//;s/"$//')
REL_PATH="$FILE_PATH"
if [ -n "$CWD" ] && [[ "$FILE_PATH" == "$CWD"* ]]; then
  REL_PATH="${FILE_PATH#$CWD/}"
fi

# Only run if the file is in src/engine/
if [[ "$REL_PATH" != src/engine/* ]]; then
  exit 0
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  GOLDEN-FILE CHECK: file changed → $REL_PATH"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Running golden-file determinism tests...               ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

cd "$CWD"

# Run only the golden-file test
RESULT=0
npx vitest run test/golden/golden.test.ts --reporter=verbose 2>&1 || RESULT=$?

echo ""
if [ $RESULT -eq 0 ]; then
  echo "✅ GOLDEN-FILE TESTS PASSED — deterministic output unchanged."
else
  echo "❌ GOLDEN-FILE TESTS FAILED — engine output has diverged from golden files."
  echo "   If intentional, regenerate with: npm run generate:golden"
fi

exit 0
