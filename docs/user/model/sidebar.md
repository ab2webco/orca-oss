# Sidebar and new tabs

The left sidebar lists every workspace on every host, one line each. The **+** button at the end of
the tab bar opens terminals, agents and, for a project with a lead, its team.

## Hosts and rows

- Each host is a tree row with its name and how many of its workspaces are active, meaning an agent
  is working or waiting for your permission. Your own machine is called **This computer** here and
  everywhere else Orca Lab names a host, unless you renamed it.
- When a host has a problem, the count gives way to **Update required**, **Authentication needed**
  or **Disconnected**.
- Projects and organizations sit directly under their host, and each workspace is one row.
- A team's lead and members are drawn as agent rows: a state dot, a PR icon colored by its CI (or
  a branch icon), the name and the age. The lead carries a crown and its branch; its members sit
  under it, and one that needs you shows a question mark.

## Group and filter

Open **Workspace options** (the sliders button at the top of the list).

- **Group by** takes **None**, **Status**, **PR** or **Project**. **Status** groups rows into
  **Needs you**, **Working** and **Idle**; **PR** into **With PR** and **Without PR**. **Project
  order** (**Manual** or **Recent**) appears while you group by project.
- **Show** picks hosts and projects when you have more than one.
- **Filters** hide sleeping workspaces (optionally except the default branch), the default
  branch, workspaces created by an automation or the CLI, workspaces of other clients, and
  detached HEADs. The options button shows how many filters are on.

When filters hide something, a line under the list says how many rows are hidden; **View filters**
on that line opens the same menu.

## What a row shows

**Card layout** (**Detailed** or **Compact**) and **Show properties** in the same menu choose what
each row carries.

With **Settings > Experimental > New card style** on, the menu shows **Card display** instead, in
three groups:

| Group  | Properties                                                                          | On by default                    |
| ------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| Work   | GitHub issues, Linear issues, Jira issues, Plane work items, Pull request and checks, Notes | All but Notes            |
| Agent  | Agent statuses, Account, Model and effort                                           | Agent statuses                   |
| Source | Branch name, Ports, Automation, Orca Lab CLI                                        | None                             |

Status and unread marks always show. If you never changed your properties, they move to these
defaults; a profile you customized keeps its choices.

## The + menu

**+** (**New tab**) opens a menu with up to three groups:

- **Team**, only in a project that has a lead:
  - With the lead running: **Go to lead** opens the lead's session, and **Add member…** lists the
    project's To Do with a **Member account** picker. Picking a ticket asks the lead to start a
    member for it.
  - With the lead closed but kept: **Reopen team** brings the lead back on its account, and
    **Start fresh lead…** asks to confirm, then starts a new lead (`/orca-game:lead fresh`) on the
    account you pick.
- **Terminal**: **New Terminal** (and each Windows shell), **New Browser Tab**, the mobile emulator
  and Markdown files.
- **Agents**: every agent Orca Lab detected. **Claude Agent Teams** leaves this list while the
  project has a lead, so you do not start a second one.

The To Do in **Add member…** comes from every tracker linked to the project: the
`orchestratorGame.todo` entry in `orca.yaml`, the linked Plane project, the Jira or Linear key of the
worktree's ticket, and the repository's GitHub or GitLab issues. Each source gets a fair share of
the list.
