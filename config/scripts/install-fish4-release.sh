#!/usr/bin/env bash
# Installs fish 4 from its official release when apt could not (ORCA-732).
#
# The PPA can be added and still serve no packages: on 2026-10-21 Launchpad answered
# the key and InRelease with 200 and the PPA's Packages index with 503, so apt kept
# Noble's fish 3.7 and every PR went red. This second source is the release tarball,
# pinned by version and SHA-256, so one outage no longer blocks every merge.
#
# Inputs, all overridable so the test never touches the network or /usr/local:
#   ORCA_FISH4_VERSION_COMMAND     how to ask the installed fish its version
#   ORCA_FISH4_SOURCE_STATUS_FILE  where the outcome is recorded for require-fish4.sh
#   ORCA_FISH4_RELEASE_SHA256      the tarball's pinned SHA-256
#   ORCA_FISH4_INSTALL_DIR         where the binary goes; /usr/local/bin is ahead of /usr/bin
#   ORCA_FISH4_DOWNLOAD_COMMAND    a command taking FILE and URL that saves URL to FILE

set -uo pipefail

# EX_TEMPFAIL, as in enable-fish4-apt-source.sh: the source is down, not the PR.
readonly EXIT_SOURCE_UNAVAILABLE=75

readonly RELEASE='4.9.3'
readonly URL="https://github.com/fish-shell/fish-shell/releases/download/${RELEASE}/fish-${RELEASE}-linux-x86_64.tar.xz"
SHA256="${ORCA_FISH4_RELEASE_SHA256:-8f643d10ad1abb0ef7072764c01ceb5cf61b2d373fda400cf60f0bad69b7e095}"
INSTALL_DIR="${ORCA_FISH4_INSTALL_DIR:-/usr/local/bin}"
VERSION_COMMAND="${ORCA_FISH4_VERSION_COMMAND:-fish --version}"
STATUS_FILE="${ORCA_FISH4_SOURCE_STATUS_FILE:-}"

log() {
  printf '%s\n' "$*" >&2
}

record_status() {
  if [ -n "$STATUS_FILE" ]; then
    printf '%s\n' "$1" >"$STATUS_FILE"
  fi
}

major_of() {
  local major="${1##*version }"
  major="${major%%.*}"
  case "$major" in '' | *[!0-9]*) major=0 ;; esac
  printf '%s' "$major"
}

download() {
  if [ -n "${ORCA_FISH4_DOWNLOAD_COMMAND:-}" ]; then
    "$ORCA_FISH4_DOWNLOAD_COMMAND" "$1" "$2"
    return
  fi
  curl -fsSL --retry 4 --retry-delay 5 --retry-all-errors -o "$1" "$2"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

current="$($VERSION_COMMAND 2>/dev/null || true)"
if [ "$(major_of "$current")" -ge 4 ]; then
  exit 0
fi
log "apt left '${current:-no fish}'; installing the fish ${RELEASE} release"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if ! download "$work/fish.tar.xz" "$URL"; then
  record_status 'release-unavailable'
  log "could not download ${URL}"
  exit "$EXIT_SOURCE_UNAVAILABLE"
fi

actual="$(sha256_of "$work/fish.tar.xz")"
if [ "$actual" != "$SHA256" ]; then
  record_status 'release-checksum-mismatch'
  log "the fish ${RELEASE} tarball hashes to ${actual}, not the pinned ${SHA256}; installing nothing"
  exit 1
fi

if ! tar -xJf "$work/fish.tar.xz" -C "$work" fish || [ ! -x "$work/fish" ]; then
  record_status 'release-not-fish4'
  log "the fish ${RELEASE} tarball holds no fish binary"
  exit 1
fi

shipped="$("$work/fish" --version 2>/dev/null || true)"
if [ "$(major_of "$shipped")" -lt 4 ]; then
  record_status 'release-not-fish4'
  log "the fish ${RELEASE} tarball reports '${shipped:-nothing}', not fish 4"
  exit 1
fi

if ! sudo install -m 0755 "$work/fish" "$INSTALL_DIR/fish"; then
  record_status 'release-install-failed'
  log "could not install fish into ${INSTALL_DIR}"
  exit 1
fi

record_status 'release'
log "installed ${shipped} into ${INSTALL_DIR}"
