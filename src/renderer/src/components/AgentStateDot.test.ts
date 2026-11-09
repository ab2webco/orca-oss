import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentStateDot, type AgentDotState } from './AgentStateDot'

function renderMarkup(state: AgentDotState): string {
  return renderToStaticMarkup(React.createElement(AgentStateDot, { state }))
}

function renderDotClassNames(state: AgentDotState): string[] {
  const markup = renderMarkup(state)
  const dotClassName = markup.match(/<span class="([^"]*rounded-full[^"]*)"/)?.[1]

  expect(dotClassName).toBeDefined()

  return dotClassName!.split(/\s+/)
}

describe('AgentStateDot', () => {
  it('keeps the question glyph above the light-theme non-text contrast floor', () => {
    const css = readFileSync(join(__dirname, '../assets/main.css'), 'utf8')
    const lightTheme = css.match(/:root\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body
    const darkTheme = css.match(/\.dark\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body

    expect(lightTheme).toContain('--agent-question: var(--status-attention)')
    expect(darkTheme).toContain('--agent-question: var(--status-attention)')
  })

  it('renders working as a blue spinner', () => {
    const markup = renderMarkup('working')

    expect(markup).toContain('border-status-info')
    expect(markup).toContain('border-t-transparent')
    // Why: rotation must come from the compositor-driven CSS animation, not a
    // JS clock writing per-element styles on the input thread (STA-3328).
    expect(markup).toContain('agent-working-spinner')
    expect(markup).toContain('data-agent-spinner')
    // Why: under reduced motion the top border is filled so the static ring
    // reads as a complete marker, not a broken partial spinner (#9515).
    expect(markup).toContain('motion-reduce:border-t-status-info')
  })

  it('renders done as a green check icon', () => {
    const markup = renderMarkup('done')

    // Why: 'done' renders a CircleCheck icon rather than a dot so it is
    // visually distinct from other emerald-adjacent states across surfaces.
    expect(markup).toContain('lucide-circle-check')
    expect(markup).toContain('text-status-success')
  })

  it.each(['permission', 'waiting'] satisfies AgentDotState[])(
    'renders %s as the shared question glyph',
    (state) => {
      const markup = renderMarkup(state)

      expect(markup).toContain('lucide-message-circle-question-mark')
      // One token across sidebar, tabs, dashboard and map — never a raw hue.
      expect(markup).toContain('text-agent-question')
      expect(markup).not.toContain('text-amber-500')
      expect(markup).not.toContain('data-agent-spinner')
    }
  )

  it.each(['blocked', 'interrupted', 'failed'] satisfies AgentDotState[])(
    'renders %s as a red attention dot',
    (state) => {
      const classNames = renderDotClassNames(state)

      expect(classNames).toContain('bg-status-attention')
      expect(classNames).not.toContain('bg-amber-500')
    }
  )
})
