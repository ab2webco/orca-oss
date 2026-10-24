# SSH

Orca Lab can create worktrees and terminals on a remote machine over SSH, so the agents run next
to the code.

## Add a host

- Click **Add Target** to enter a host by hand, or **Import** to choose hosts from `~/.ssh/config`.
- A host can use a port, an identity file, ssh-agent, a ProxyCommand or a ProxyJump.
- Orca Lab asks for a passphrase or password when the host needs one. It keeps it only in memory for the session.

## What runs on the remote host

The first time you connect, Orca Lab uploads a small Node.js relay to `~/.orca-remote` on the
remote host and starts it over SSH. The relay runs terminals, git worktrees and file operations
on that machine.

The remote host needs:

- Node.js 18 or newer, and npm.
- Build tools (make, a C++ compiler and python3) when the relay has to compile the terminal module.

Linux, macOS and Windows hosts are supported, on x64 and arm64.

## Reconnecting

Remote terminals keep running for a grace period after a disconnect. In **Remote Terminal
Persistence**, choose how long to keep them. The default keeps them until you reset them.
Orca Lab allows at most 7 days.

## What is stored on your machine

Host settings are saved in Orca Lab's data file on your machine. Passwords and passphrases are
not saved.
