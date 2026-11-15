import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '../../i18n/i18n'
import { getDefaultUIState } from '../../../../shared/constants'
import { PROJECT_ORDER_MENU_OPTIONS, isProjectOrderOffDefault } from './project-order-menu-options'

describe('project order menu options (ORCA-1216 §5)', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('offers the four orders, Needs you first first as the default', () => {
    expect(PROJECT_ORDER_MENU_OPTIONS.map((option) => option.id)).toEqual([
      'needs-you',
      'recent',
      'name',
      'manual'
    ])
    expect(PROJECT_ORDER_MENU_OPTIONS[0].id).toBe(getDefaultUIState().projectOrderBy)
  })

  it('labels every option in English and Spanish', async () => {
    expect(PROJECT_ORDER_MENU_OPTIONS.map((option) => option.label)).toEqual([
      'Needs you first',
      'Recent activity',
      'Name',
      'Manual (drag)'
    ])
    await i18n.changeLanguage('es')
    expect(PROJECT_ORDER_MENU_OPTIONS.map((option) => option.label)).toEqual([
      'Te necesita primero',
      'Actividad reciente',
      'Nombre',
      'Manual (arrastrar)'
    ])
  })

  it('marks only a non-default order', () => {
    expect(isProjectOrderOffDefault('needs-you')).toBe(false)
    expect(isProjectOrderOffDefault('recent')).toBe(true)
    expect(isProjectOrderOffDefault('name')).toBe(true)
    expect(isProjectOrderOffDefault('manual')).toBe(true)
  })
})
