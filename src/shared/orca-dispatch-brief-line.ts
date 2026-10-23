// Why: a dispatched member gets this one line instead of the multi-KB preamble; the
// preamble itself waits in a file inside the member's worktree (ORCA-757).

export const DISPATCH_BRIEF_DIR = '.orca/briefs'
export const DISPATCH_BRIEF_LINE_PREFIX = 'Read your Orca Lab brief at '

const DISPATCH_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const BRIEF_LINE_PATTERN = /^Read your Orca Lab brief at (\S+) \(task (\S+)\) and follow it\.$/

export function dispatchBriefRelativePathOf(dispatchId: string): string {
  if (!DISPATCH_ID_PATTERN.test(dispatchId)) {
    throw new Error(`dispatch id is not a plain file name: ${dispatchId}`)
  }
  return `${DISPATCH_BRIEF_DIR}/${dispatchId}.md`
}

export function dispatchBriefLineOf(args: { dispatchId: string; taskId: string }): string {
  return `${DISPATCH_BRIEF_LINE_PREFIX}${dispatchBriefRelativePathOf(args.dispatchId)} (task ${args.taskId}) and follow it.`
}

// Why: status updates call this with paste-sized prompts; the line is far shorter.
const BRIEF_LINE_MAX_LENGTH = 512

export function parseDispatchBriefLine(text: string): { path: string; taskId: string } | null {
  if (text.length > BRIEF_LINE_MAX_LENGTH) {
    return null
  }
  const match = BRIEF_LINE_PATTERN.exec(text.trim())
  return match ? { path: match[1], taskId: match[2] } : null
}
