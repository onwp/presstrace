#!/usr/bin/env bash
# Sets the release version in every file that carries it, or checks that they all agree.
#
#   bin/bump-version.sh 0.2.0     write 0.2.0 everywhere
#   bin/bump-version.sh --check   exit 1 if any file disagrees with the plugin Version header
#
# The CHANGELOG.md section and the readme.txt changelog entry are prose, so they are checked but not
# written. Regenerate plugin/presstrace/languages/presstrace.pot after a bump (see CONTRIBUTING.md).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

plugin=plugin/presstrace/presstrace.php

current() {
  sed -n 's/^[[:space:]]*\*[[:space:]]*Version:[[:space:]]*\([0-9A-Za-z.+-]*\).*/\1/p' "$plugin" | head -n 1
}

# file|perl regex with the version in capture group 2
targets=(
  "$plugin|^(\s*\*\s*Version:\s*)([0-9A-Za-z.+-]+)"
  "$plugin|(define\(\s*'PRESSTRACE_VERSION',\s*')([^']+)"
  "plugin/presstrace/src/agent-bootstrap.php|(define\(\s*'PRESSTRACE_VERSION',\s*')([^']+)"
  "plugin/presstrace/uninstall.php|(define\(\s*'PRESSTRACE_VERSION',\s*')([^']+)"
  "plugin/presstrace/readme.txt|^(Stable tag:\s*)(\S+)"
  "dev/lab-scenarios/presstrace-lab-scenarios.php|^(\s*\*\s*Version:\s*)(\S+)"
  "app/package.json|^(\s*\"version\":\s*\")([^\"]+)"
  "docs-site/package.json|^(\s*\"version\":\s*\")([^\"]+)"
  "app/.env.example|^(PRESSTRACE_VERSION=)(\S+)"
)

if [ "${1:-}" = "--check" ]; then
  want="$(current)"
  status=0
  for t in "${targets[@]}"; do
    file="${t%%|*}"
    re="${t#*|}"
    while IFS= read -r got; do
      if [ "$got" != "$want" ]; then
        echo "$file has $got, expected $want" >&2
        status=1
      fi
    done < <(RE="$re" perl -ne 'print "$2\n" if /$ENV{RE}/' "$file")
  done
  grep -q "^## \[$want\] - " CHANGELOG.md || { echo "CHANGELOG.md has no '## [$want] - <date>' section" >&2; status=1; }
  grep -q "^= $want =" plugin/presstrace/readme.txt || { echo "readme.txt has no '= $want =' changelog entry" >&2; status=1; }
  [ "$status" -eq 0 ] && echo "All version strings are $want"
  exit "$status"
fi

new="${1:-}"
if ! [[ "$new" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "Usage: $0 <x.y.z[-pre]> | --check" >&2
  exit 1
fi

for t in "${targets[@]}"; do
  file="${t%%|*}"
  re="${t#*|}"
  RE="$re" NEW="$new" perl -pi -e 's/$ENV{RE}/$1$ENV{NEW}/' "$file"
done

echo "Set version $new. Still to do by hand:"
echo "  - add '## [$new] - <date>' and its compare link to CHANGELOG.md"
echo "  - add '= $new =' under == Changelog == in plugin/presstrace/readme.txt"
echo "  - regenerate plugin/presstrace/languages/presstrace.pot"
