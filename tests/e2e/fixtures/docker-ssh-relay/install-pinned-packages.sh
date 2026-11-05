#!/bin/sh
# Installs the fixture's pinned packages; APT_ETC exists so a test can run this against a fake apt-get.
set -eu

apt_etc=${APT_ETC:-/etc/apt}
sources="$apt_etc/sources.list.d/debian.sources"
mirror_copy="$apt_etc/live-mirror.sources"
mirror_sources="$apt_etc/sources.list.d/live-mirror.sources"
mirror_pin="$apt_etc/preferences.d/live-mirror"

# Why: immutable snapshot inputs keep the SSH/Git fixture identical across rebuild dates.
cp "$sources" "$mirror_copy"
sed \
  -e 's|http://deb.debian.org/debian-security|https://snapshot.debian.org/archive/debian-security/20260713T000000Z|' \
  -e 's|http://deb.debian.org/debian|https://snapshot.debian.org/archive/debian/20260713T000000Z|' \
  "$mirror_copy" > "$sources"

install_pinned() {
  apt-get -o Acquire::Check-Valid-Until=false update &&
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git=1:2.39.5-0+deb12u3 \
      openssh-server=1:9.2p1-2+deb12u10
}

# Why the fallback: snapshot.debian.org's CDN kept answering 404 for one pinned .deb for 18 minutes
# (ORCA-1064), so a retry alone cannot help. The second pass keeps the snapshot and adds the base
# image's own mirror at Pin-Priority 1. The snapshot index still picks every version, so the fallback
# installs exactly the versions above and their snapshot dependencies, verified by the archive's
# hashes. If the mirror no longer carries a version, the build fails as it would without it.
if ! install_pinned; then
  echo "install-pinned-packages: snapshot.debian.org install failed; retrying with deb.debian.org as a second source" >&2
  cp "$mirror_copy" "$mirror_sources"
  printf 'Package: *\nPin: origin deb.debian.org\nPin-Priority: 1\n' > "$mirror_pin"
  install_pinned
fi

rm -f "$mirror_copy" "$mirror_sources" "$mirror_pin"
