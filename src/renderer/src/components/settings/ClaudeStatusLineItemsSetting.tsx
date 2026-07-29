import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  normalizeClaudeStatusLineItemOrder,
  normalizeClaudeStatusLineItems,
  type ClaudeStatusLineItemKey
} from '../../../../shared/claude-statusline-items'
import type { GlobalSettings } from '../../../../shared/types'
import { cn } from '@/lib/utils'
import {
  getClaudeStatusLineDescription,
  getClaudeStatusLineItemCopy,
  getClaudeStatusLineMoveDownLabel,
  getClaudeStatusLineMoveUpLabel,
  getClaudeStatusLineTitle
} from './claude-statusline-items-copy'
import { ClaudeStatusLineOwnershipNotice } from './ClaudeStatusLineOwnershipNotice'
import { ClaudeStatusLinePreview } from './ClaudeStatusLinePreview'
import { SettingsRow, SettingsSubsectionHeader, SettingsSwitch } from './SettingsFormControls'

type ClaudeStatusLineItemsSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

type ReorderButtonProps = {
  ariaLabel: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}

function ReorderButton({
  ariaLabel,
  disabled,
  onClick,
  children
}: ReorderButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-sm p-1 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        disabled
          ? 'cursor-not-allowed text-muted-foreground/30'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

type ClaudeStatusLineItemRowProps = {
  label: string
  description: string
  ariaLabel: string
  checked: boolean
  onChange: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
}

function ClaudeStatusLineItemRow({
  label,
  description,
  ariaLabel,
  checked,
  onChange,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown
}: ClaudeStatusLineItemRowProps): React.JSX.Element {
  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <div className="flex items-center gap-1">
          <ReorderButton
            ariaLabel={getClaudeStatusLineMoveUpLabel(label)}
            disabled={!canMoveUp}
            onClick={onMoveUp}
          >
            <ChevronUp className="size-3.5" />
          </ReorderButton>
          <ReorderButton
            ariaLabel={getClaudeStatusLineMoveDownLabel(label)}
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            <ChevronDown className="size-3.5" />
          </ReorderButton>
          <SettingsSwitch checked={checked} onChange={onChange} ariaLabel={ariaLabel} />
        </div>
      }
    />
  )
}

// Why the full normalized record on every write: main rewrites the shared script from this
// value, and a partial patch would make older profiles' unset keys ambiguous forever.
export function ClaudeStatusLineItemsSetting({
  settings,
  updateSettings
}: ClaudeStatusLineItemsSettingProps): React.JSX.Element {
  const items = normalizeClaudeStatusLineItems(settings.claudeStatusLineItems)
  const order = normalizeClaudeStatusLineItemOrder(settings.claudeStatusLineItemOrder)
  const toggle = (key: ClaudeStatusLineItemKey): void => {
    void updateSettings({ claudeStatusLineItems: { ...items, [key]: !items[key] } })
  }
  // Why persist the full normalized order: the scripts read it as display AND drop priority,
  // so an older profile's unset order must resolve at write time exactly like the items record.
  const move = (index: number, delta: -1 | 1): void => {
    const next = [...order]
    const target = next[index + delta]
    const moved = next[index]
    if (target === undefined || moved === undefined) {
      return
    }
    next[index + delta] = moved
    next[index] = target
    void updateSettings({ claudeStatusLineItemOrder: next })
  }
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={getClaudeStatusLineTitle()}
        description={getClaudeStatusLineDescription()}
      />
      <ClaudeStatusLinePreview items={items} order={order} />
      <ClaudeStatusLineOwnershipNotice />
      <div className="space-y-1">
        {order.map((key, index) => {
          const copy = getClaudeStatusLineItemCopy(key)
          return (
            <ClaudeStatusLineItemRow
              key={key}
              label={copy.label}
              description={copy.description}
              ariaLabel={copy.label}
              checked={items[key]}
              onChange={() => toggle(key)}
              canMoveUp={index > 0}
              canMoveDown={index < order.length - 1}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
            />
          )
        })}
      </div>
    </section>
  )
}
