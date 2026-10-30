# Remote host placement

Design for ORCA-790: run Orca Game members and plain orchestration workers on connected Orca hosts,
balanced by capacity, with one host kept for E2E work. This note answers the eleven refinement
questions with code references. It contains no product code.

References were read in this tree at `7b85ce2a73c`. Anything not read is marked **unverified**. No
live run was made and no remote host was contacted.

## Summary

- Remote placement exists in `orchestration worker-start --on <saved-environment>` and, since
  ORCA-794, `game launch --on <host> --repo <host repo>`. The Run and the coordinator stay on the
  home host. `game wave` has no placement.
- The home Run DB already records each federated dispatch's environment (`federated_dispatches`), so
  a cross-host fleet can come from the lead's own DB without scanning remote hosts.
- Per-host capacity needs no new RPC. `diagnostics.memory` returns the host fields the game's cap
  formula already uses.
- Sending a game member to a remote host needs a new capability. Federated attach drops `game` and
  `setupAdmission` today. An older host must be refused, not given a silent non-game worker.
- One placement module in shared orchestration code serves both the game and plain `worker-start`.

## Facts the design depends on

| Fact                                                                                                     | Reference                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `game launch` takes no `--on`; it starts `new-top-level --repo` or `new-child`, always with `game: true` | `src/cli/specs/orchestrator-game.ts:74`, `src/cli/handlers/orchestrator-game-launch.ts:224-234`, `docs/reference/orchestrator-game.md:542` |
| `--on` routes to the federated start; without it the local topology runs                                 | `src/main/runtime/rpc/methods/orchestration-workers.ts:53-64`                                                                              |
| Remote `current` and `new-child` are refused on the home and on the remote                               | `orchestration-federated-worker-start.ts:46-50`, `src/main/runtime/rpc/methods/orchestration-federation.ts:33-37`                          |
| Remote `--claude-account` and `--codex-account` are refused with `--on`                                  | `orchestration-worker-start-validation.ts:21-25`                                                                                           |
| Remote `new-top-level` needs `--name` and an explicit `--repo` from remote discovery                     | `orchestration-worker-start-validation.ts:27-31`                                                                                           |
| Federated attach params carry no `game` and no `setupAdmission`                                          | `src/main/runtime/rpc/methods/orchestration-federation-start-schema.ts:5-24`                                                               |
| The game flag marks the host-side member as a game member                                                | `orchestration-worker-topology.ts:160`, `orchestration-workers.ts:181`                                                                     |
| Fleet derives `isMember` from local agent rows                                                           | `src/main/runtime/orchestrator-game-fleet.ts:139`                                                                                          |
| Game state never reads `federated_dispatches` (grep over the game files: no match)                       | `src/main/runtime/orchestrator-game*.ts`, `src/shared/orchestrator-game-*.ts`                                                              |
| Federated dispatches store `environment_id`, `environment_name`, `peer_fingerprint`                      | `src/main/runtime/orchestration/db.ts:532-534`, `:4440-4446`                                                                               |
| Remote messages arrive as `from: dispatch:<id>`, `to: run:<runId>`                                       | `src/main/runtime/orchestration/federation-sync.ts:107-111`                                                                                |
| A sync compares the peer fingerprint and fails with `peer_changed`                                       | `federation-sync.ts:68-71`                                                                                                                 |
| Relay polls every 1 s; sync errors are swallowed                                                         | `src/main/runtime/orca-runtime.ts:5424-5447`                                                                                               |
| A federated first signal gets a 60 s transport grace                                                     | `src/main/runtime/orchestration/dispatch-lifecycle-deadline.ts:10-13`                                                                      |
| The default member cap comes from one host's total memory and cores                                      | `src/shared/orchestrator-game-lead.ts:64-72`                                                                                               |
| The launch refusal compares running members with the cap                                                 | `src/cli/handlers/orchestrator-game-launch.ts:297-298`                                                                                     |
| `diagnostics.memory` returns the runtime memory snapshot                                                 | `src/main/runtime/rpc/methods/diagnostics.ts:5-9`                                                                                          |
| Host memory carries `totalMemory`, `availableMemory`, `cpuCoreCount`                                     | `src/shared/process-stats-types.ts:61-70`                                                                                                  |
| The setup queue is keyed per host (`ssh:<connectionId>` or local)                                        | `src/main/runtime/rpc/methods/orchestration-worker-setup-queue.ts:21-23`                                                                   |
| Setup admission reads local memory pressure                                                              | `src/main/runtime/orchestration/worker-setup-admission.ts:11-20`                                                                           |
| Under `accounts: auto`, a member's account comes from this host's roster only                            | `docs/reference/orchestrator-game.md:812-837`                                                                                              |
| An older host drops `setupAdmission`; a capability guards it                                             | `src/shared/protocol-version.ts:70-72`                                                                                                     |
| The wire harness covers the terminal stream only                                                         | `docs/reference/remote-wire-compatibility.md`, "Enforcement"                                                                               |
| Environments are saved in `orca-environments.json`                                                       | `src/shared/runtime-environment-store.ts:20`                                                                                               |
| `environment add` requires `--pairing-code`; codes come from `orca serve`                                | `src/cli/handlers/environment.ts:17-18`, `docs/reference/headless-linux-server.md:85-98`                                                   |
| Plain `worker-start` has no automatic host choice; the selector is explicit                              | `src/main/index.ts:2787-2794`                                                                                                              |
| No role routing exists (no `e2e` role or host routing in `src/`)                                         | grep of `src/shared`, `src/cli`, `src/main/runtime`                                                                                        |
| The game mod source is in this repo                                                                      | `resources/claude-plugins/orca-game/`                                                                                                      |

## Answers to the refinement questions

### Q1. Placement surface

Today only `orchestration worker-start --on` places work remotely. `game launch` and `game wave`
have no placement, and the cap is one project-wide number checked at launch
(`orchestrator-game-launch.ts:300-301`).

Proposal: `game launch <ticket> --on <host|auto>` and `game wave ... --on <host|auto>`. A host record
holds its name, its saved environment, a `role` (`dev`, `e2e` or `any`), a `cap`, and a map from the
ticket's repo to the remote repo selector. A per-host cap replaces the single cap when a host is named.
Where the host list lives is decision O1.

### Q2. Load balancing

Signals readable today:

- **Running members.** Counted from local rows plus paused and queued members
  (`src/shared/orchestrator-game-fleet-verbs.ts:191-195`). Remote members are not counted yet; they
  must come from `federated_dispatches` (Q3).
- **Memory.** A remote host's `diagnostics.memory` returns `availableMemory` (Q-facts table). The
  admission thresholds in `worker-setup-admission.ts:11-20` read the local host only. A federated
  start does not admit a remote setup in the home queue. Since ORCA-792 the home forwards
  `setupAdmission` to a host with `orchestration.federation-game-member.v1`, and that host claims its
  own setup slot only if it is free now. A busy host refuses with `setup_slot_busy` and
  `data: { host, waitingOn }`, and starts nothing; it never queues (O3).
- **Account quota.** Read from the roster of the host that runs the member. A remote quota comes from
  the remote roster, not the home one.
- **ORCA-706** (memory impact signals) is still Todo. Placement does not depend on it.

Proposed policy, applied in order:

1. Keep hosts whose role matches the request.
2. Drop unreachable hosts.
3. Drop hosts at cap, counting their remote members from the home DB.
4. Drop hosts whose `availableMemory` is under the admission threshold.
5. Pick the lowest running count, then the most available memory, then the name.

The account is picked on the chosen host. If every host is full, the launch is refused and names each
host (decision O3).

### Q3. One fleet across hosts

- Today `isMember` comes from local rows (`orchestrator-game-fleet.ts:139`), and game state never reads
  `federated_dispatches`. A remote member is therefore absent from `game fleet` and `game state`.
  This is established by grep, not by a live run. Child 3 proves it with a test.
- Proposal: build the cross-host fleet from `federated_dispatches` joined with the dispatch rows in the
  home DB (`db.ts:532-534`). This avoids per-host process scans.
- `GameAgent` has no host field (`src/shared/orchestrator-game-state.ts:42-72`). Proposal: add an
  optional `host` (environment id and name). Older clients ignore it (wire Rule 1).
- A remote member has no local `terminalHandle`, so it gets no View button. `terminalHandle` is
  already optional on the wire (`orchestrator-game-state.ts`, same type).
- Messages from the remote already reach the lead through sync (`federation-sync.ts:107-111`), so
  `worker_done`, questions and escalations keep flowing.
- Dependency: ORCA-764 (membership follows the parent terminal; In Progress). Child 3 starts after it.
- The game mod is in this repo at `resources/claude-plugins/orca-game/`, so the "show host" change
  belongs here.

### Q4. Remote worktrees

- Only `new-top-level` works remotely, with `--name` and `--repo` from remote discovery
  (`orchestration-worker-start-validation.ts:27-31`). `current` and `new-child` are refused on both
  sides.
- Proposal: a per-host repo map from the ticket's repo to the remote selector. Without it the game
  cannot name a remote repo.
- **Unverified:** the remote's `pnpm install` and node_modules setup, branch push and fetch from the
  remote, and whether the remote host runs its own setup admission. Child 4 verifies these on a real
  remote repo.

### Q5. Accounts

- `--claude-account` and `--codex-account` are refused with `--on`
  (`orchestration-worker-start-validation.ts:21-25`). The remote resolves accounts from its own roster.
- Proposal: a remote member picks its account on the remote, from that host's roster. No new pin
  field. The accounts must be registered on the remote over SSH
  (`docs/reference/headless-linux-server.md:764-775`).
- Shipped (ORCA-798, decision O5 revised): `auto` alone could land on an account a project forbids,
  so `game launch --on` forwards the typed selector (`auto` or an email) in the optional
  `account` field of `federationAttachStart`, gated by
  `orchestration.federation-member-account.v1`. The host resolves it in
  `orchestration-federation-member-account.ts`, refuses before any effect, and returns only the
  email. No account id crosses hosts.
- ORCA-891: an unset `orchestrator.accounts` is sent as `auto` too, with
  `remoteAccountByDefault`, but only to a host that also advertises
  `orchestration.federation-member-global-login.v1`. That host runs `auto` on its global login
  when it has no managed account for the agent, one federated member at a time
  (`orchestration-federation-global-login.ts`), and reports `globalLogin` on the attach receipt
  and on `federationShow`. An older host gets no selector and the home reports `older_host`.
- A cross-host `game move` is a new dispatch on the other host, not an in-place switch. The current
  `game move` restart path (`src/cli/handlers/orchestrator-game-move.ts:139-149`) is **unverified**;
  child 8 reads it before changing it.

### Q6. E2E host

- Nothing routes by role. The state type defines only the `lead` and `member` roles
  (`orchestrator-game-state.ts:138`, read in the mapping pass).
- Proposal: an explicit `--role e2e` on `game launch` and `game wave`. The lead tags the task; the
  placement never infers it from the prompt (decision O2).
- Headless E2E needs a display. The managed Xvfb service is documented at
  `docs/reference/headless-linux-server.md:219`.
- **Unverified:** how screenshots and other artifacts from an E2E host come back. Child 7 checks it.

### Q7. SSH-only machines

- A saved environment needs `orca serve` and its pairing code
  (`docs/reference/headless-linux-server.md:85-98`, `src/cli/handlers/environment.ts:17-18`).
- The SSH repo path reads the ambient `SSH_AUTH_SOCK` (`src/main/ssh/ssh-auth-resolution.ts:48`).
  This design does not extend that path. Placement never reads an ambient agent or socket.
- Proposal: require `orca serve` on the host. The owner starts it over SSH with explicit authorization
  (decision O4).

### Q8. Mixed versions

- The `game` and `setupAdmission` attach fields are optional, which is wire Rule 1. But a new client
  that depends on an old remote honoring `game: true` would start a non-game worker silently. That is
  the Rule 1 trap, and Rules 2 and 3 apply
  (`docs/reference/remote-wire-compatibility.md`).
- Built in ORCA-792: the capability `orchestration.federation-game-member.v1`, listed beside
  the existing ones (`src/shared/protocol-version.ts:64-78`). The home sends `game` and
  `setupAdmission` only after the remote confirms the capability. An older host is refused for game
  placement with a named error. Plain `worker-start --on` keeps working on older hosts.
- Built in ORCA-790: `orchestration.federation-release.v1`. `worker-release` and `game stop` on a
  settled remote member call `orchestration.federationRelease` on its host. That closes the agent
  terminal the dispatch created and removes the worktree it created, without `--force`, so a tree
  with changes stays. Both servers then mark the dispatch `stage = released` and it leaves the
  fleet. A host without the capability keeps the member `retained` with `federation_unsupported`
  and nothing is called there.
- Built in ORCA-856: `orchestration.federation-member-reopen.v1` (federation protocol 4). A remote
  member that already sent `worker_done` can still `ask`: the host keeps its capability proof at
  settlement (`settled_capability_hash`, migration 38), reopens the attachment, and the home pulls
  settled members every 10 s, so the question reopens the home Dispatch and lands in the lead's
  waiting list. Against a home at protocol 3 the host refuses with `dispatch_reopen_unsupported`
  and a message telling the member to ask the lead for a follow-up dispatch.
- Built in ORCA-838: `orchestration.federation-follow-up.v1` (federation protocol 5). The lead's
  `orchestration send --to dispatch:<id>` to a settled, unreleased remote member reopens that same
  Dispatch at home and relays a `follow_up` item; the host reopens the attachment with the member's
  own capability, so push-on-idle hands the mail to the agent on its next turn and the Panel tracks
  it again. The body ends with a note to send `worker_done` again. A protocol-4 member is refused
  with `dispatch_inactive` naming `worker-start --on <host> --worktree … --terminal …`, and a
  `worker-start --on --terminal` that fails `agent_readiness` on a settled member's pane names the
  `send --to dispatch:<id>` follow-up.
- Precedent: `ORCHESTRATION_WORKER_SETUP_QUEUE_RUNTIME_CAPABILITY` exists because an older host drops
  `setupAdmission` (`src/shared/protocol-version.ts:70-72`).
- The wire harness covers only the terminal stream. Child 2 adds its own cross-version test for the
  attach path.

### Q9. Security

- Pairing codes and device tokens are stored in `orca-environments.json`
  (`src/shared/runtime-environment-store.ts:20`). Placement config stores environment names only,
  never codes or tokens.
- Federation binds to the peer key fingerprint and fails with `peer_changed` on a mismatch
  (`federation-sync.ts:68-71`). Placement uses the same check, so a host whose identity changed is not
  chosen.
- Placement reads no ambient SSH agent and no socket. The one path that does is repo-level, not
  placement.

### Q10. Failure when a host disconnects

- Today a failed sync is logged and polling continues every second
  (`src/main/runtime/orca-runtime.ts:5424-5447`). A federated start that loses its connection is marked
  `outcome_unknown` (`src/main/runtime/rpc/methods/orchestration-federated-worker-start.ts:250`).
- A federated member past its first heartbeat is warned as stale 10 minutes after the last heartbeat,
  as a warning only, never a failure (`docs/reference/orchestrator-game.md:921-925`).
- Proposal: derive a `host unreachable` state for members whose relay has failed for a set period.
  Mark those members, do not fail them, and do not block other hosts.
- Automatic retry on another host is **not** proposed. `outcome_unknown` means the remote may already
  have created a worktree or pushed commits. `--retry-of` does not inherit placement
  (`src/cli/specs/orchestration-worker-specs.ts:40`). A retry elsewhere waits for the owner's decision
  (O3).

### Q11. Plain orchestration parity

- `worker-start --on` routes to the federated start (`orchestration-workers.ts:53`). Without it, the
  local topology runs (`orchestration-workers.ts:64`).
- `--on` selects only the worker server; the Run and the command stay local
  (`src/cli/specs/orchestration-worker-specs.ts:38`).
- There is no automatic host choice. The environment resolver takes the explicit selector
  (`src/main/index.ts:2787-2794`).
- Proposal: `worker-start --on auto` calls the same placement module the game uses (child 6). The game
  and plain flows differ only in the `game` flag.

## Design

**Host record.** A host is a saved environment (per machine, in `orca-environments.json`) plus a
placement record: `role`, `cap` and the repo map. The default `cap` for a host is `defaultGameMemberCapOf`
applied to that host's `diagnostics.memory` (`orchestrator-game-lead.ts:64-72`). An explicit `cap` wins.
The record is validated in shared code with a zod schema. An unknown host name is refused at launch.

**Placement module.** A pure function in shared orchestration code, not under `orchestrator-game-*`. It
takes the host records, each host's running count from the home DB, each host's memory snapshot and the
requested role. It returns the chosen host or a named refusal.

**Fleet and state.** The cross-host fleet is read from the home DB. Per-host process scans are not used.
Built in ORCA-793: a new lead opens a new Run, so the fleet also lists unreleased remote members of a
Run whose lead is gone, and of the current Run from before this lead claimed it, as long as their
host still reports the terminal running. Those rows carry `remote.earlierLead`; a member whose home
task is completed carries `remote.ticketDone`, counts as finished, and its next step is `game stop`.
Another live lead's members are never listed. Both fields are optional on the wire.
Scoped in ORCA-848: an earlier Run counts only when its lead pane belongs to this lead's project
(`repo:<id>`, the key the game board and paused members use). The pane is the Run's coordinator pane,
or, once a newer Run took that pane, the pane that created the member's task. A Run whose lead pane
still runs is live even when a restart fenced its handle (ORCA-835). A Run Orca cannot place is left out.
Built in ORCA-837: `federationShow` also returns an optional `agent` (the host's latest Claude/Codex
hook state, its time and a usage limit), and that wins over the dispatch's status, so a member that
keeps working after `worker_done` reads as working. A host that omits it keeps the dispatch-and-title
reading, so no capability is needed: the read is the same RPC with one more optional field (Rule 1).

**Wire.** Capability `orchestration.federation-game-member.v1` (name proposed). `game` and
`setupAdmission` are forwarded only after the remote confirms it.

**Failure.** As Q10: mark, do not fail, do not retry automatically.

**Security.** As Q9.

## Child tickets (implementation order)

Each child is about 400 changed lines, starts with a RED test, and has acceptance criteria in its Plane
body. Child titles are prefixed with their order.

1. Host placement record and validation (shared, pure). Needs O1.
2. Federation capability and attach params for `game` and `setupAdmission`, with a cross-version test.
3. Cross-host fleet and state: `host` field from `federated_dispatches`, remote running count. Needs ORCA-764.
4. `game launch --on <host>`: repo map, `new-top-level`, named refusal for `new-child`. Needs 1, 2, 3.
5. Placement policy and `game wave` spreading. Needs 1, 3.
6. `worker-start --on auto` parity on the same module. Needs 5.
7. `--role e2e` routing for launch and wave, and the E2E host notes. Needs 4, 5.
8. Remote accounts and cross-host `game move`. Needs 4 and O5.
9. `host unreachable` state, lead escalation, no automatic retry. Needs 3.
10. Host display in the Panel, in `resources/claude-plugins/orca-game/`. Needs 3.

## Owner decisions

These need the owner. Each has a recommendation.

- **O1. Where the host list lives.** Recommended: host name, cap and repo map in the machine-local
  environment record; `orca.yaml` holds only the policy and the role names. A host name committed in
  `orca.yaml` breaks on every other clone.
- **O2. How an E2E task is marked.** Recommended: explicit `--role e2e`. Inferring it from the prompt
  can send a task to the wrong host.
- **O3. When every host is full.** Recommended: refuse with a named `cap_reached`, as today. Queueing
  hides a stalled wave. The same rule covers a retry on another host after `outcome_unknown`.
- **O4. SSH-only machines.** Recommended: require `orca serve` on them, started by the owner over SSH
  with explicit authorization. The alternative is an environment recipe.
- **O5. Remote accounts and moves.** Recommended: the remote picks its own account from its roster,
  with no new pin field. Also decide whether a cross-host `game move` is in this epic or a later one.

## Not verified

- Whether a federated member appears in `game fleet` through any local row. Grep shows no path; no live run.
- Whether the remote host admits its own setup when `setupAdmission` is not forwarded (Q2).
- Whether branch push, fetch and node_modules setup work on a remote host (Q4).
- The `game move` restart path (Q5).
- How screenshots and other artifacts return from an E2E host (Q6).
- The `game state` view of a remote member's PR and CI, which reads the remote worktree.
