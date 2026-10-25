import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import {
  ORCHESTRATOR_GAME_ARCADE_MAX_BYTES,
  orchestratorGameArcadeIssues
} from '../../shared/orchestrator-game-arcade-file'

function writeStdout(value: string): void {
  process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
}

async function issuesOfFile(file: string): Promise<string[]> {
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) {
    return ['not found']
  }
  // Why before reading: a huge file is refused without loading it.
  if (info.size > ORCHESTRATOR_GAME_ARCADE_MAX_BYTES) {
    return [`larger than ${ORCHESTRATOR_GAME_ARCADE_MAX_BYTES / 1024} KB`]
  }
  return orchestratorGameArcadeIssues(await readFile(file, 'utf8'))
}

export const ORCHESTRATOR_GAME_ARCADE_HANDLERS: Record<string, CommandHandler> = {
  'game game validate': async ({ flags, cwd, json }) => {
    const path = getRequiredStringFlag(flags, 'file')
    const issues = await issuesOfFile(resolve(cwd, path))
    if (issues.length > 0) {
      process.exitCode = 1
    }
    writeStdout(
      json
        ? JSON.stringify({ file: path, valid: issues.length === 0, issues }, null, 2)
        : issues.length === 0
          ? `${path}: valid — the arcade will play it`
          : [`${path}: ${issues.length} problem(s)`, ...issues.map((one) => `  ${one}`)].join('\n')
    )
  }
}
