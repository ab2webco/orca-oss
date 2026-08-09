// Why: single source of truth for the commit trailer Orca appends when the
// "Orca Attribution" toggle (`enableGitHubAttribution`) is on. Used by both
// the terminal git/gh shim and the AI commit-message generator so the two
// code paths agree on the exact string.

// Why this address: this fork runs no mailbox, and the address it replaced was
// upstream's live support inbox — every agent commit made here pointed a
// reply-to at maintainers who never agreed to receive it.
// `users.noreply.github.com` is reserved per account, so this names the fork's
// owner without inventing a routable mailbox. Replace it the day we have one.
export const ORCA_GIT_COMMIT_TRAILER = 'Co-authored-by: Orca <ab2webco@users.noreply.github.com>'
