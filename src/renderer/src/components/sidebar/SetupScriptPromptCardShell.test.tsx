// @vitest-environment happy-dom

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SetupScriptPromptCardShell } from './SetupScriptPromptCardShell'

describe('SetupScriptPromptCardShell', () => {
  it('sits in the sidebar flow above its anchor, without a background panel', () => {
    const view = render(
      <TooltipProvider>
        <SetupScriptPromptCardShell
          repoBadgeColor="blue"
          repoDisplayName="orca"
          isInspectionError={false}
          sharedSetupIgnored={false}
          isPackageManagerSuggestion={false}
          hasCandidate={false}
          candidateSource={null}
          candidateProvenance={null}
          detectedSetupDraft=""
          isImporting={false}
          renderedStateOk
          onDismiss={vi.fn()}
          onRetryInspection={vi.fn()}
          onConfigure={vi.fn()}
          onImport={vi.fn()}
          onSetupDraftChange={vi.fn()}
        />
      </TooltipProvider>
    )
    const layer = view.container.querySelector('[data-setup-script-prompt-layer]')
    const surface = layer?.firstElementChild

    // ORCA-1131: an overlay hid the list's last rows; the card takes its own space.
    expect(layer?.classList.contains('absolute')).toBe(false)
    expect(layer?.classList.contains('bottom-full')).toBe(false)
    expect(surface?.classList.contains('bg-popover')).toBe(true)
    expect(surface?.classList.contains('text-popover-foreground')).toBe(true)
  })
})
