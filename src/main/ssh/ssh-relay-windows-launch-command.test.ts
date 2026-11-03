import { describe, expect, it } from 'vitest'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { windowsRelayLaunchCommand } from './ssh-relay-windows-launch-command'

function launchScript(nodePath: string, endpointDir: string): string {
  const command = windowsRelayLaunchCommand(
    getRemoteHostPlatform('win32-x64'),
    nodePath,
    'C:/Users/me user/.orca-remote/relay-1',
    '\\\\.\\pipe\\orca-relay-1',
    endpointDir,
    300,
    'C:/Users/me user/.orca-remote/relay-1/relay.log',
    'C:/Users/me user/.orca-remote/relay-1/relay.err.log',
    'C:/Users/me user/.orca-remote/relay-1/relay.credential'
  )
  const encoded = /-EncodedCommand\s+([A-Za-z0-9+/=]+)/.exec(command)?.[1]
  return encoded ? Buffer.from(encoded, 'base64').toString('utf16le') : command
}

describe('windowsRelayLaunchCommand', () => {
  it('quotes each relay argument for cmd.exe without touching interior backslashes', () => {
    const script = launchScript('C:\\Program Files\\nodejs\\node.exe', 'C:/hooks dir')
    expect(script).toContain(
      `cmd.exe /d /s /c ""C:\\Program Files\\nodejs\\node.exe" "C:/Users/me user/.orca-remote/relay-1/relay.js" --detached`
    )
    expect(script).toContain('--endpoint-dir "C:/hooks dir" --log-file')
  })

  it('doubles a trailing backslash so the argument keeps its closing quote', () => {
    const script = launchScript('C:\\Program Files\\nodejs\\node.exe', 'C:\\hooks dir\\')
    expect(script).toContain('--endpoint-dir "C:\\hooks dir\\\\" --log-file')
  })
})
