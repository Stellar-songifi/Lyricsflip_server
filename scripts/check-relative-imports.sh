#!/usr/bin/env bash
# check-relative-imports.sh
#
# Fails when a relative import in a tracked TS/JS file resolves to no file.
# Addresses R3-29 / R3-16: unresolved imports must be caught in CI.
#
# Usage: scripts/check-relative-imports.sh
#
# Exit codes:
#   0 - all relative imports resolve
#   1 - at least one relative import does not resolve (or usage error)

set -euo pipefail

# Resolve repo root from this script's location so it works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# Extensions we try when an import omits one (mirrors common TS/JS resolution).
EXTENSIONS=(
  ".ts" ".tsx" ".js" ".jsx" ".mjs" ".cjs"
  ".d.ts"
)

# Index files tried when an import points at a directory.
INDEX_FILES=(
  "index.ts" "index.tsx" "index.js" "index.jsx" "index.mjs" "index.cjs"
)

# Files to scan: tracked TS/JS sources, excluding build output and deps.
mapfile -t SOURCE_FILES < <(
  git ls-files -- \
    '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' \
    ':!node_modules/*' \
    ':!dist/*' \
    ':!build/*' \
    ':!coverage/*' \
    ':!*.min.js' \
    ':!*.d.ts' \
    | sort -u
)

if [[ ${#SOURCE_FILES[@]} -eq 0 ]]; then
  echo "check-relative-imports: no tracked TS/JS source files found; nothing to check."
  exit 0
fi

# Resolve a relative specifier against the importing file's directory.
# Prints the resolved path on success; returns non-zero if nothing matches.
resolve_import() {
  local importer="$1"
  local specifier="$2"
  local base_dir
  base_dir="$(dirname "${importer}")"
  local target="${base_dir}/${specifier}"

  # Normalize the path (collapse ./ and ../ segments) without requiring the
  # file to exist yet.
  target="$(realpath -m -- "${target}" 2>/dev/null || echo "${target}")"

  # Strip a trailing query/hash fragment if present (e.g. ?raw, #fragment).
  target="${target%%\?*}"
  target="${target%%#*}"

  # 1) Exact path exists (e.g. import './foo.js' or './styles.css').
  if [[ -f "${target}" ]]; then
    printf '%s\n' "${target}"
    return 0
  fi

  # 2) Try appending known extensions.
  local ext
  for ext in "${EXTENSIONS[@]}"; do
    if [[ -f "${target}${ext}" ]]; then
      printf '%s\n' "${target}${ext}"
      return 0
    fi
  done

  # 3) Treat as a directory and try index files.
  if [[ -d "${target}" ]]; then
    local idx
    for idx in "${INDEX_FILES[@]}"; do
      if [[ -f "${target}/${idx}" ]]; then
        printf '%s\n' "${target}/${idx}"
        return 0
      fi
    done
  fi

  return 1
}

failures=0
checked=0

for file in "${SOURCE_FILES[@]}"; do
  # Extract relative import/require specifiers. Handles:
  #   import x from './y'
  #   import './y'
  #   export ... from './y'
  #   require('./y')
  #   import('./y')
  # Only specifiers beginning with '.' are considered relative.
  while IFS= read -r specifier; do
    [[ -z "${specifier}" ]] && continue
    checked=$((checked + 1))
    if ! resolve_import "${file}" "${specifier}" >/dev/null; then
      echo "::error file=${file}::Unresolved relative import '${specifier}' in ${file}"
      echo "  ${file}: cannot resolve '${specifier}'"
      failures=$((failures + 1))
    fi
  done < <(
    # Match single- or double-quoted relative specifiers in import/export/require.
    grep -oE \
      "(from[[:space:]]+|import[[:space:]]*\([[:space:]]*|require[[:space:]]*\([[:space:]]*|^[[:space:]]*import[[:space:]]+)['\"](\.[^'\"]+)['\"]" \
      "${file}" 2>/dev/null \
      | grep -oE "['\"]\.[^'\"]+['\"]" \
      | sed -E "s/^['\"]//; s/['\"]$//" \
      || true
  )
done

if [[ ${failures} -gt 0 ]]; then
  echo ""
  echo "check-relative-imports: FAILED — ${failures} unresolved relative import(s) across ${#SOURCE_FILES[@]} file(s)."
  echo "Fix the import path or add the missing file before merging."
  exit 1
fi

echo "check-relative-imports: OK — ${checked} relative import(s) across ${#SOURCE_FILES[@]} file(s) all resolve."
exit 0