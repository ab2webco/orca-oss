#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo 'Usage: ci-apt.sh <apt-get arguments> | ci-apt.sh installed <packages>' >&2
  exit 2
fi

all_installed() {
  local package
  for package in "$@"; do
    dpkg-query -W -f='${Status}' "$package" 2> /dev/null | grep -q 'install ok installed' ||
      return 1
  done
}

# Why (2026-11-11): a package the image already ships needs no mirror, and the mirrors were down.
if [ "$1" = installed ]; then
  shift
  all_installed "$@"
  exit
fi

# Real installs need time for unpacking and triggers; updates and URI resolution do not.
uri_output=''
for argument in "$@"; do
  if [ "$argument" = '--print-uris' ]; then
    uri_output=$(mktemp)
    trap 'rm -f "$uri_output"' EXIT
    break
  fi
done

apt_deadline=120s
if [ "$1" = install ] && [ -z "$uri_output" ]; then
  apt_deadline=600s
  packages=()
  skip_value=''
  for argument in "${@:2}"; do
    if [ -n "$skip_value" ]; then
      skip_value=''
    elif [ "$argument" = -o ] || [ "$argument" = -t ]; then
      skip_value=yes
    elif [ "${argument#-}" = "$argument" ]; then
      packages+=("$argument")
    fi
  done
  if [ "${#packages[@]}" -gt 0 ] && all_installed "${packages[@]}"; then
    echo "apt packages already installed: ${packages[*]}" >&2
    exit 0
  fi
fi
apt_deadline=${CI_APT_TIMEOUT:-$apt_deadline}

run_apt() {
  sudo timeout --signal=TERM --kill-after=10s "$apt_deadline" apt-get \
    -o Acquire::Retries=3 \
    -o Acquire::http::Timeout=30 \
    -o Acquire::https::Timeout=30 \
    "$@"
}

for attempt in 1 2; do
  if [ -n "$uri_output" ]; then
    # Failed attempts must not leave partial cache keys in redirected URI output.
    if run_apt "$@" > "$uri_output"; then
      cat "$uri_output"
      exit 0
    else
      status=$?
    fi
  else
    if run_apt "$@"; then
      exit 0
    else
      status=$?
    fi
  fi
  if [ "$attempt" -eq 1 ]; then
    echo "apt-get $1 failed (exit $status); retrying once" >&2
    # Why another mirror: the retry against the same list timed out again when runners could
    # not resolve *.ubuntu.com (2026-11-11); the switch also holds for later calls in the job.
    sudo bash "$(dirname "$0")/apt-mirror-fallback.sh" ${CI_APT_ROOT:+--root "$CI_APT_ROOT"} ||
      echo 'apt mirror fallback failed; retrying on the same mirrors' >&2
    if [ "$1" != update ]; then
      # Why stderr: an install --print-uris retry prints its URIs on stdout.
      apt_deadline=${CI_APT_TIMEOUT:-120s} run_apt update >&2 ||
        echo 'apt-get update on the fallback mirror failed' >&2
    fi
    sleep 5
  fi
done

echo "apt-get $1 failed after 2 attempts (exit $status)" >&2
exit "$status"
