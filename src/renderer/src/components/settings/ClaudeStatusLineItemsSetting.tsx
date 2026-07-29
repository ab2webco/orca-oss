import React from 'react'
import {
  CLAUDE_STATUSLINE_ITEM_KEYS,
  normalizeClaudeStatusLineItems,
  type ClaudeStatusLineItemKey
} from '../../../../shared/claude-statusline-items'
import type { GlobalSettings } from '../../../../shared/types'
import {
  getClaudeStatusLineDescription,
  getClaudeStatusLineItemCopy,
  getClaudeStatusLineTitle
} from './claude-statusline-items-copy'
import { SettingsSubsectionHeader, SettingsSwitchRow } from './SettingsFormControls'

type ClaudeStatusLineItemsSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

// Why the full normalized record on every write: main rewrites the shared script from this
// value, and a partial patch would make older profiles' unset keys ambiguous forever.
export function ClaudeStatusLineItemsSetting({
  settings,
  updateSettings
}: ClaudeStatusLineItemsSettingProps): React.JSX.Element {
  const items = normalizeClaudeStatusLineItems(settings.claudeStatusLineItems)
  const toggle = (key: ClaudeStatusLineItemKey): void => {
    void updateSettings({ claudeStatusLineItems: { ...items, [key]: !items[key] } })
  }
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={getClaudeStatusLineTitle()}
        description={getClaudeStatusLineDescription()}
      />
      <div className="space-y-1">
        {CLAUDE_STATUSLINE_ITEM_KEYS.map((key) => {
          const copy = getClaudeStatusLineItemCopy(key)
          return (
            <SettingsSwitchRow
              key={key}
              label={copy.label}
              description={copy.description}
              checked={items[key]}
              onChange={() => toggle(key)}
              ariaLabel={copy.label}
            />
          )
        })}
      </div>
    </section>
  )
}
