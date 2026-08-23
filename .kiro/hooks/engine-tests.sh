#!/bin/bash
# Kiro postToolUse hook: runs engine unit tests and property tests
# when a file in src/engine/ is written.
#
# Receives hook event JSON on stdin. Checks tool_input for file path.
# Exits 0 with test results on stdout (added to agent context).

set -euo pipefail

EVENT=$(cat)

# Extract the file path from the write tool's input.
# The write tool sends tool_input.path for the written file.
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
echo "║  ENGINE VERIFICATION: file changed → $REL_PATH"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Running engine unit tests + property tests...          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

cd "$CWD"

# Run engine unit tests and property tests
RESULT=0
npx vitest run test/engine/ test/properties/ --reporter=verbose 2>&1 || RESULT=$?

echo ""
if [ $RESULT -eq 0 ]; then
  echo "✅ ENGINE TESTS PASSED — all engine unit and property tests green."
else
  echo "❌ ENGINE TESTS FAILED — review output above for failures."
fi

exit 0
