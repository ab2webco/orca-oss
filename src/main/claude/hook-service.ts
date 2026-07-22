import { existsSync, rmSync, writeFileSync } from 'node:fs'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import {
  isPlainObject,
  readHooksJson,
  writeHooksJson,
  writeManagedScript,
  type HooksConfig
} from '../agent-hooks/installer-utils'
import {
  readHooksJsonRemote,
  writeHooksJsonRemote,
  writeManagedScriptRemote
} from '../agent-hooks/installer-utils-remote'
import { getManagedScript } from './managed-hook-script'
import { getManagedStatusLineScript } from './statusline-script'
import {
  applyManagedHooks,
  applyManagedStatusLine,
  CLAUDE_EVENTS,
  CLAUDE_HOOK_SETTINGS,
  getManagedScriptFileName,
  getConfigPath,
  getManagedCommand,
  getManagedScriptPath,
  getPosixManagedScriptFileName,
  getRemoteConfigPath,
  getRemoteManagedCommand,
  getStatusLineInstallMarkerPath,
  getStatusLineScriptFileName,
  getStatusLineScriptPath,
  getStatusLineSlotState,
  removeManagedHooks,
  removeManagedStatusLine,
  type ClaudeCompatibleHookSettings
} from './hook-settings'

type ClaudeHookServiceOptions = {
  agent: AgentHookInstallStatus['agent']
  displayName: string
  settings: ClaudeCompatibleHookSettings
}

const DEFAULT_CLAUDE_HOOK_SERVICE_OPTIONS: ClaudeHookServiceOptions = {
  agent: 'claude',
  displayName: 'Claude',
  settings: CLAUDE_HOOK_SETTINGS
}

export class ClaudeHookService {
  private readonly options: ClaudeHookServiceOptions

  constructor(options: ClaudeHookServiceOptions = DEFAULT_CLAUDE_HOOK_SERVICE_OPTIONS) {
    this.options = options
  }

  getStatus(): AgentHookInstallStatus {
    const configPath = getConfigPath(this.options.settings)
    const scriptPath = getManagedScriptPath(this.options.settings)
    const config = readHooksJson(configPath)
    if (!config) {
      return {
        agent: this.options.agent,
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: `Could not parse ${this.options.displayName} settings.json`
      }
    }

    // Why: report `partial` when only some events are registered so the sidebar shows a degraded install, not a false-positive `installed`.
    const command = getManagedCommand(scriptPath)
    const missing: string[] = []
    let presentCount = 0
    for (const event of CLAUDE_EVENTS) {
      const definitions = Array.isArray(config.hooks?.[event.eventName])
        ? config.hooks![event.eventName]!
        : []
      const hasCommand = definitions.some((definition) =>
        (definition.hooks ?? []).some((hook) => hook.command === command)
      )
      if (hasCommand) {
        presentCount += 1
      } else {
        missing.push(event.eventName)
      }
    }
    const managedHooksPresent = presentCount > 0
    let state: AgentHookInstallState
    let detail: string | null
    if (missing.length === 0) {
      state = 'installed'
      detail = null
    } else if (presentCount === 0) {
      state = 'not_installed'
      detail = null
    } else {
      state = 'partial'
      detail = `Managed hook missing for events: ${missing.join(', ')}`
    }
    return { agent: this.options.agent, state, configPath, managedHooksPresent, detail }
  }

  install(): AgentHookInstallStatus {
    const configPath = getConfigPath(this.options.settings)
    const scriptPath = getManagedScriptPath(this.options.settings)
    const config = readHooksJson(configPath)
    if (!config) {
      return {
        agent: this.options.agent,
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: `Could not parse ${this.options.displayName} settings.json`
      }
    }

    const command = getManagedCommand(scriptPath)
    let nextConfig = applyManagedHooks(
      config,
      command,
      getManagedScriptFileName(this.options.settings)
    )
    writeManagedScript(
      scriptPath,
      getManagedScript('local', { skipWhenDevinImportsClaude: this.options.agent === 'claude' })
    )
    // Why: the statusline usage feed is Claude-only — OpenClaude data would be misattributed to the Claude provider.
    if (this.options.agent === 'claude') {
      nextConfig = this.installManagedStatusLine(nextConfig)
    }
    writeHooksJson(configPath, nextConfig)
    return this.getStatus()
  }

  // Why: a worktree pinned to a managed account launches Claude with CLAUDE_CONFIG_DIR
  // pointed at that account's isolated vault, so the shared ~/.claude hook + statusLine
  // never apply. Merge the SAME managed instrumentation (script paths, wrapped command,
  // event set) into the vault's settings.json so pinned sessions report status and usage.
  // Given the vault's current settings.json text (or null when absent), returns the text
  // to persist, or null when it is already current or the existing content is unparseable
  // (never clobber unknown vault content — it may hold a custom-endpoint token). The caller
  // owns the mode-600, ownership-checked write.
  ensureInjectedVaultInstrumentation(currentSettingsJson: string | null): string | null {
    const config = this.parseVaultConfig(currentSettingsJson)
    if (!config) {
      return null
    }
    const scriptPath = getManagedScriptPath(this.options.settings)
    writeManagedScript(
      scriptPath,
      getManagedScript('local', { skipWhenDevinImportsClaude: this.options.agent === 'claude' })
    )
    let nextConfig = applyManagedHooks(
      config,
      getManagedCommand(scriptPath),
      getManagedScriptFileName(this.options.settings)
    )
    // Why: the statusline usage feed is Claude-only — OpenClaude data would be misattributed.
    if (this.options.agent === 'claude') {
      const statusLineScriptPath = getStatusLineScriptPath(this.options.settings)
      writeManagedScript(statusLineScriptPath, getManagedStatusLineScript('local'))
      nextConfig = applyManagedStatusLine(
        nextConfig,
        getManagedCommand(statusLineScriptPath),
        getStatusLineScriptFileName(this.options.settings)
      )
    }
    // Why: skip the write when merging changed nothing, so a stable vault settings.json is
    // never needlessly rewritten and its existing formatting/key order stays intact.
    if (JSON.stringify(nextConfig) === JSON.stringify(config)) {
      return null
    }
    return `${JSON.stringify(nextConfig, null, 2)}\n`
  }

  private parseVaultConfig(currentSettingsJson: string | null): HooksConfig | null {
    if (currentSettingsJson === null) {
      return {}
    }
    try {
      const parsed: unknown = JSON.parse(currentSettingsJson)
      return isPlainObject(parsed) ? (parsed as HooksConfig) : null
    } catch {
      return null
    }
  }

  // Why: the statusline feed is opportunistic (usage display, not agent status); a user who deleted the
  // managed entry has opted out, and the marker distinguishes that deletion from a first install.
  private installManagedStatusLine(config: HooksConfig): HooksConfig {
    const scriptFileName = getStatusLineScriptFileName(this.options.settings)
    const markerPath = getStatusLineInstallMarkerPath(this.options.settings)
    const slot = getStatusLineSlotState(config, scriptFileName)
    if (slot === 'user' || (slot === 'empty' && existsSync(markerPath))) {
      return config
    }
    const statusLineScriptPath = getStatusLineScriptPath(this.options.settings)
    writeManagedScript(statusLineScriptPath, getManagedStatusLineScript('local'))
    const next = applyManagedStatusLine(
      config,
      getManagedCommand(statusLineScriptPath),
      scriptFileName
    )
    try {
      writeFileSync(markerPath, '')
    } catch {
      // Best-effort: a missing marker only means one future user deletion gets re-installed once.
    }
    return next
  }

  // Why: install the Claude hook on the remote box (via SFTP); POSIX-only by design (Windows-remote deferred).
  async installRemote(sftp: SFTPWrapper, remoteHome: string): Promise<AgentHookInstallStatus> {
    // Why: remote-Windows is out of scope; ship POSIX paths. process.platform here is the local box, not the remote, so it can't gate this.
    const remoteConfigPath = getRemoteConfigPath(remoteHome, this.options.settings)
    const remoteScriptFileName = getPosixManagedScriptFileName(this.options.settings)
    const remoteScriptPath = `${remoteHome.replace(/\/$/, '')}/.orca/agent-hooks/${remoteScriptFileName}`
    // Why: SFTP I/O fails often (network/EACCES/disk); wrap install so transient failures surface as structured state:'error' rather than an unhandled rejection.
    try {
      const config = await readHooksJsonRemote(sftp, remoteConfigPath)
      if (!config) {
        return {
          agent: this.options.agent,
          state: 'error',
          configPath: remoteConfigPath,
          managedHooksPresent: false,
          detail: `Could not parse remote ${this.options.displayName} settings.json`
        }
      }

      // Why: the POSIX wrapper is identical regardless of where the script lands; only the path differs.
      const command = getRemoteManagedCommand(remoteScriptPath)
      const nextConfig = applyManagedHooks(config, command, remoteScriptFileName)

      // Why: write script before settings — a mid-install failure then leaves a harmless orphan script, not settings.json pointing at a missing one.
      // Why: SSH remotes use POSIX `.sh` paths even when Orca runs on Windows; never derive remote script syntax from the local OS.
      await writeManagedScriptRemote(
        sftp,
        remoteScriptPath,
        getManagedScript('posix', { skipWhenDevinImportsClaude: this.options.agent === 'claude' })
      )
      // Why: no statusline install here — this path serves SSH remotes and WSL guests, whose relay hook
      // listener doesn't route /statusline/claude, and an SSH box's Claude login can be a different
      // account than the locally selected one, so its usage must not feed the local bar (live feed is host-local only).
      await writeHooksJsonRemote(sftp, remoteConfigPath, nextConfig)

      return {
        agent: this.options.agent,
        state: 'installed',
        configPath: remoteConfigPath,
        managedHooksPresent: true,
        detail: null
      }
    } catch (err) {
      return {
        agent: this.options.agent,
        state: 'error',
        configPath: remoteConfigPath,
        managedHooksPresent: false,
        detail: err instanceof Error ? err.message : String(err)
      }
    }
  }

  remove(): AgentHookInstallStatus {
    const configPath = getConfigPath(this.options.settings)
    const config = readHooksJson(configPath)
    if (!config) {
      return {
        agent: this.options.agent,
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: `Could not parse ${this.options.displayName} settings.json`
      }
    }
    const { config: hooksRemoved, changed: hooksChanged } = removeManagedHooks(
      config,
      getManagedScriptFileName(this.options.settings)
    )
    const { config: nextConfig, changed: statusLineChanged } = removeManagedStatusLine(
      hooksRemoved,
      getStatusLineScriptFileName(this.options.settings)
    )
    if (hooksChanged || statusLineChanged) {
      writeHooksJson(configPath, nextConfig)
    }
    if (this.options.agent === 'claude') {
      try {
        // Why: an Orca-level uninstall resets the opt-out memory so a later re-enable installs the statusline again.
        rmSync(getStatusLineInstallMarkerPath(this.options.settings), { force: true })
      } catch {
        // ignore — marker cleanup is best-effort
      }
    }
    return this.getStatus()
  }
}

export const claudeHookService = new ClaudeHookService()
