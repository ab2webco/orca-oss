import { describe, expect, it, vi } from 'vitest'
import { freshLeadAccountActionsOf, freshLeadConfirmOf } from './fresh-lead-steps'

vi.mock('lucide-react-native', () => ({ Crown: 'Crown', User: 'User', X: 'X' }))

const ACCOUNTS = {
  accounts: [
    { id: 'a-1', email: 'maya@acme.dev', usedPercent: 42, weeklyPercent: 64 },
    { id: 'a-2', email: 'leo@acme.dev', usedPercent: null, weeklyPercent: null }
  ],
  defaultId: 'a-1'
}

describe('freshLeadAccountActionsOf', () => {
  it("lists each account on the lead's desktop with its 5 h and 7 d use, then System default", () => {
    const onPick = vi.fn()
    const actions = freshLeadAccountActionsOf({ status: 'ready', value: ACCOUNTS }, 'm1', onPick)

    expect(actions.map((a) => [a.label, a.hint])).toEqual([
      ['maya@acme.dev', 'm1 · 5 h 42% · 7 d 64%'],
      ['leo@acme.dev', 'm1'],
      ['System default', "Use the agent's own login"]
    ])
    actions[0].onPress()
    expect(onPick).toHaveBeenLastCalledWith({ id: 'a-1', email: 'maya@acme.dev' })
    actions[2].onPress()
    expect(onPick).toHaveBeenLastCalledWith({ id: null, email: null })
    // Why: iOS cannot present the confirm sheet until this one has unmounted.
    expect(actions.every((a) => a.closeBeforePress)).toBe(true)
  })

  it('holds a reading row while accounts load, with System default still usable', () => {
    const actions = freshLeadAccountActionsOf({ status: 'loading' }, 'm1', vi.fn())

    expect(actions[0]).toMatchObject({ label: 'Reading accounts…', disabled: true, loading: true })
    expect(actions[1]).toMatchObject({ label: 'System default' })
    expect(actions[1].disabled).toBeFalsy()
  })

  it('offers System default only with no managed accounts or a failed read', () => {
    const none = freshLeadAccountActionsOf(
      { status: 'ready', value: { accounts: [], defaultId: null } },
      'm1',
      vi.fn()
    )
    const failed = freshLeadAccountActionsOf({ status: 'failed' }, 'm1', vi.fn())

    expect(none.map((a) => a.label)).toEqual(['System default'])
    expect(failed.map((a) => a.label)).toEqual(['System default'])
  })
})

describe('freshLeadConfirmOf', () => {
  it('names the account and desktop the lead starts on', () => {
    const onStart = vi.fn()
    const onCancel = vi.fn()
    const confirm = freshLeadConfirmOf(
      { id: 'a-1', email: 'maya@acme.dev' },
      'm1',
      onStart,
      onCancel
    )

    expect(confirm.title).toBe('Start a fresh lead?')
    expect(confirm.actions.map((a) => [a.label, a.hint])).toEqual([
      ['Start', 'Lead on maya@acme.dev · m1'],
      ['Cancel', undefined]
    ])
    expect(confirm.actions[0].closeBeforePress).toBe(true)
    confirm.actions[0].onPress()
    expect(onStart).toHaveBeenCalled()
    confirm.actions[1].onPress()
    expect(onCancel).toHaveBeenCalled()
  })

  it("names the agent's own login for System default", () => {
    const confirm = freshLeadConfirmOf({ id: null, email: null }, 'm1', vi.fn(), vi.fn())

    expect(confirm.actions[0].hint).toBe("Lead on the agent's own login · m1")
  })
})
