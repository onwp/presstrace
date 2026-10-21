#!/usr/bin/env bash
# Builds dist/presstrace-<version>.zip from plugin/presstrace with only the files WordPress needs.
# The zip holds a single "presstrace/" folder, so Plugins > Add New > Upload Plugin installs it as-is.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/plugin/presstrace"
version="$(sed -n 's/^[[:space:]]*\*[[:space:]]*Version:[[:space:]]*\([0-9A-Za-z.+-]*\).*/\1/p' "$src/presstrace.php" | head -n 1)"
if [ -z "$version" ]; then
  echo "Could not read the Version header from $src/presstrace.php" >&2
  exit 1
fi

# Runtime files only: no tests, vendor, composer files, PHPUnit config or dotfiles.
required=(presstrace.php uninstall.php readme.txt LICENSE src dropins assets languages/presstrace.pot)

for item in "${required[@]}"; do
  if [ ! -e "$src/$item" ]; then
    echo "Missing required plugin file: plugin/presstrace/$item" >&2
    exit 1
  fi
done

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/presstrace"
for item in "${required[@]}"; do
  mkdir -p "$stage/presstrace/$(dirname "$item")"
  cp -R "$src/$item" "$stage/presstrace/$item"
done
find "$stage" -name '.*' -not -path "$stage" -prune -exec rm -rf {} +

mkdir -p "$root/dist"
out="$root/dist/presstrace-$version.zip"
rm -f "$out"
(cd "$stage" && zip -qrX "$out" presstrace)
echo "$out"
