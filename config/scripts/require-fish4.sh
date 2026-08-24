#!/usr/bin/env bash
# The fish 4+ gate for `shell contracts` (ORCA-287).
#
# A script and not inline YAML for the same reason the acquisition is: the two
# diagnoses below are the thing under test, and a step body can only be exercised
# by pushing a commit. Extracting it out of pr.yml also stops the test from
# inheriting whatever fish the developer's machine happens to have — every input
# is explicit here.
#
# Inputs, all overridable so the test never depends on the ambient environment:
#   ORCA_FISH4_VERSION_COMMAND      how to ask fish its version (default: fish --version)
#   ORCA_FISH4_SOURCE_STATUS_FILE   where the acquisition recorded its outcome
#
# Fails closed either way: fish 4 is what arms DECSET 2031 (#9993), so a lane that
# skips on 3.7 is a gate that does not gate.

set -uo pipefail

VERSION_COMMAND="${ORCA_FISH4_VERSION_COMMAND:-fish --version}"
STATUS_FILE="${ORCA_FISH4_SOURCE_STATUS_FILE:-${RUNNER_TEMP:-/tmp}/fish4-source-status}"

version="$($VERSION_COMMAND 2>/dev/null || true)"
major="${version##*version }"
major="${major%%.*}"
case "$major" in '' | *[!0-9]*) major=0 ;; esac
printf '%s\n' "${version:-<fish not installed>}"

if [ "$major" -ge 4 ]; then
  exit 0
fi

# Why two messages: "could not fetch fish 4" and "fish 4 is here and the contract
# failed" are different diagnoses. Reading one red check used to mean opening the
# job log to tell them apart, which is half the cost of this ticket.
status="$(cat "$STATUS_FILE" 2>/dev/null || echo unknown)"
if [ "$status" != 'ppa' ]; then
  echo "::error::INFRASTRUCTURE, not this PR: the ppa:fish-shell/release-4 apt source could not be reached (status=${status}), so the runner kept '${version:-none}'. Launchpad's key API returns HTTP 500 intermittently - re-run this job. See ORCA-287." >&2
  exit 1
fi

echo "::error::shell contracts needs fish 4+ (DECSET 2031 arming, #9993) but got '${version:-none}'. The apt source was reachable, so this is the fish install or the package itself, not a Launchpad outage." >&2
exit 1
