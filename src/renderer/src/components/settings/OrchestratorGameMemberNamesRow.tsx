import { useState } from 'react'
import { parseGameLead } from '../../../../shared/orchestrator-game-lead'
import type { GameMemberName } from '../../../../shared/orchestrator-game-member-names'
import { Input } from '../ui/input'
import { SettingsRow } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

const namesText = (names: readonly GameMemberName[] | undefined): string =>
  (names ?? []).map((name) => (typeof name === 'string' ? name : name.en)).join(', ')

/** Member names typed as one comma-separated line; per-language names stay in orca.yaml. */
export function OrchestratorGameMemberNamesRow({
  stored,
  inherited,
  sourceLabel,
  onCommit
}: {
  stored: readonly GameMemberName[] | undefined
  inherited: readonly GameMemberName[] | undefined
  /** Where the effective names come from, as the lead's other rows say it. */
  sourceLabel: string
  onCommit: (value: GameMemberName[] | undefined) => void
}): React.JSX.Element {
  const storedText = namesText(stored)
  const [draft, setDraft] = useState(storedText)
  const [isInvalid, setIsInvalid] = useState(false)
  const label = translate(
    'auto.components.settings.OrchestratorGameMemberNamesRow.label',
    'Member names'
  )
  const sceneNames = translate(
    'auto.components.settings.OrchestratorGameMemberNamesRow.sceneNames',
    "The scene's names"
  )
  const effective = namesText(stored ?? inherited)
  const commit = (): void => {
    const text = draft.trim()
    if (text === storedText) {
      setIsInvalid(false)
      return
    }
    const names = text
      .split(',')
      .map((one) => one.trim())
      .filter((one) => one !== '')
    if (names.length === 0) {
      setIsInvalid(false)
      onCommit(undefined)
      return
    }
    const value = parseGameLead({ memberNames: names }).value?.memberNames
    setIsInvalid(value === undefined)
    if (value !== undefined) {
      onCommit(value)
    }
  }

  return (
    <SettingsRow
      label={label}
      description={
        <>
          {`${effective === '' ? sceneNames : effective} · ${sourceLabel}`}
          {isInvalid ? (
            <span role="alert" className="block text-destructive">
              {translate(
                'auto.components.settings.OrchestratorGameMemberNamesRow.invalid',
                'Use 1 to 24 names separated by commas, each up to 32 characters and none like a ticket id.'
              )}
            </span>
          ) : null}
        </>
      }
      control={
        <Input
          aria-label={label}
          aria-invalid={isInvalid}
          value={draft}
          placeholder={namesText(inherited) || sceneNames}
          spellCheck={false}
          className="h-8 w-56 max-w-full text-xs md:text-xs"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit()
            }
          }}
        />
      }
    />
  )
}
