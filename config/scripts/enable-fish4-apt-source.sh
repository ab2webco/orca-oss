#!/usr/bin/env bash
# Makes the fish 4 apt source available on an Ubuntu runner (ORCA-287).
#
# The fish 4+ requirement itself is not negotiable — DECSET 2031 arming (#9993)
# needs it, and a lane that skips on fish 3.7 is a gate that does not gate. What
# fails is the ACQUISITION: `add-apt-repository` resolves the signing key through
# Launchpad's REST API, which returned HTTP 500 / GPGKeyTemporarilyNotFoundError
# on three consecutive attempts and left the runner at 3.7.
#
# The old loop slept 5s flat, so all three attempts landed inside the same outage
# window. This retries with growing backoff instead, and reports WHY it gave up
# through $ORCA_FISH4_SOURCE_STATUS_FILE plus a distinct exit code, so the caller
# can tell "could not install fish 4" from "fish 4 is here and the contract
# failed" — today both surface as one red `shell contracts`.

set -uo pipefail

# EX_TEMPFAIL: the package source is unavailable, which is not a contract result.
readonly EXIT_SOURCE_UNAVAILABLE=75

readonly PPA='ppa:fish-shell/release-4'

STATUS_FILE="${ORCA_FISH4_SOURCE_STATUS_FILE:-}"
# Overridable so the test can exercise every retry without sleeping through it.
BACKOFF_SECONDS="${ORCA_FISH4_BACKOFF_SECONDS:-5 15 45 90}"

log() {
  printf '%s\n' "$*" >&2
}

record_status() {
  if [ -n "$STATUS_FILE" ]; then
    printf '%s\n' "$1" >"$STATUS_FILE"
  fi
}

# Why removed on failure: a half-added PPA leaves its list entry behind, and the
# next `apt-get update` then exits non-zero for a reason unrelated to the PR.
drop_partial_ppa() {
  sudo add-apt-repository -y -r "$PPA" >/dev/null 2>&1 || true
}

attempt=0
for delay in $BACKOFF_SECONDS; do
  attempt=$((attempt + 1))
  if sudo add-apt-repository -y "$PPA"; then
    log "add-apt-repository succeeded on attempt ${attempt}"
    record_status 'ppa'
    exit 0
  fi
  log "add-apt-repository attempt ${attempt} failed; retrying in ${delay}s"
  drop_partial_ppa
  sleep "$delay"
done

# One last attempt after the final backoff, so the longest wait is not spent for
# nothing: with the default schedule the source has had ~155s to come back.
attempt=$((attempt + 1))
if sudo add-apt-repository -y "$PPA"; then
  log "add-apt-repository succeeded on attempt ${attempt}"
  record_status 'ppa'
  exit 0
fi

record_status 'unavailable'
log "add-apt-repository failed ${attempt} time(s); the fish 4 source is unavailable"
exit "$EXIT_SOURCE_UNAVAILABLE"
