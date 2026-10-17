// @vitest-environment happy-dom

import type { ReactElement, RefObject } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRendererUiLanguage } from '@/i18n/i18n'
import {
  ContextualTourOverlaySurface,
  handleContextualTourOverlayKeyDown,
  type ActiveTourRenderState
} from './ContextualTourOverlaySurface'

afterEach(async () => {
  await setRendererUiLanguage('en')
})

function renderSurface(isLastStep: boolean): ReactElement {
  const panelRef: RefObject<HTMLElement | null> = { current: null }
  const renderState: ActiveTourRenderState = {
    rect: new DOMRect(0, 0, 20, 20),
    targetElement: document.createElement('button'),
    progress: { current: isLastStep ? 2 : 1, total: 2 },
    title: 'Tour title',
    body: 'Tour body',
    isLastStep,
    isFirstStep: !isLastStep,
    panelHost: null
  }
  return (
    <ContextualTourOverlaySurface
      activeTourId="automations"
      renderState={renderState}
      panelRef={panelRef}
      panelHost={null}
      onSkip={vi.fn()}
      onBack={vi.fn()}
      onNext={vi.fn()}
      onStepAction={vi.fn()}
      onOverlayKeyDownCapture={handleContextualTourOverlayKeyDown}
    />
  )
}

describe('ContextualTourOverlaySurface localization', () => {
  it('renders default tour actions in Spanish when the UI locale is Spanish', async () => {
    await setRendererUiLanguage('es')

    const firstStep = renderToStaticMarkup(renderSurface(false))
    const finalStep = renderToStaticMarkup(renderSurface(true))

    expect(firstStep).toContain('Próximo')
    expect(firstStep).not.toContain('>Next<')
    expect(finalStep).toContain('Listo')
    expect(finalStep).not.toContain('>Done<')
  })
})
