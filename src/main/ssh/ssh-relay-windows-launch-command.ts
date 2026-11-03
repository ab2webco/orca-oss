import { quoteWithBackslashEscapes } from '../../shared/backslash-escaped-quote'
import { commandWithNodePath } from './ssh-remote-commands'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { powerShellLiteral } from './ssh-remote-powershell'

export function windowsRelayLaunchCommand(
  hostPlatform: RemoteHostPlatform,
  nodePath: string,
  remoteDir: string,
  sockPath: string,
  endpointDir: string,
  graceTime: number,
  logFile: string,
  errFile: string,
  credentialFile: string
): string {
  const relayScript = joinRemotePath(hostPlatform, remoteDir, 'relay.js')
  // Why: Windows sshd kills the exec channel's process tree on close; WMI re-parents the detached relay to survive.
  const quoted = quoteWithBackslashEscapes
  const relayCommandLine = [
    quoted(nodePath),
    quoted(relayScript),
    '--detached',
    '--grace-time',
    String(graceTime),
    '--sock-path',
    quoted(sockPath),
    '--credential-file',
    quoted(credentialFile),
    '--endpoint-dir',
    quoted(endpointDir),
    // Why: --log-file owns rotation; shell redirects still capture pre-JS boot/crash output.
    '--log-file',
    quoted(logFile),
    `1>${quoted(logFile)}`,
    `2>${quoted(errFile)}`
  ].join(' ')
  const wmiCommandLine = `cmd.exe /d /s /c "${relayCommandLine}"`
  return commandWithNodePath(
    hostPlatform,
    nodePath,
    remoteDir,
    [
      `& icacls.exe ${powerShellLiteral(credentialFile)} /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null`,
      `$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${powerShellLiteral(wmiCommandLine)}; CurrentDirectory = ${powerShellLiteral(remoteDir)} }`,
      `if ($result.ReturnValue -ne 0) { throw "Win32_Process.Create failed with $($result.ReturnValue)" }`
    ].join('; ')
  )
}
