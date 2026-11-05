#!/bin/sh
# Installs the fixture's pinned packages. APT_ETC and APT_STEP_SECONDS exist so a test can run this
# against a fake apt-get.
set -eu

apt_etc=${APT_ETC:-/etc/apt}
# Why 45: with the snapshot stalled, one capped step plus the mirror pass keeps the build near 75 s,
# far inside the helper's 300 s docker build timeout; even both sources stalling fails at ~200 s.
step_seconds=${APT_STEP_SECONDS:-45}
sources="$apt_etc/sources.list.d/debian.sources"
mirror_copy="$apt_etc/live-mirror.sources"
snapshot_copy="$apt_etc/snapshot.sources"
export DEBIAN_FRONTEND=noninteractive

# Every package this adds to node:22-bookworm, each at its snapshot version, so the mirror pass
# installs the same files or fails.
pinned="git=1:2.39.5-0+deb12u3 openssh-server=1:9.2p1-2+deb12u10 openssh-sftp-server=1:9.2p1-2+deb12u10 libwrap0=7.6.q-32 runit-helper=2.15.2"
net_opts="-o Acquire::Check-Valid-Until=false -o Acquire::http::Timeout=10 -o Acquire::https::Timeout=10 -o Acquire::Retries=1"

# Why: a stalled snapshot.debian.org held apt until the docker build timeout killed the whole build
# (ORCA-1064), so each network step gets a wall-clock cap on top of apt's own timeouts.
bounded() {
  "$@" &
  pid=$!
  (sleep "$step_seconds"; kill "$pid") >/dev/null 2>&1 &
  watchdog=$!
  status=0
  wait "$pid" || status=$?
  kill "$watchdog" 2>/dev/null || true
  return "$status"
}

# shellcheck disable=SC2086 # word splitting of the option and package lists is intended
fetch_pinned() {
  bounded apt-get $net_opts update &&
    bounded apt-get $net_opts install --download-only -y --no-install-recommends $pinned
}

# Why: immutable snapshot inputs keep the SSH/Git fixture identical across rebuild dates.
cp "$sources" "$mirror_copy"
sed \
  -e 's|http://deb.debian.org/debian-security|https://snapshot.debian.org/archive/debian-security/20260713T000000Z|' \
  -e 's|http://deb.debian.org/debian|https://snapshot.debian.org/archive/debian/20260713T000000Z|' \
  "$mirror_copy" > "$sources"

# Why the fallback: the snapshot's CDN has both answered 404 for one pinned .deb for 18 minutes and
# stalled outright (ORCA-1064). The second pass reads only the base image's own deb.debian.org
# sources, so it works without the snapshot index, and the exact pins above keep its result the same.
if ! fetch_pinned; then
  echo "install-pinned-packages: snapshot.debian.org failed or stalled; fetching the same versions from deb.debian.org" >&2
  cp "$sources" "$snapshot_copy"
  cp "$mirror_copy" "$sources"
  fetch_pinned
fi

# shellcheck disable=SC2086
apt-get install --no-download -y --no-install-recommends $pinned
if [ -f "$snapshot_copy" ]; then mv "$snapshot_copy" "$sources"; fi
rm -f "$mirror_copy"
