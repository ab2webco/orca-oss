/**
 * Decides whether the pushed upstream sync branch may be proposed as a pull
 * request against the fork's base branch.
 *
 * Why a module and not shell in the workflow: the YAML cannot be tested, and the
 * one thing this must never do is propose a branch whose merge deletes the fork.
 * The sync tries a real merge and, when that conflicts, resets the branch to
 * upstream's tip — a mirror, not a merge. A PR from a mirror carries a title that
 * reads "sync N commits from upstream" and a diff that reverts every fork commit
 * upstream never received.
 *
 * The verdict reads one measured property, not the conflict flag: how many
 * base-branch commits are absent from the pushed branch. Zero means merging drops
 * nothing, whatever route produced the branch.
 */

export const SYNC_PR_ACTION = Object.freeze({
  OPEN: 'open',
  WITHDRAW: 'withdraw'
})

export const SYNC_PR_REASON = Object.freeze({
  CONTAINS_BASE: 'contains-base',
  DROPS_FORK_COMMITS: 'drops-fork-commits',
  UNMEASURED: 'dropped-count-unmeasured'
})

const UPSTREAM = 'stablyai/orca@main'

function parseCount(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) {
    return null
  }
  return Number.parseInt(value.trim(), 10)
}

/**
 * @param {object} input
 * @param {string|number} input.behind new upstream commits ahead of the base branch
 * @param {string|number} input.dropped base-branch commits absent from the pushed
 *   sync branch — `git rev-list --count <sync>..origin/<base>`
 * @param {boolean} input.conflicts the merge conflicted, so the branch was reset
 * @param {string} input.base fork branch the sync targets
 * @param {string} input.syncBranch branch the workflow pushed
 * @returns {{action: string, reason: string, mergeable: boolean, measured: boolean,
 *   dropped: number|null, headline: string, title: string}}
 */
export function decideSyncPr({ behind, dropped, conflicts, base, syncBranch }) {
  const droppedCount = parseCount(dropped)
  const behindCount = parseCount(behind)
  const title = `chore: sync ${behindCount ?? behind} commit(s) from upstream ${UPSTREAM}`

  // Fail closed: an unreadable count is not evidence the branch is safe.
  if (droppedCount === null) {
    return {
      action: SYNC_PR_ACTION.WITHDRAW,
      reason: SYNC_PR_REASON.UNMEASURED,
      mergeable: false,
      measured: false,
      dropped: null,
      headline: `cannot tell whether merging \`${syncBranch}\` would drop \`${base}\` commits — refusing to open a PR`,
      title
    }
  }

  if (droppedCount > 0) {
    return {
      action: SYNC_PR_ACTION.WITHDRAW,
      reason: SYNC_PR_REASON.DROPS_FORK_COMMITS,
      mergeable: false,
      measured: true,
      dropped: droppedCount,
      headline: `\`${syncBranch}\` mirrors upstream: merging it would delete ${droppedCount} commit(s) from \`${base}\``,
      title
    }
  }

  return {
    action: SYNC_PR_ACTION.OPEN,
    reason: SYNC_PR_REASON.CONTAINS_BASE,
    mergeable: true,
    measured: true,
    dropped: 0,
    headline: conflicts
      ? `\`${syncBranch}\` fast-forwards \`${base}\` — no fork commit is dropped`
      : `\`${syncBranch}\` merges \`${base}\` with upstream — no fork commit is dropped`,
    title
  }
}

function renderWorkflowDiscard({ workflowCommits, workflowDiscard }) {
  if (!workflowDiscard || workflowDiscard.trim() === '') {
    return []
  }
  return [
    `<details><summary>Workflow changes this branch does <b>not</b> carry (${workflowCommits} upstream commit(s) touched \`.github/workflows\`)</summary>`,
    '',
    'Diffstat of the retention commit: **deletions are upstream workflow content this branch drops**, insertions are the fork\'s own workflows being restored. `GITHUB_TOKEN` cannot push workflow changes, so adopt any upstream workflow change deliberately, in a separate reviewed PR.',
    '',
    '```',
    workflowDiscard.trimEnd(),
    '```',
    '</details>',
    ''
  ]
}

/**
 * The PR body when the branch is proposable, and the closing comment when it is
 * not — both explain the same measurement, so a reader never has to infer it.
 *
 * @param {ReturnType<typeof decideSyncPr>} decision
 * @param {object} context
 * @param {string|number} context.behind
 * @param {string} context.base
 * @param {string} context.syncBranch
 * @param {string|number} [context.workflowCommits]
 * @param {string} [context.workflowDiscard]
 * @returns {string}
 */
export function renderSyncPrBody(decision, context) {
  const { behind, base, syncBranch } = context
  const lines = [
    `Automated sync of **${behind}** new commit(s) from \`${UPSTREAM}\` into \`${base}\`.`,
    ''
  ]

  if (decision.action === SYNC_PR_ACTION.OPEN) {
    lines.push(
      `✅ No commit on \`${base}\` is missing from this branch. Use a **merge commit** (not squash) to preserve upstream history.`,
      ''
    )
  } else if (decision.reason === SYNC_PR_REASON.DROPS_FORK_COMMITS) {
    lines.push(
      `## ⛔ Do not merge — this branch is a mirror of upstream, not a merge`,
      '',
      `\`${syncBranch}\` is missing **${decision.dropped} commit(s)** that exist on \`${base}\`. Merging it reverts them.`,
      '',
      `The sync attempts a real merge first; when that conflicts it resets the branch to upstream's tip, so what got pushed is a readable snapshot of upstream and nothing more. No pull request is opened from it, and any open one is closed.`,
      '',
      `To take these upstream commits, merge them in reviewed chunks from a branch that keeps \`${base}\` in its history.`,
      ''
    )
  } else {
    lines.push(
      `## ⛔ Do not merge — the safety check could not run`,
      '',
      `The number of \`${base}\` commits absent from \`${syncBranch}\` could not be read, so whether merging deletes fork history is unknown. No pull request is opened until it can be measured.`,
      ''
    )
  }

  lines.push(...renderWorkflowDiscard(context))
  return lines.join('\n')
}
