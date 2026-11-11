#!/usr/bin/env bash
set -euo pipefail

# Points apt's Canonical archive and security sources at a mirror under another domain.
# Why (2026-11-11): runners could not resolve any *.ubuntu.com host, so every mirror in
# the image's list failed together. Shared by ci-apt.sh and the CI Dockerfiles.
# Why perl: GNU and BSD sed disagree on -i, and the tests run this on macOS too.

root=''
if [ "${1:-}" = '--root' ]; then
  root=${2:?'Usage: apt-mirror-fallback.sh [--root DIR]'}
fi
mirror=${APT_FALLBACK_MIRROR:-http://mirrors.edge.kernel.org/ubuntu/}
canonical='https?://([a-z0-9-]+\.)*(archive|security)\.ubuntu\.com/ubuntu/?'

mirror_list="$root/etc/apt/apt-mirrors.txt"
if [ -f "$mirror_list" ]; then
  printf '%s\tpriority:1\n' "$mirror" > "$mirror_list"
fi

for sources in "$root/etc/apt/sources.list" "$root"/etc/apt/sources.list.d/*.sources \
  "$root"/etc/apt/sources.list.d/*.list; do
  [ -f "$sources" ] || continue
  MIRROR="$mirror" perl -pi -e "s#$canonical#\$ENV{MIRROR}#g" "$sources"
done

echo "apt sources now use $mirror" >&2
