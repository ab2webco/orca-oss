import { afterEach, describe, expect, it } from 'vitest'
import type { MacCapturedDigitChord } from '../../../../shared/macos-symbolic-hotkeys'
import { i18n, translate } from '@/i18n/i18n'
import { PSEUDO_LOCALIZATION_LOCALE } from '@/i18n/pseudo-localization'
import { buildShortcutDefinitionCatalog } from './shortcut-definition-catalog'

function chord(digit: number): MacCapturedDigitChord {
  return { digit, meta: false, control: true, alt: false, shift: false }
}

function warningFor(chords: readonly MacCapturedDigitChord[]): string | undefined {
  return buildShortcutDefinitionCatalog({
    disabledTuiAgents: [],
    pluginCommands: [],
    keybindings: {},
    platform: 'darwin',
    macCapturedDigitChords: chords,
    missionControlConflictMessage: translate(
      'auto.components.settings.shortcutDefinitionCatalog.missionControlConflict',
      'Blocked by Mission Control. Remap here or change it in System Settings.'
    )
  }).conflictByAction.get('tab.selectByIndex')?.[0]
}

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('Mission Control shortcut warnings', () => {
  it('uses concise count-independent remediation copy', () => {
    expect(warningFor([chord(1), chord(2), chord(3), chord(4), chord(5), chord(6)])).toBe(
      'Blocked by Mission Control. Remap here or change it in System Settings.'
    )
  })

  it('passes through pseudo-localization', async () => {
    await i18n.changeLanguage(PSEUDO_LOCALIZATION_LOCALE)

    expect(warningFor([chord(1)])).toBe(
      '[Blocked by Mission Control. Remap here or change it in System Settings.]'
    )
  })

  it.each([
    ['es', 'Bloqueado por Mission Control. Reasigna aquí o cámbialo en Ajustes del Sistema.']
  ])('uses the shipped %s translation', async (locale, expected) => {
    await i18n.changeLanguage(locale)

    expect(warningFor([chord(1)])).toBe(expected)
  })
})
