#!/usr/bin/env bash
# check-truncation-markers.sh
#
# Fails CI when any tracked file contains a truncation or placeholder marker
# such as "truncated N chars", "… rest of file unchanged …", "// existing code".
#
# See ISSUES-ROUND-3.md R3-29.

set -euo pipefail

# Patterns that indicate a file was truncated or left with placeholder content.
# Each entry is an extended-regex pattern matched case-insensitively.
PATTERNS=(
  'truncated[[:space:]]+[0-9]+[[:space:]]+chars'
  'truncated[[:space:]]+[0-9]+[[:space:]]+characters'
  'truncated[[:space:]]+[0-9]+[[:space:]]+lines'
  '\.\.\.[[:space:]]*rest[[:space:]]+of[[:space:]]+(the[[:space:]]+)?file[[:space:]]+unchanged[[:space:]]*\.\.\.'
  '…[[:space:]]*rest[[:space:]]+of[[:space:]]+(the[[:space:]]+)?file[[:space:]]+unchanged[[:space:]]*…'
  '//[[:space:]]*existing[[:space:]]+code'
  '#[[:space:]]*existing[[:space:]]+code'
  '/\*[[:space:]]*existing[[:space:]]+code[[:space:]]*\*/'
  '<!--[[:space:]]*existing[[:space:]]+code[[:space:]]*-->'
  '\.\.\.[[:space:]]*unchanged[[:space:]]*\.\.\.'
  '…[[:space:]]*unchanged[[:space:]]*…'
  '\.\.\.[[:space:]]*omitted[[:space:]]+for[[:space:]]+brevity[[:space:]]*\.\.\.'
  '…[[:space:]]*omitted[[:space:]]+for[[:space:]]+brevity[[:space:]]*…'
  '\.\.\.[[:space:]]*rest[[:space:]]+of[[:space:]]+code[[:space:]]+unchanged[[:space:]]*\.\.\.'
  '…[[:space:]]*rest[[:space:]]+of[[:space:]]+code[[:space:]]+unchanged[[:space:]]*…'
)

# Build a single alternation regex.
JOINED=""
for p in "${PATTERNS[@]}"; do
  if [ -z "$JOINED" ]; then
    JOINED="$p"
  else
    JOINED="$JOINED|$p"
  fi
done

# Files that legitimately contain these strings (e.g. the checker itself and
# its tests). Keep this list minimal and explicit.
EXCLUDE_PATHS=(
  ':(exclude)scripts/check-truncation-markers.sh'
  ':(exclude)scripts/check-truncation-markers.test.sh'
  ':(exclude)scripts/check-truncation-markers.test.js'
  ':(exclude)ISSUES-ROUND-3.md'
  ':(exclude)ISSUES-ROUND-3*.md'
)

echo "Scanning tracked files for truncation/placeholder markers..."

# Use git grep so we only look at tracked files. -I skips binary files.
# -n gives line numbers, -E enables extended regex, -i is case-insensitive.
set +e
MATCHES=$(git grep -n -I -E -i -e "$JOINED" -- . "${EXCLUDE_PATHS[@]}" 2>/dev/null)
GREP_STATUS=$?
set -e

if [ "$GREP_STATUS" -eq 0 ] && [ -n "$MATCHES" ]; then
  echo ""
  echo "ERROR: Truncation or placeholder markers detected in tracked files."
  echo ""
  echo "The following lines look like a file was truncated or left with"
  echo "placeholder content instead of the real code:"
  echo ""
  echo "$MATCHES"
  echo ""
  echo "This usually means an edit replaced real content with a marker such as"
  echo "  'truncated N chars — edit only what you need near the top'"
  echo "  '… rest of file unchanged …'"
  echo "  '// existing code'"
  echo ""
  echo "Restore the full file content and re-apply only the intended change."
  echo "If a match is a false positive, add the path to EXCLUDE_PATHS in"
  echo "scripts/check-truncation-markers.sh with a justification."
  exit 1
fi

if [ "$GREP_STATUS" -gt 1 ]; then
  echo "ERROR: git grep failed with status $GREP_STATUS." >&2
  exit "$GREP_STATUS"
fi

echo "OK: no truncation or placeholder markers found."
exit 0