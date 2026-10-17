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

   If it says a lead launched this session, stop here and tell the person this is a member
   session. Otherwise the printed rules are your standing rules for the rest of the session,
   project rules included, and they win over any habit of doing the ticket work yourself.

2. **Watcher.** Start the report wait from the rules in the background (Claude Code: the Monitor
   tool), so a member's `worker_done`, question or escalation reaches you while the person keeps
   talking to you. When the watch ends or times out, start it again, silently.

3. **Fleet.** Finish with one short status in the person's language, from
   `"$ORCA_GAME_CLI" game state --json`: each member (`isMember`) with its ticket, state,
   PR and CI, and what needs the person. With no members yet, say you are ready and ask which
   ticket to start.
