#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo 'Usage: ci-apt.sh <apt-get arguments>' >&2
  exit 2
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
    sleep 5
  fi
done

echo "apt-get $1 failed after 2 attempts (exit $status)" >&2
exit "$status"
