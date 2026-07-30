// Why (ORCA-138): a data command that could not attach to the local runtime used
// to end at "Orca is not running. Run 'orca open' first." That was false in the
// report — Orca was running, only this shell could not reach it — and it named no
// way forward, so the reporter concluded the CLI was broken and asked for raw
// REST API keys instead. Shells Orca does not manage have a designed path:
// pair once, then select that environment per command.
//
// Deliberately platform-neutral: on Linux the command is `orca-ide`, and one
// string is easier to keep correct than a per-platform pair.
export const LOCAL_ATTACH_NEXT_STEPS: readonly string[] = [
  "Check whether Orca is already running with 'orca status --json'.",
  'To use the CLI from a shell Orca does not manage, generate a pairing code in the Orca app, then run ' +
    "'orca environment add --name <name> --pairing-code <code>' once.",
  "Then pass '--environment <name>' on each command, or export ORCA_ENVIRONMENT=<name>.",
  "If Orca is not running at all, start it with 'orca open'."
]

/**
 * Recovery payload for local-attach failures. Surfaces through the existing
 * `data.nextSteps` channel, so it reaches both the human stderr output
 * (formatCliError) and `--json` consumers (localCliErrorData) unchanged.
 *
 * Only for failures to *reach* the runtime. Errors raised once a connection is
 * established — a mid-flight runtime restart, a peer close before responding —
 * are retry cases, and pairing advice there is noise.
 */
export function localAttachRecoveryData(): { nextSteps: readonly string[] } {
  return { nextSteps: LOCAL_ATTACH_NEXT_STEPS }
}
