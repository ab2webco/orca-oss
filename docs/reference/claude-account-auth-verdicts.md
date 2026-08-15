# Claude Account Auth Verdicts

## Scope

Orca's managed Claude accounts list what exists, not what works. A managed vault
can hold a keychain entry that the provider no longer accepts, so a dead account
renders identically to a healthy one and the only signal reaches the user inside
a pane, after the worker is already lost.

An auth verdict is Orca's per-account answer to "does this credential still
authenticate", carried in `RateLimitState.claudeAccountAuth` and rendered per row
in Settings → Claude and in `orca account list`.

## Why Presence Is Not Proof

`isManagedClaudeVaultAuthenticated` answers a narrower question — a credential
file or keychain entry exists — and is correct for the switch preflight it
guards. It is not a verdict: a measured account with a live keychain entry that
the provider rejected still reads `true`. Nor does the vault's
`.credentials.json` decide it. Measured on 2026-08-12: one account without the
file authenticated, another with an `expiresAt` two weeks past authenticated,
and a third with an entry present did not.

Only a provider response is proof. That is why a verdict is derived from usage
fetches rather than from the filesystem.

## When Orca Verifies

Verifying costs one provider call per account and refreshes an OAuth token.
Rotating a token a live CLI owns is itself a way to break the chain, so Orca
never polls for verdicts. Verification happens at four moments, three of which
cost nothing extra:

1. **The Settings accounts pane mounts.** It triggers the same per-account usage
   trickle the status bar already uses. Search typing unmounts and remounts
   settings sections, so this fires more than once per visit;
   `INACTIVE_FETCH_DEBOUNCE_MS` (60s) in the rate-limit service is what bounds it
   to at most one round of provider calls per minute. The trickle also skips
   accounts whose usage is fresh, skips accounts inside a refresh cooldown, and
   passes `allowTokenRotation: false` for any account a live PTY owns.
2. **Per-account "Check sign-in".** One request, that account only, on demand.
   This is the only path the user can force.
3. **Any usage fetch that already runs.** The active account's refresh and the
   inactive-account trickle both record a verdict as a side effect, including
   the per-account fetch failure that was previously only logged.
4. **A live pane observing a provider rejection.** Free — see below.

Orca does not verify on a timer, and it does not verify an account on app start.

## When The State Changes Afterwards

An account measured healthy can fail minutes later. Measured on 2026-08-12: an
account was re-authenticated, verified healthy against a pinned pane that
returned quota, and reported `Login expired` again roughly 30 minutes later with
the agent still working. A single check at open is therefore never the whole
answer, and a verdict is always a statement about a past instant.

Three rules follow.

**A pane rejection demotes the account for free.** When a pane's Claude CLI
prints the provider's `Login expired · Please run /login` banner, the renderer
resolves which managed account that PTY runs on and records a
`credential-rejected` verdict. The Settings roster and `orca account list` turn
negative without the user re-opening anything and without a provider call. Only
the banner is trusted: a line that starts as quoted or logged output does not
count, and an unattributable or remote pane records nothing rather than blaming
the wrong account.

**A pane cannot testify about a credential issued after it started.** The CLI
keeps redrawing its banner over the credential it launched with, so a rejection
observed by a pane that bound before the account's `lastAuthenticatedAt` would
fail a credential that now works — the same lie, inverted. Those rejections
record nothing; the toast names the account and says to restart the pane.

**Re-authenticating retires every earlier verdict.** The recorded failure was
about a credential that no longer exists, so the row returns to "not checked
yet" rather than staying red or claiming a pass nobody proved. A usage fetch
already in flight when the credential was reissued cannot restore either state:
each verdict write carries the account's rejection revision and is dropped when
that revision has moved.

## Reading A Row

| Row says | Means |
| --- | --- |
| `Sign-in verified <age>` | A provider response accepted this credential at that instant. Not a claim about now. |
| `Sign-in verified <age> · last check could not confirm it` | The last proof stands, but the newest attempt was inconclusive (network, server, throttle, or a live session holding the token). |
| `Sign-in expired` / `No stored credential` | A provider response rejected it, or a pane observed the rejection banner. |
| `Sign-in not checked yet` | Nothing has asked. Never rendered as a pass. |
| `remaining quota unknown` | No usable usage snapshot, and the figure cannot be obtained without spending the token. Orca states this instead of leaving a blank that reads as `0% used`. |

An inconclusive probe never overwrites a verdict — it annotates it. `No
credentials` as a bare error string is treated as inconclusive, not as a
failure, because managed keychain read failures currently collapse to that same
legacy message.

## When A Live Session Holds The Token

`live-session-holds-token` means Orca refused to rotate this account's single-use
refresh token because a live Claude CLI owns the chain (ORCA-211). That refusal
is correct and stays: rotating under a running CLI strands it on a dead token and
costs two sessions instead of one.

What is not correct is believing a claim forever. The gate is populated in main
by `markClaudePtySpawned` / `markInjectedClaudePtySpawned` and cleared by
`markClaudePtyExited`. A daemon-side kill the main process never observed leaves
the claim standing, and `confirmSeededClaudeLivePtys` cannot help: it runs once,
at daemon init, over startup seeds only. So an account claimed by a session that
already died can never rotate again — and when its token expires meanwhile, the
row is stuck on `live-session-holds-token` with no way out (ORCA-224).

`reconcileLiveClaudePtyGate` re-checks a blocking claim against the daemon before
the rotation decision believes it. Its boundaries are what keep this a sharper
distinction rather than a weaker protection:

- The daemon that hosts the session is the only authority. `listLiveDaemonPtyIds`
  returns `null` unless **every** daemon generation answered, and a `null`
  inventory releases nothing. One unreachable adapter means unknown, not empty.
  (Daemon init may fail open on that same signal because no PTY can exist before
  it; at runtime that reasoning does not hold.)
- A claim registered while the probe was in flight is kept, since the inventory
  could not have seen it.
- Launch reservations are never touched. They hold an account before any session
  id exists, so no inventory can vouch for them.

There is no signal for the case the ticket describes from the outside — "this
CLI's login expired, so it can no longer use the token Orca is protecting for
it". Nothing outside the CLI observes that. Process existence is the signal Orca
does have, and a dead process cannot be stranded by a rotation.

`beginManagedClaudeAccountMutation` is synchronous and still believes the gate
without a re-check, so a stale claim can still block select/re-auth/remove until
some rotation decision reconciles it.

## Known Limit

"A pane cannot testify about a credential issued after it started" is decided in
the renderer, from when the pane bound its current PTY. A PTY id is stable across
reattach, so an ordinary reconnect keeps that instant — but a renderer reload
rebuilds the detection state from scratch, and the surviving CLI's pane then
looks newer than it is. After a reload that follows a re-authentication, a stale
pane's banner can still turn a working account's row red. "Check sign-in" clears
it in one request.

Closing this properly needs a CLI process start time. Nothing in main records one
today: the live-PTY registry (`live-pty-account-state.ts`) holds ids and owners,
not timestamps, and its wildcard/ownership invariants are load-bearing for
ORCA-190. Adding one is a separate change.
