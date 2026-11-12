import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}))

const { systemDefaultLoginText } = await import('./system-default-login-text')

const locale = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, '../../i18n/locales', `${name}.json`), 'utf8'))
const accountsPaneKeys = (name: string): Record<string, string> =>
  (
    ((locale(name).auto as Record<string, unknown>).components as Record<string, unknown>)
      .settings as Record<string, Record<string, string>>
  ).AccountsPane

// ORCA-1039: the row read 'Use your current this device Claude login.'
describe('systemDefaultLoginText', () => {
  it('reads naturally for this device and for a named host', () => {
    expect(systemDefaultLoginText('claude', 'this device')).toBe(
      'Use the Claude login on this device.'
    )
    expect(systemDefaultLoginText('codex', 'm1')).toBe('Use the Codex login on m1.')
  })

  it('has a Spanish sentence that reads naturally with the Spanish device label', () => {
    const es = accountsPaneKeys('es')
    const fill = (text: string, value0: string) => text.replace('{{value0}}', value0)
    expect(fill(es.claudeSystemDefaultLogin, 'este dispositivo')).toBe(
      'Usa el inicio de sesión de Claude en este dispositivo.'
    )
    expect(fill(es.codexSystemDefaultLogin, 'm1')).toBe('Usa el inicio de sesión de Codex en m1.')
  })
})
