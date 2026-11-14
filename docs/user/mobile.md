# Mobile

The Orca Lab app pairs with your desktop and puts your agents in your pocket. This page describes
version 0.0.62.

## Install

Open **Settings > Mobile** on the desktop. It links the
[TestFlight](https://testflight.apple.com/join/xbePNDGj) build for iPhone and the **Android APK**
from the [`mobile-android-v*` releases](https://github.com/ab2webco/orca-oss/releases?q=mobile-android).
The app is not in the App Store or on Google Play yet.

## Pair

On the same **Settings > Mobile** page, scan the QR code from the app. After that the phone reaches
the desktop directly on your network, or through an end-to-end encrypted relay when it cannot.

## Home

- Each paired desktop has a card with its status and worktrees.
- While the desktop is connected, the card shows its team: how many members, how many are working,
  and **N needs you** in red when a member waits for you. It also shows the active Claude account
  and its 5-hour use, green under 60%, amber from 60% and red from 80%.
- When the desktop drops, the team line reads **Last known:** with the time it was last seen. The
  app forgets it when it restarts.
- Older desktops that do not share their team show no team line.

## Accounts

Tap an **Account usage** card on Home, or the person icon on a desktop's worktree list.

- The desktop's name under **Accounts** opens **Accounts on**, a list of your paired desktops with
  their state. Opening the list does not connect to any desktop on its own.
- **Claude** and **Codex** list **System default** and each account with its 5-hour and 7-day bars.
  Tap an account to switch to it.
- Under each account, a line names who runs on it, such as the lead and its members.
- Add or sign in to accounts from the desktop.

## Team drawer and Inbox

- **Team drawer.** On a lead's terminal, a bar at the bottom opens the drawer with two tabs:
  - **Team**: a card per member with its ticket, host, state, account use and PR with CI. Tap a
    card for its title, summary and **Open terminal**. **Metrics** shows merges per day and the
    median lead time.
  - **Inbox**: the lead's questions for you, and the threads. The drawer opens here when a question
    waits, and **Answer in Inbox** on a card takes you to it.
- **Inbox per desktop.** The **Inbox** row on a desktop's worktree list opens every waiting
  question on that desktop, one section per project.
- **Notification tap routing.** A tap opens the right host and screen; a lead's question opens the
  lead's terminal with the Team drawer.

## Also on the phone

- **Live terminals.** Watch any agent's terminal stream and type into it. Dim text on a dark
  background is raised to a readable contrast.
- **Plane board and plugin panels**, and a button that asks the desktop to install its pending
  update.

The phone does not yet start members, open the Team panel or change scenes and settings; do those
from the desktop. The lead and its members are described in [Agent Teams](agents/agent-teams.md).
