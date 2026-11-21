#!/usr/bin/env bash
# check-removed-api.sh
#
# Fails when a PR removes exported functions, class methods, or contract
# `pub fn` declarations, unless the PR carries the `removes-api` label.
#
# Usage:
#   scripts/check-removed-api.sh [base-ref]
#
# Environment:
#   GITHUB_BASE_REF   base branch name (set automatically on pull_request events)
#   GITHUB_EVENT_PATH path to the event payload (used to read PR labels)
#   PR_LABELS         optional comma-separated list of labels (overrides event)
#
# Exit codes:
#   0  no API removals, or removals are acknowledged via the `removes-api` label
#   1  API removals detected without the `removes-api` label
#   2  script error (missing git, bad ref, etc.)

set -euo pipefail

REQUIRED_LABEL="removes-api"

die() {
  echo "::error::$*" >&2
  exit 2
}

# ---------------------------------------------------------------------------
# Resolve the base ref to diff against.
# ---------------------------------------------------------------------------
BASE_REF="${1:-${GITHUB_BASE_REF:-}}"

if [[ -z "${BASE_REF}" ]]; then
  # Fall back to the merge-base with origin/main or origin/master.
  for candidate in origin/main origin/master main master; do
    if git rev-parse --verify --quiet "${candidate}" >/dev/null 2>&1; then
      BASE_REF="${candidate}"
      break
    fi
  done
fi

[[ -n "${BASE_REF}" ]] || die "Unable to determine base ref. Pass one as the first argument."

if ! git rev-parse --verify --quiet "${BASE_REF}" >/dev/null 2>&1; then
  # Try to fetch it (shallow clones often lack the base branch).
  git fetch --no-tags --depth=1 origin "${BASE_REF#origin/}" >/dev/null 2>&1 || true
fi

git rev-parse --verify --quiet "${BASE_REF}" >/dev/null 2>&1 \
  || die "Base ref '${BASE_REF}' not found."

MERGE_BASE="$(git merge-base "${BASE_REF}" HEAD 2>/dev/null || echo "${BASE_REF}")"

echo "Diffing HEAD against merge-base ${MERGE_BASE} (base: ${BASE_REF})"

# ---------------------------------------------------------------------------
# Collect the labels attached to the PR.
# ---------------------------------------------------------------------------
LABELS=""

if [[ -n "${PR_LABELS:-}" ]]; then
  LABELS="${PR_LABELS}"
elif [[ -n "${GITHUB_EVENT_PATH:-}" && -f "${GITHUB_EVENT_PATH}" ]]; then
  # Extract label names from the event payload without requiring jq.
  LABELS="$(grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "${GITHUB_EVENT_PATH}" 2>/dev/null \
    | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/' \
    | paste -sd, - || true)"
fi

has_required_label() {
  local IFS=','
  local label
  for label in ${LABELS}; do
    # Trim surrounding whitespace.
    label="$(echo "${label}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    if [[ "${label}" == "${REQUIRED_LABEL}" ]]; then
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------------------
# Patterns describing public API surface.
#
# We look at *removed* lines (prefixed with '-') in the diff. A line counts as
# an API removal when it declares an exported function, an exported class
# method, or a contract `pub fn`.
# ---------------------------------------------------------------------------
# Exported JS/TS function: `export function foo`, `export async function foo`,
# `export const foo = (...) =>`, `export default function foo`.
EXPORT_FN_RE='^[[:space:]]*export[[:space:]]+(default[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)'
EXPORT_ARROW_RE='^[[:space:]]*export[[:space:]]+const[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=[[:space:]]*(async[[:space:]]*)?(\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=>'
# Exported class: `export class Foo`.
EXPORT_CLASS_RE='^[[:space:]]*export[[:space:]]+(default[[:space:]]+)?(abstract[[:space:]]+)?class[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)'
# Class method (public by default in TS/JS): `  foo(...) {` or `  async foo(...) {`
# or `  foo = (...) =>`. We only treat these as API when they are not prefixed
# with `private`, `protected`, `#`, or `static`-private markers.
CLASS_METHOD_RE='^[[:space:]]{2,}(async[[:space:]]+)?([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*(\(|=)[[:space:]]*(\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)?[[:space:]]*(=>|\{)?'
# Contract `pub fn` (Rust / Solidity / Move style).
PUB_FN_RE='^[[:space:]]*(pub[[:space:]]+(async[[:space:]]+)?fn[[:space:]]+([A-Za-z_][A-Za-z0-9_]*))'

# Files we consider source (skip docs, tests, fixtures, lockfiles, etc.).
is_source_file() {
  local f="$1"
  case "${f}" in
    *.md|*.mdx|*.txt|*.rst|*.json|*.lock|*.yaml|*.yml|*.toml|*.snap) return 1 ;;
    */node_modules/*|*/dist/*|*/build/*|*/target/*|*/.git/*) return 1 ;;
    */test/*|*/tests/*|*/__tests__/*|*.test.*|*.spec.*|*_test.*) return 1 ;;
  esac
  case "${f}" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.rs|*.sol|*.move|*.go|*.py|*.java|*.kt|*.swift) return 0 ;;
  esac
  return 1
}

# ---------------------------------------------------------------------------
# Walk the diff and collect removed API declarations.
# ---------------------------------------------------------------------------
REMOVALS_FILE="$(mktemp)"
trap 'rm -f "${REMOVALS_FILE}"' EXIT

current_file=""

while IFS= read -r line; do
  case "${line}" in
    "diff --git "*)
      # Extract the b/ path from `diff --git a/foo b/foo`.
      current_file="${line##* b/}"
      ;;
    "+++ "*)
      # Prefer the +++ path when present (handles renames).
      p="${line#+++ }"
      p="${p#b/}"
      [[ "${p}" == "/dev/null" ]] || current_file="${p}"
      ;;
    "--- "*)
      :
      ;;
    "-"*)
      # Skip the `---` header line.
      [[ "${line}" == "--- "* ]] && continue
      [[ -n "${current_file}" ]] || continue
      is_source_file "${current_file}" || continue

      content="${line#-}"

      # Skip obvious non-declarations.
      [[ "${content}" == *"//"*"truncated"* ]] && continue

      name=""
      kind=""

      if [[ "${content}" =~ ${EXPORT_FN_RE} ]]; then
        name="${BASH_REMATCH[4]}"
        kind="exported function"
      elif [[ "${content}" =~ ${EXPORT_ARROW_RE} ]]; then
        name="${BASH_REMATCH[1]}"
        kind="exported function"
      elif [[ "${content}" =~ ${EXPORT_CLASS_RE} ]]; then
        name="${BASH_REMATCH[4]}"
        kind="exported class"
      elif [[ "${content}" =~ ${PUB_FN_RE} ]]; then
        name="${BASH_REMATCH[3]}"
        kind="contract pub fn"
      elif [[ "${content}" =~ ${CLASS_METHOD_RE} ]]; then
        # Heuristic: only count method-like lines inside a class body. We
        # cannot know the enclosing scope from a single line, so we require
        # the line to look like a method signature ending in `{` or `=>`.
        name="${BASH_REMATCH[2]}"
        kind="class method"
        # Reject control-flow keywords and private/protected members.
        case "${name}" in
          if|for|while|switch|catch|return|else|do|try|function|constructor|private|protected|static|public|readonly|get|set)
            name=""
            ;;
        esac
        # Reject lines that are clearly not method declarations.
        if [[ -n "${name}" && "${content}" != *"{"* && "${content}" != *"=>"* ]]; then
          name=""
        fi
      fi

      if [[ -n "${name}" ]]; then
        printf '%s\t%s\t%s\n' "${current_file}" "${kind}" "${name}" >> "${REMOVALS_FILE}"
      fi
      ;;
  esac
done < <(git diff --no-color --unified=0 "${MERGE_BASE}" HEAD -- .)

# ---------------------------------------------------------------------------
# Report.
# ---------------------------------------------------------------------------
if [[ ! -s "${REMOVALS_FILE}" ]]; then
  echo "No removed public API detected."
  exit 0
fi

# De-duplicate.
UNIQUE_REMOVALS="$(sort -u "${REMOVALS_FILE}")"
COUNT="$(printf '%s\n' "${UNIQUE_REMOVALS}" | wc -l | tr -d ' ')"

echo "Detected ${COUNT} removed public API declaration(s):"
echo
printf '%s\n' "${UNIQUE_REMOVALS}" | while IFS=$'\t' read -r file kind name; do
  echo "  - ${kind} '${name}' in ${file}"
done
echo

if has_required_label; then
  echo "PR carries the '${REQUIRED_LABEL}' label; API removals acknowledged."
  exit 0
fi

echo "::error::This PR removes public API but is missing the '${REQUIRED_LABEL}' label."
echo
echo "If these removals are intentional, add the '${REQUIRED_LABEL}' label to the PR."
echo "Otherwise, restore the removed declarations."
exit 1