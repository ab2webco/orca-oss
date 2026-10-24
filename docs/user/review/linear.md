# Linear and Plane tasks

Orca Lab can show issues from Linear and Plane on its Tasks page, start a worktree from an issue,
and pass the issue to the agent as context. GitHub and GitLab tasks work the same way.

## Connect a tracker

- **Linear:** enter a personal API key in the Linear dialog.
- **Plane:** enter the base URL of your Plane server, your workspace, and a personal access token.
  The token is stored on your machine, encrypted when your system supports it.

Plane is shown in the Tasks source picker by default. To hide it, turn off the **Plane**
visibility setting. Its settings section appears once Plane is connected.

## Start a worktree from an issue

- Open the issue from the Tasks page and start a workspace from it.
- The new worktree records the linked issue. Orca Lab fills the agent's first message from the
  **Launch prompt template**, which includes the issue identifier and link by default. You can
  edit the template in Settings.

## Link a pull request or issue by hand

Open the workspace details dialog and enter a PR number or GitHub URL, or an issue number or
GitHub URL. Leave a field blank to remove the link.
