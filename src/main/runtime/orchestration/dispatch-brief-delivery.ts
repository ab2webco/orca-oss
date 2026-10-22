import path from 'node:path'
import { isWindowsAbsolutePathLike } from '../../../shared/cross-platform-path'
import { dispatchBriefLineOf } from '../../../shared/orca-dispatch-brief-line'
import {
  localDispatchBriefHost,
  writeDispatchBrief,
  type DispatchBriefHost
} from './dispatch-brief-file'

/** The workspace a worker's terminal starts in, and the SSH connection it runs on. */
export type DispatchBriefTarget = { path: string; connectionId: string | null }

/** What to type into the worker: one line naming its brief, or the full preamble when the brief cannot be written. */
export async function dispatchInputOf(args: {
  preamble: string
  dispatchId: string
  taskId: string
  target: DispatchBriefTarget | null
  sshHostOf: (connectionId: string) => DispatchBriefHost | null
}): Promise<{ text: string; briefPath: string | null }> {
  const fullPreamble = { text: args.preamble, briefPath: null }
  const target = args.target
  if (!target) {
    return fullPreamble
  }
  const host = target.connectionId ? args.sshHostOf(target.connectionId) : localDispatchBriefHost
  if (!host) {
    return fullPreamble
  }
  try {
    const briefPath = await writeDispatchBrief(host, {
      worktreePath: target.path,
      dispatchId: args.dispatchId,
      preamble: args.preamble,
      // Why: a remote path follows its own host's separators, not this machine's.
      joinPath: !target.connectionId
        ? path.join
        : isWindowsAbsolutePathLike(target.path)
          ? path.win32.join
          : path.posix.join
    })
    return {
      text: dispatchBriefLineOf({ dispatchId: args.dispatchId, taskId: args.taskId }),
      briefPath
    }
  } catch {
    return fullPreamble
  }
}
