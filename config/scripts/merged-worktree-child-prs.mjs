// Why: GitHub closes every open PR whose base branch is deleted, so the closer moves them first.

/**
 * Retargets the open PRs based on `branch` to `base`. `gh(args)` runs the GitHub CLI and returns
 * `{ ok, stdout, stderr }`. `ok: false` carries the note naming the PR that blocks the deletion.
 */
export function retargetChildPrs({ gh, slug, branch, base }) {
  const listed = gh([
    'pr',
    'list',
    '-R',
    slug,
    '--base',
    branch,
    '--state',
    'open',
    '--limit',
    '500',
    '--json',
    'number'
  ])
  if (!listed.ok) {
    return blocked(`could not list PRs based on it (${reason(listed)})`)
  }
  const numbers = openNumbers(listed.stdout)
  if (!numbers) {
    return blocked('could not list PRs based on it (no PR list)')
  }
  const retargeted = []
  for (const number of numbers) {
    if (!base) {
      return blocked(`open PR #${number} is based on it and the merged PR's base is unknown`)
    }
    const edited = gh(['pr', 'edit', String(number), '-R', slug, '--base', base])
    if (!edited.ok) {
      return blocked(`could not retarget open PR #${number} to ${base}: ${reason(edited)}`)
    }
    retargeted.push(`retargeted #${number} to ${base}`)
  }
  return { ok: true, retargeted }
}

function blocked(message) {
  return { ok: false, note: `remote branch kept: ${message}` }
}

function reason(result) {
  return result.stderr.replace(/\s+/g, ' ').trim().slice(0, 200)
}

function openNumbers(stdout) {
  try {
    const prs = JSON.parse(stdout)
    return Array.isArray(prs) ? prs.map((pr) => pr.number) : null
  } catch {
    return null
  }
}
