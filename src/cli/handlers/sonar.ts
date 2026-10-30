import type { CommandHandler } from '../dispatch'
import { getDefaultUserDataPath } from '../runtime/metadata'
import { runNodeProcess, runSonarCommand, type SonarPluginListEntry } from '../sonar-command'

export const SONAR_HANDLERS: Record<string, CommandHandler> = {
  sonar: async ({ client, rawArgs }) => {
    process.exitCode = await runSonarCommand(rawArgs ?? [], {
      userDataDir: getDefaultUserDataPath(),
      run: runNodeProcess,
      remote: client.isRemote,
      listPlugins: async () => (await client.call<SonarPluginListEntry[]>('plugins.list')).result
    })
  }
}
