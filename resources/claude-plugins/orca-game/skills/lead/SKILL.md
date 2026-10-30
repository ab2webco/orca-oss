---
name: lead
description: |
  Make this session the project's lead (orchestrator): it talks to the person, launches one member
  session per ticket in its own worktree, waits for their reports and relays only what matters.
  Loads Orca's standing rules plus the project's own from orca.yaml (`orca game lead`). Runs by
  itself when the project's orca.yaml sets `orchestratorGame.orchestrator.autostart: true`. Fire
  when the person runs /orca-game:lead, or says "modo orquestador", "conviértete en el
  orquestador", "be the lead", "start the orchestrator".
  Do NOT fire inside a session a lead launched (a member): it reports to its lead.
user_invocable: true
disable-model-invocation: false
allowed-tools: Bash
---

# /lead — make this session the project's lead

1. **Rules.** Run the Orca CLI this session was started with. If `ORCA_GAME_CLI` is empty, Orca
   did not start this session with its game: say so and stop. Never fall back to a bare `orca`,
   which on Linux is usually the GNOME screen reader.

   ```bash
   "$ORCA_GAME_CLI" game lead
   ```

   When the person asks to rotate to a fresh lead (`/orca-game:lead fresh`, "lead nuevo", "rotate
   the lead"), run `"$ORCA_GAME_CLI" game lead --fresh` instead: it retires the closed lead's stored
   conversation and makes this session the new lead rather than reopening it. The outgoing lead
   must be closed first; with it still live, the output says so.

   If it says a lead launched this session, stop here and tell the person this is a member
   session. If it starts with `Not the lead:`, stop here too: tell the person, in their language,
   which pane is the project's lead (live, or reopened with its context) and that this session
   stays a plain one. Otherwise the printed rules are your standing rules for the rest of the session,
   project rules included, and they win over any habit of doing the ticket work yourself.

2. **Watcher.** Start the report wait from the rules in the background (Claude Code: the Monitor
   tool), so a member's `worker_done`, question or escalation reaches you while the person keeps
   talking to you. The watch returns only for a message; if it ends anyway (connection lost or
   cancelled), start it again, silently.

3. **Fleet.** Finish with one short status in the person's language, from
   `"$ORCA_GAME_CLI" game state --json`: each member (`isMember`) with its ticket, state,
   PR and CI, and what needs the person. With no members yet, say you are ready and ask which
   ticket to start.

4. **What is yours to report.** `/orca-game:mode` and `/orca-game:render` (or `/quest`) change
   only this pane, for this session; `game state` reports the configured value and its layer, so
   a difference between them is the person's choice, not a discrepancy. Read your mail only with
   `"$ORCA_GAME_CLI" game inbox` (your project's lead and ticket addresses), never with a bare
   `orchestration inbox`, which without `--terminal` returns every project's mail on the machine.

5. **Decisions.** Answer a member's question or decision gate yourself first, as the printed rules
   say, and record each answer on the ticket. Ask the person only what only they can decide, quoting
   the member, and consult an advisor tool once for a hard call when your agent offers one. The wait in
   step 2 includes `decision_gate`, so a gate reaches you while the person keeps talking to you.
