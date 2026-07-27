import { join } from 'node:path'
import type { ClaudeManagedAccount } from '../../shared/types'
import { buildEncodedWslBashCommand } from '../wsl-bash-command'
import { readManagedClaudeKeychainCredentials } from './keychain'
import {
  getClaudeManagedAccountsRoot,
  readClaudeManagedAuthFile,
  resolveOwnedClaudeManagedAuthPath
} from './managed-auth-path'

let managedAccountsSource: () => readonly ClaudeManagedAccount[] = () => []

type ManagedRefreshCredentialDependencies = {
  accounts?: readonly ClaudeManagedAccount[]
  platform?: NodeJS.Platform
  readWslCredentials?: (
    distro: string,
    linuxAuthPath: string,
    accountId: string
  ) => Promise<string | null>
}

export function configureManagedClaudeRefreshAccounts(
  source: () => readonly ClaudeManagedAccount[]
): void {
  managedAccountsSource = source
}

export function getManagedClaudeRefreshAccounts(): readonly ClaudeManagedAccount[] {
  return managedAccountsSource()
}

export async function readManagedClaudeRefreshCredentials(
  accountId: string,
  dependencies: ManagedRefreshCredentialDependencies = {}
): Promise<string | null> {
  const account = (dependencies.accounts ?? managedAccountsSource()).find(
    (candidate) => candidate.id === accountId
  )
  if (account?.managedAuthRuntime === 'wsl') {
    if (
      (dependencies.platform ?? process.platform) !== 'win32' ||
      !account.wslDistro ||
      !account.wslLinuxAuthPath
    ) {
      return null
    }
    return (dependencies.readWslCredentials ?? readWslCredentials)(
      account.wslDistro,
      account.wslLinuxAuthPath,
      accountId
    )
  }
  const candidatePath = join(getClaudeManagedAccountsRoot(), accountId, 'auth')
  const managedAuthPath = resolveOwnedClaudeManagedAuthPath(accountId, candidatePath)
  if (!managedAuthPath) {
    return null
  }
  if (process.platform === 'darwin') {
    return readManagedClaudeKeychainCredentials(accountId)
  }
  return readClaudeManagedAuthFile(managedAuthPath, '.credentials.json')
}

async function readWslCredentials(
  distro: string,
  linuxAuthPath: string,
  accountId: string
): Promise<string | null> {
  if (!isExpectedWslManagedAuthPath(linuxAuthPath, accountId)) {
    return null
  }
  try {
    const { execFile } = await import('node:child_process')
    const script = [
      'set -euo pipefail',
      `candidate=${shellQuote(linuxAuthPath)}`,
      'managed_root="${HOME%/}/.local/share/orca/claude-accounts"',
      'candidate_real=$(readlink -f -- "$candidate")',
      'managed_root_real=$(readlink -f -- "$managed_root")',
      'test -f "$candidate_real/.orca-managed-claude-auth"',
      `test "$(cat "$candidate_real/.orca-managed-claude-auth")" = ${shellQuote(accountId)}`,
      'case "$candidate_real" in "$managed_root_real"/*/auth) ;; *) exit 35 ;; esac',
      'cat -- "$candidate_real/.credentials.json"'
    ].join('\n')
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'wsl.exe',
        ['-d', distro, '--', 'bash', '-lc', buildEncodedWslBashCommand(script)],
        { encoding: 'utf8', timeout: 5_000, maxBuffer: 2 * 1024 * 1024 },
        (error, output) => {
          if (error) {
            reject(error)
          } else {
            resolve(output)
          }
        }
      )
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function isExpectedWslManagedAuthPath(linuxAuthPath: string, accountId: string): boolean {
  const suffix = `/.local/share/orca/claude-accounts/${accountId}/auth`
  return linuxAuthPath.startsWith('/') && linuxAuthPath.endsWith(suffix)
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
