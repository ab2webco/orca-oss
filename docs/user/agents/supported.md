# Supported agents

Orca Lab runs coding agents in terminal tabs. It can launch and track any agent that runs as a
command-line program, and it has built-in launch support for a list of known agents, including
Claude Code, Codex, Gemini, Aider, Cursor, Copilot, Grok and OpenCode.

## Launching an agent

- Pick an agent when you create a worktree, or open a new agent tab with the default agent.
- Orca Lab finds the agent's command on your PATH. Install the agent first, following its own
  documentation.

## Status hooks

For some agents, Orca Lab installs status hooks so it can show whether an agent is working,
waiting for you, or done. The hooks report to a local listener on your machine.

Turn off **Agent status hooks** in Settings to stop Orca Lab from installing these hooks and to
remove the ones it manages.

Agents without hooks get their status from the terminal title instead, so the state can be less
precise.

## Accounts

Claude and Codex accounts can be added and switched in Orca Lab. See
[Usage tracking and accounts](usage-tracking.md).
