import { translate } from '@/i18n/i18n'

/** The System default row's line: the login it uses and where, e.g. "Use the Claude login on this device." */
export function systemDefaultLoginText(provider: 'claude' | 'codex', runtimeLabel: string): string {
  return provider === 'claude'
    ? translate(
        'auto.components.settings.AccountsPane.claudeSystemDefaultLogin',
        'Use the Claude login on {{value0}}.',
        { value0: runtimeLabel }
      )
    : translate(
        'auto.components.settings.AccountsPane.codexSystemDefaultLogin',
        'Use the Codex login on {{value0}}.',
        { value0: runtimeLabel }
      )
}
