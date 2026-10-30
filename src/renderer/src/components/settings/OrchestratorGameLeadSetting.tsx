import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  resolveOrchestratorGameLead,
  type OrchestratorGameLayer
} from '../../../../shared/orchestrator-game-config'
import { gameLeadSourceOf } from '../../../../shared/orchestrator-game-lead-source'
import {
  GAME_LEAD_CAP_MAX,
  parseGameLead,
  type OrchestratorGameLead
} from '../../../../shared/orchestrator-game-lead'
import { withOrchestratorGameProjectLead } from '../../../../shared/orchestrator-game-settings-updates'
import { Input } from '../ui/input'
import { OrchestratorGameMemberNamesRow } from './OrchestratorGameMemberNamesRow'
import {
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader
} from './SettingsFormControls'
import {
  orchestratorGameInheritLabel,
  orchestratorGameModeLabels,
  orchestratorGameSourceLabel
} from './orchestrator-game-setting-labels'
import { translate } from '@/i18n/i18n'
import { useGameHostProfile } from './use-game-host-profile'

type GameSettings = Pick<GlobalSettings, 'orchestratorGame' | 'orchestratorGameProjects'>
type LeadTextKey = 'cap' | 'label' | 'agent' | 'model' | 'effort'
type LeadField = { key: LeadTextKey; label: string; invalid: string }

const fields = (): LeadField[] => [
  {
    key: 'cap',
    label: translate('auto.components.settings.OrchestratorGameLeadSetting.cap', 'Member cap'),
    invalid: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.capInvalid',
      'Enter a whole number from 1 to {{value0}}.',
      { value0: GAME_LEAD_CAP_MAX }
    )
  },
  {
    key: 'label',
    label: translate('auto.components.settings.OrchestratorGameLeadSetting.label', 'Lead name'),
    invalid: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.labelInvalid',
      'Use 1 to 32 characters.'
    )
  },
  {
    key: 'agent',
    label: translate('auto.components.settings.OrchestratorGameLeadSetting.agent', 'Agent'),
    invalid: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.agentInvalid',
      'Use an agent id like claude or codex.'
    )
  },
  {
    key: 'model',
    label: translate('auto.components.settings.OrchestratorGameLeadSetting.model', 'Model'),
    invalid: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.modelInvalid',
      'Use a model id like opus.'
    )
  },
  {
    key: 'effort',
    label: translate('auto.components.settings.OrchestratorGameLeadSetting.effort', 'Effort'),
    invalid: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.effortInvalid',
      'Use an effort level like high.'
    )
  }
]

const notSet = (): string =>
  translate('auto.components.settings.OrchestratorGameLeadSetting.notSet', 'Not set')

// Why: a typed cap is text; anything but digits stays a string so the parser refuses it.
const rawOf = (key: LeadTextKey, text: string): string | number =>
  key === 'cap' && /^\d+$/.test(text) ? Number(text) : text

function LeadTextRow({
  field,
  stored,
  description,
  placeholder,
  onCommit
}: {
  field: LeadField
  stored: string
  description: string
  placeholder: string
  onCommit: (value: OrchestratorGameLead[LeadTextKey] | undefined) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(stored)
  const [isInvalid, setIsInvalid] = useState(false)
  const commit = (): void => {
    const text = draft.trim()
    if (text === stored) {
      setIsInvalid(false)
      return
    }
    if (text === '') {
      setIsInvalid(false)
      onCommit(undefined)
      return
    }
    const value = parseGameLead({ [field.key]: rawOf(field.key, text) }).value?.[field.key]
    setIsInvalid(value === undefined)
    if (value !== undefined) {
      onCommit(value)
    }
  }

  return (
    <SettingsRow
      label={field.label}
      description={
        <>
          {description}
          {isInvalid ? (
            <span role="alert" className="block text-destructive">
              {field.invalid}
            </span>
          ) : null}
        </>
      }
      control={
        <Input
          aria-label={field.label}
          aria-invalid={isInvalid}
          value={draft}
          placeholder={placeholder}
          inputMode={field.key === 'cap' ? 'numeric' : undefined}
          spellCheck={false}
          className="h-8 w-40 text-xs md:text-xs"
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

/** The project lead's overrides for this machine; launchPrompt, pushPrompt and rules stay in orca.yaml. */
export function ProjectOrchestratorGameLeadSetting({
  repoId,
  settings,
  projectLayer,
  updateSettings
}: {
  repoId: string
  settings: GameSettings
  projectLayer: OrchestratorGameLayer | undefined
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): React.JSX.Element {
  const local = settings.orchestratorGameProjects?.[repoId]
  const stored = local?.orchestrator
  const layers = { global: settings.orchestratorGame, project: projectLayer, local }
  // Why the host's snapshot: Orca's machine sets the cap no layer sets, as game.state does.
  const host = useGameHostProfile()
  const lead = resolveOrchestratorGameLead(layers, host)
  const inherited = resolveOrchestratorGameLead({ ...layers, local: undefined }, host)
  const set = <K extends keyof OrchestratorGameLead>(
    key: K,
    value: OrchestratorGameLead[K] | undefined
  ): void =>
    updateSettings({
      orchestratorGameProjects: withOrchestratorGameProjectLead(
        settings.orchestratorGameProjects,
        repoId,
        key,
        value
      )
    })
  const effective = (key: keyof OrchestratorGameLead, text: string): string =>
    `${text} · ${orchestratorGameSourceLabel(gameLeadSourceOf(layers, key))}`
  const onOff = orchestratorGameModeLabels()
  const switches: {
    key: 'autostart' | 'actions' | 'askBeforeResume' | 'memberGame'
    label: string
    isOn: boolean
  }[] = [
    {
      key: 'autostart',
      label: translate(
        'auto.components.settings.OrchestratorGameLeadSetting.autostart',
        'Start as lead'
      ),
      isOn: lead.autostart
    },
    {
      key: 'actions',
      label: translate(
        'auto.components.settings.OrchestratorGameLeadSetting.actions',
        'Lead buttons'
      ),
      // Why: unset means on; Orca's buttons show unless a layer turns them off.
      isOn: lead.actions !== false
    },
    {
      key: 'askBeforeResume',
      label: translate(
        'auto.components.settings.OrchestratorGameLeadSetting.askBeforeResume',
        'Ask before resuming'
      ),
      isOn: lead.askBeforeResume === true
    },
    {
      key: 'memberGame',
      label: translate(
        'auto.components.settings.OrchestratorGameLeadSetting.memberGame',
        'Game in member panes'
      ),
      // Why: unset means on; a launched member loads the game unless a layer turns it off.
      isOn: lead.memberGame !== false
    }
  ]
  const accountsText = {
    label: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.accounts',
      'Member accounts'
    ),
    default: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.accountsDefault',
      "Orca's account"
    ),
    auto: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.accountsAuto',
      'Most free quota'
    ),
    defaultOption: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.accountsDefaultOption',
      "Orca's"
    ),
    autoOption: translate(
      'auto.components.settings.OrchestratorGameLeadSetting.accountsAutoOption',
      'Most free'
    )
  }
  const textOf = (key: LeadTextKey): string => {
    const value = lead[key]
    if (value !== undefined) {
      return String(value)
    }
    return key === 'effort' && lead.model === undefined
      ? translate(
          'auto.components.settings.OrchestratorGameLeadSetting.effortNeedsModel',
          'Used only with a model'
        )
      : notSet()
  }

  return (
    <div data-slot="game-lead-settings" className="space-y-1 pt-3">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.OrchestratorGameLeadSetting.title', 'Lead')}
        description={translate(
          'auto.components.settings.OrchestratorGameLeadSetting.description',
          'The session that talks to you and launches one member per ticket. orca.yaml sets the project default; these override it on this machine.'
        )}
      />
      {switches.map((row) => (
        <SettingsRow
          key={row.key}
          label={row.label}
          description={effective(row.key, row.isOn ? onOff.on : onOff.off)}
          control={
            <SettingsSegmentedControl
              value={stored?.[row.key] === undefined ? 'inherit' : String(stored[row.key])}
              ariaLabel={row.label}
              size="sm"
              options={[
                { value: 'inherit', label: orchestratorGameInheritLabel() },
                { value: 'true', label: onOff.on },
                { value: 'false', label: onOff.off }
              ]}
              onChange={(next) => set(row.key, next === 'inherit' ? undefined : next === 'true')}
            />
          }
        />
      ))}
      <SettingsRow
        label={accountsText.label}
        description={effective(
          'accounts',
          lead.accounts === 'default' ? accountsText.default : accountsText.auto
        )}
        control={
          <SettingsSegmentedControl
            value={stored?.accounts ?? 'inherit'}
            ariaLabel={accountsText.label}
            size="sm"
            options={[
              { value: 'inherit', label: orchestratorGameInheritLabel() },
              { value: 'default', label: accountsText.defaultOption },
              { value: 'auto', label: accountsText.autoOption }
            ]}
            onChange={(next) =>
              set('accounts', next === 'default' || next === 'auto' ? next : undefined)
            }
          />
        }
      />
      {fields().map((field) => {
        const value = stored?.[field.key]
        const text = value === undefined ? '' : String(value)
        return (
          <LeadTextRow
            key={`${field.key}:${text}`}
            field={field}
            stored={text}
            description={effective(field.key, textOf(field.key))}
            placeholder={String(inherited[field.key] ?? notSet())}
            onCommit={(next) => set(field.key, next)}
          />
        )
      })}
      <OrchestratorGameMemberNamesRow
        key={`memberNames:${JSON.stringify(stored?.memberNames ?? null)}`}
        stored={stored?.memberNames}
        inherited={inherited.memberNames}
        sourceLabel={orchestratorGameSourceLabel(gameLeadSourceOf(layers, 'memberNames'))}
        onCommit={(next) => set('memberNames', next)}
      />
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.OrchestratorGameLeadSetting.yamlOnly',
          "The launch prompt and the project's rules live in orca.yaml under orchestratorGame.orchestrator."
        )}
      </p>
    </div>
  )
}
