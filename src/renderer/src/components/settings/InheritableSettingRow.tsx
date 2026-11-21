import { SettingsRow, SettingsSegmentedControl } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

const sameLine = (line: string): string => line

/** What a row resolves to without this machine's own value, and the layer that sets it. */
export type InheritedChoice = { value: string; label: string; source: string }

/**
 * The one line every project row ends with: the applied value and its layer, then, while this
 * machine overrides it, a Reset button that goes back to the inherited value (ORCA-1112 D3).
 */
export function InheritedSourceLine({
  applied,
  source,
  inherited,
  isOverridden,
  onReset,
  lineOf = sameLine
}: {
  applied: string
  source: string
  inherited: InheritedChoice
  isOverridden: boolean
  onReset: () => void
  /** Words around the applied line, such as which surface it sets. */
  lineOf?: (line: string) => string
}): React.JSX.Element {
  return (
    <span data-slot="game-row-source" className="block">
      {lineOf(`${applied} · ${source}`)}
      {isOverridden ? (
        <button
          type="button"
          className="ml-2 rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onReset}
        >
          {translate(
            'auto.components.settings.InheritableSettingRow.resetTo',
            'Reset to {{value}} ({{source}})',
            { value: inherited.label, source: inherited.source }
          )}
        </button>
      ) : null}
    </span>
  )
}

/** A project row with the applied value selected and no Inherit option; picking the inherited value clears the override. */
export function InheritableSegmentedRow({
  label,
  text,
  note,
  options,
  applied,
  source,
  inherited,
  isOverridden,
  onPick,
  lineOf,
  appliedLabel: shownLabel
}: {
  label: string
  /** The row's own description, above the source line. */
  text?: React.ReactNode
  /** A line between the description and the source line. */
  note?: React.ReactNode
  options: { value: string; label: string }[]
  applied: string
  source: string
  inherited: InheritedChoice
  isOverridden: boolean
  /** `undefined` clears this machine's value. */
  onPick: (value: string | undefined) => void
  lineOf?: (line: string) => string
  /** The applied value's words when the option's own label says less (an allow-list). */
  appliedLabel?: string
}): React.JSX.Element {
  const appliedLabel = shownLabel ?? options.find((one) => one.value === applied)?.label ?? applied
  return (
    <SettingsRow
      label={label}
      description={
        <>
          {text ? <span className="block">{text}</span> : null}
          {note}
          <InheritedSourceLine
            applied={appliedLabel}
            source={source}
            inherited={inherited}
            isOverridden={isOverridden}
            onReset={() => onPick(undefined)}
            lineOf={lineOf}
          />
        </>
      }
      control={
        <SettingsSegmentedControl
          value={applied}
          ariaLabel={label}
          size="sm"
          options={options}
          onChange={(next) => onPick(next === inherited.value ? undefined : next)}
        />
      }
    />
  )
}
