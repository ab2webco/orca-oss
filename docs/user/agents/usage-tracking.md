# Usage tracking and accounts

Orca Lab shows how much of its rate limit your Claude and Codex accounts have used, and lets you
switch between accounts without signing in again.

## Usage

- Orca Lab checks Claude and Codex usage every 15 minutes by default, and never more often than every 30 seconds.
- Use **Refresh rate limits** to check now.
- Claude usage is requested from Anthropic's usage endpoint with your account's OAuth token. If that request fails, Orca Lab runs `claude` in a hidden terminal and reads the `/usage` output.
- Codex usage is read from the local Codex app server, or from the `/status` output, and from OpenAI's usage endpoint.
- **Reset now** on a Codex account spends one of your reset credits. Orca Lab asks for confirmation first.
- **Claude Usage Tracking** and **Codex Usage Tracking** also count local session activity from the agent's log files on your machine.

Accounts that use a custom endpoint do not have usage tracking.

## Switching accounts

- Use **Switch to** in the account list, or `orca account switch --to <email|id>` from the CLI.
- Switching is available for Claude accounts from the CLI. For Claude, the same terminal is relaunched and resumes the same conversation. If the relaunch fails, Orca Lab restores the previous account.
- Auto-switch is not available for SSH terminals, because the account credentials live on the remote host.
- To switch a terminal on a paired host, name it and the host: `orca account switch --to <email|id> --terminal <handle> --environment <host>`. The target is one of that host's own accounts.
- `orca account list` shows cached quota. It never prints credentials.

## Where credentials are stored

Managed Claude and Codex credentials stay on your device, in Orca Lab's data folder. On macOS,
Claude credentials are also stored in the Keychain under the name "Orca Claude Code Managed
Credentials".

To see which requests Orca Lab makes for usage and sign-in, see [Telemetry and privacy](../telemetry.md).
