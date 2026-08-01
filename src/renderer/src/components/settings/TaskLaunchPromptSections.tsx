import { useState } from 'react'
import type { GlobalSettings } from '../../../../shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'
import { translate } from '@/i18n/i18n'

type LaunchPromptSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

const TEXTAREA_CLASS =
  'w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring'

/** Draft state for a template that is only persisted on blur. */
function useTemplateDraft(
  persisted: string | undefined,
  commit: (value: string) => void
): { draft: string; setDraft: (value: string) => void; onBlur: () => void } {
  const current = persisted ?? ''
  const [draft, setDraft] = useState(current)
  // Why guarded setState during render, not an effect: the draft is not derivable
  // (the user's in-progress edit must survive re-renders), but re-syncing it in an
  // effect costs an extra committed render and trips react-doctor's
  // no-derived-state-effect. Mirrors TasksPane's own auto-expand claim.
  const [lastPersisted, setLastPersisted] = useState(current)
  if (lastPersisted !== current) {
    setLastPersisted(current)
    setDraft(current)
  }
  return {
    draft,
    setDraft,
    onBlur: () => {
      if (current !== draft) {
        commit(draft)
      }
    }
  }
}

export function LinearLaunchPromptSection({
  settings,
  updateSettings
}: LaunchPromptSectionProps): React.JSX.Element {
  const { draft, setDraft, onBlur } = useTemplateDraft(
    settings.linearLaunchPromptTemplate,
    (value) => updateSettings({ linearLaunchPromptTemplate: value })
  )

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.TasksPane.09ae2d7c51', 'Linear')}
        description={translate(
          'auto.components.settings.TasksPane.cbcd4247a4',
          'Customize the first instruction Orca sends to the agent when you start a worktree from a Linear issue.'
        )}
      />
      <SearchableSetting
        title={translate('auto.components.settings.TasksPane.8490b38b7e', 'Launch prompt template')}
        description={translate(
          'auto.components.settings.TasksPane.6a0d7e542a',
          'Leave empty to use the default. The issue identifier and URL variables are shown in the field placeholder.'
        )}
        keywords={['linear', 'prompt', 'template', 'launch', 'instruction', 'identifier', 'url']}
        className="space-y-2 py-2"
      >
        <textarea
          aria-label={translate(
            'auto.components.settings.TasksPane.linear_launch_prompt_aria',
            'Linear launch prompt template'
          )}
          value={draft}
          rows={3}
          spellCheck={false}
          placeholder={translate(
            'auto.components.settings.TasksPane.f37954bf8a',
            'Linked Linear issue: {{identifier}}\n{{url}}',
            { identifier: '{{identifier}}', url: '{{url}}' }
          )}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={onBlur}
          className={TEXTAREA_CLASS}
        />
      </SearchableSetting>
    </section>
  )
}

/** Plane launch prompt plus the provenance-stripping rule applied to every Plane write. */
export function PlaneTaskWriteSection({
  settings,
  updateSettings
}: LaunchPromptSectionProps): React.JSX.Element {
  const { draft, setDraft, onBlur } = useTemplateDraft(
    settings.planeLaunchPromptTemplate,
    (value) => updateSettings({ planeLaunchPromptTemplate: value })
  )

  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.TasksPane.plane_section_title', 'Plane')}
        description={translate(
          'auto.components.settings.TasksPane.plane_section_description',
          'Customize the first instruction Orca sends to the agent when you start a worktree from a Plane work item.'
        )}
      />
      <SearchableSetting
        title={translate(
          'auto.components.settings.TasksPane.plane_launch_prompt_title',
          'Launch prompt template'
        )}
        description={translate(
          'auto.components.settings.TasksPane.plane_launch_prompt_description',
          'Leave empty to use the default. The work item identifier and URL variables are shown in the field placeholder.'
        )}
        keywords={['plane', 'prompt', 'template', 'launch', 'instruction', 'identifier', 'url']}
        className="space-y-2 py-2"
      >
        <textarea
          aria-label={translate(
            'auto.components.settings.TasksPane.plane_launch_prompt_aria',
            'Plane launch prompt template'
          )}
          value={draft}
          rows={3}
          spellCheck={false}
          placeholder={translate(
            'auto.components.settings.TasksPane.plane_launch_prompt_placeholder',
            'Linked Plane work item: {{identifier}}\n{{url}}',
            { identifier: '{{identifier}}', url: '{{url}}' }
          )}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={onBlur}
          className={TEXTAREA_CLASS}
        />
      </SearchableSetting>
      <SearchableSetting
        title={translate(
          'auto.components.settings.TasksPane.plane_strip_attribution_title',
          'Hide AI attribution on work items'
        )}
        description={translate(
          'auto.components.settings.TasksPane.plane_strip_attribution_description',
          'Remove agent-authored provenance footers (e.g. "Planned with Claude Code", "Refined with Codex") from descriptions and comments before they are written to Plane.'
        )}
        keywords={[
          'plane',
          'ai',
          'attribution',
          'provenance',
          'claude',
          'codex',
          'footer',
          'signature',
          'ticket'
        ]}
        className="py-2"
      >
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={settings.stripAiAttributionFromTickets !== false}
            onCheckedChange={(value) =>
              updateSettings({ stripAiAttributionFromTickets: value === true })
            }
          />
          {translate(
            'auto.components.settings.TasksPane.plane_strip_attribution_toggle',
            'Strip AI attribution before writing'
          )}
        </label>
      </SearchableSetting>
    </section>
  )
}
