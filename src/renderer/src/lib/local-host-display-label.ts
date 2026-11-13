import {
  getExecutionHostLabel,
  parseExecutionHostId,
  type ExecutionHostScope
} from '../../../shared/execution-host'
import {
  buildExecutionHostRegistry,
  type ExecutionHostRegistryEntry
} from '../../../shared/execution-host-registry'
import { translate } from '@/i18n/i18n'

// Why one renderer module (ORCA-1149): the desktop names its own machine 'This computer'
// everywhere it shows a host. The shared helpers keep 'Local Mac' etc. because the mobile
// client labels the paired desktop with them, and on a phone 'This computer' would be false.
export function localHostDisplayLabel(): string {
  return translate('components.executionHost.thisComputer', 'This computer')
}

// Why the platform: with the label no longer naming it, the detail keeps that information.
export function localHostPlatformDetail(): string {
  const agent = globalThis.navigator?.userAgent ?? ''
  if (/Windows/i.test(agent)) {
    return 'Windows'
  }
  if (/Mac/i.test(agent)) {
    return 'macOS'
  }
  return /Linux|X11/i.test(agent) ? 'Linux' : ''
}

export function hostDisplayLabel(scope: ExecutionHostScope): string {
  return parseExecutionHostId(scope)?.kind === 'local'
    ? localHostDisplayLabel()
    : getExecutionHostLabel(scope)
}

export function buildHostDisplayRegistry(
  args: Parameters<typeof buildExecutionHostRegistry>[0]
): ExecutionHostRegistryEntry[] {
  return buildExecutionHostRegistry({
    ...args,
    localLabel: args.localLabel ?? localHostDisplayLabel(),
    localDetail: localHostPlatformDetail()
  })
}
