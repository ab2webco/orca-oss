# Per-worktree test resources: `ORCA_WORKTREE_SLUG`

Two members running a suite at the same time from sibling worktrees of one repo clobber each
other when the project's test config uses fixed names: one test database, one Redis db, one queue,
one port. Orca does not edit any project's config. It sets one variable in every terminal it starts,
and the project opts in by suffixing its resource names with it.

## The variable

`ORCA_WORKTREE_SLUG` is `<directory>_<hash>`, for example `feature_login_3f9a0c12`:

- only `[a-z0-9_]`, at most 49 characters, so it is a valid PostgreSQL/MySQL identifier
  (63/64-char limits), queue name and file name in POSIX shells, `cmd` and PowerShell;
- `<directory>` is the worktree directory name, lowercased, other characters folded to `_`,
  cut at 40 characters (`worktree` when nothing is left); a folder workspace uses `folder`;
- `<hash>` is 8 hex characters of the worktree's identity (repo + path), so sibling worktrees
  differ, and two repos that both have a `feature` worktree differ too;
- stable across Orca restarts and terminal reattach. Moving or renaming the worktree directory
  changes it: the old resources are left behind and the project's setup creates new ones.

It is set in every Orca terminal of a worktree or folder workspace, including the main checkout,
background and setup terminals, agent terminals of `orca game launch` members and orchestration
workers, and every process those start. On SSH hosts it is computed by the client and sent with the
spawn, so all clients of one remote worktree see the same value; it is kept when remote agent hooks
are off (unlike `ORCA_WORKTREE_ID`) and survives a relay revive. WSL terminals receive it unchanged.

It is absent in terminals opened before the Orca version that added it until they are restarted,
and in shells Orca did not start. Every example below falls back to the old fixed name when it is
unset, so a project that adopts the pattern keeps working outside Orca.

## Patterns

**Database** (Rails `config/database.yml`):

```yaml
test:
  database: myapp_test<%= "_#{ENV['ORCA_WORKTREE_SLUG']}" if ENV['ORCA_WORKTREE_SLUG'] %>
```

Run `bin/rails db:prepare` once per worktree (a setup script is a good place).

**Cache** (a Redis key prefix, any language):

```js
const prefix = `myapp:test:${process.env.ORCA_WORKTREE_SLUG ?? 'default'}:`
```

**Queue** (a Sidekiq/Bull/RabbitMQ queue name):

```ruby
QUEUE = ['mailers', ENV['ORCA_WORKTREE_SLUG']].compact.join('_')
```

**Port** (hash the slug into a range; a collision is possible but rare, so keep a retry):

```js
const slug = process.env.ORCA_WORKTREE_SLUG
let port = 3000
if (slug) {
  let hash = 0
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  port = 3100 + (hash % 800)
}
```

## Not covered

Orca does not create, reserve or clean up the resources. Dropping a worktree's database after the
worktree is deleted is the project's job (an archive script can read the variable before removal).

## Remote compatibility

The variable is added when the terminal's environment is built, not in an RPC. A remote relay
older than this change still passes it through to new shells but forgets it on a relay revive;
such a terminal gets it back when it is restarted.
