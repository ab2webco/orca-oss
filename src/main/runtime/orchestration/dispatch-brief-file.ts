import { mkdir, writeFile } from 'node:fs/promises'
import {
  DISPATCH_BRIEF_DIR,
  dispatchBriefRelativePathOf
} from '../../../shared/orca-dispatch-brief-line'

/** The two calls a brief needs; the SSH filesystem provider has both, and createDir is recursive. */
export type DispatchBriefHost = {
  createDir(dirPath: string): Promise<void>
  writeFile(filePath: string, content: string): Promise<void>
}

export const localDispatchBriefHost: DispatchBriefHost = {
  createDir: async (dirPath) => {
    await mkdir(dirPath, { recursive: true })
  },
  // Why 0600: the brief carries the dispatch capability.
  writeFile: (filePath, content) => writeFile(filePath, content, { mode: 0o600 })
}

/** Writes the preamble where the member's cwd can read it and returns that relative path. */
export async function writeDispatchBrief(
  host: DispatchBriefHost,
  args: {
    worktreePath: string
    dispatchId: string
    preamble: string
    joinPath: (...parts: string[]) => string
  }
): Promise<string> {
  const relativePath = dispatchBriefRelativePathOf(args.dispatchId)
  const dir = args.joinPath(args.worktreePath, DISPATCH_BRIEF_DIR)
  await host.createDir(dir)
  // Why its own ignore file: `.orca/` also holds tracked project files, and `*` hides this one too.
  await host.writeFile(args.joinPath(dir, '.gitignore'), '*\n')
  await host.writeFile(args.joinPath(args.worktreePath, relativePath), args.preamble)
  return relativePath
}
