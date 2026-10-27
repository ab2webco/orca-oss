import type { CommandHandler } from '../dispatch'
import { getDefaultUserDataPath } from '../runtime/metadata'
import { runNodeProcess, runSonarCommand } from '../sonar-command'

export const SONAR_HANDLERS: Record<string, CommandHandler> = {
  sonar: async ({ rawArgs }) => {
    process.exitCode = await runSonarCommand(rawArgs ?? [], {
      userDataDir: getDefaultUserDataPath(),
      run: runNodeProcess
    })
  }
}
