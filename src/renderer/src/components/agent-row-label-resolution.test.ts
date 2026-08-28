import { describe, expect, it } from 'vitest'
import { resolveAgentRowLabels, type AgentRowLabelInput } from './agent-row-label-resolution'

// The reported worktree: five panes of one tab, so one conversation name for all
// of them, and three sharing a pane title.
const REPORTED: AgentRowLabelInput[] = [
  {
    paneKey: 'p:318d453a',
    groupKey: 'tab-1',
    conversationName: 'El pregunta porwq',
    ownText: 'cineco-frontend-developer',
    agentType: 'claude'
  },
  {
    paneKey: 'p:a43f808e',
    groupKey: 'tab-1',
    conversationName: 'El pregunta porwq',
    ownText: 'cineco-frontend-developer',
    agentType: 'claude'
  },
  {
    paneKey: 'p:330a854e',
    groupKey: 'tab-1',
    conversationName: 'El pregunta porwq',
    ownText: 'cineco-frontend-developer',
    agentType: 'claude'
  },
  {
    paneKey: 'p:bc5d6c69',
    groupKey: 'tab-1',
    conversationName: 'El pregunta porwq',
    ownText: 'cineco-backend-developer',
    agentType: 'claude'
  },
  {
    paneKey: 'p:c65d9a1f',
    groupKey: 'tab-1',
    conversationName: 'El pregunta porwq',
    ownText: 'Revisión de espacio en disco',
    agentType: 'claude'
  }
]

function labelsOf(rows: readonly AgentRowLabelInput[]): string[] {
  const resolved = resolveAgentRowLabels(rows)
  return rows.map((row) => resolved.get(row.paneKey) ?? '<missing>')
}

describe('resolveAgentRowLabels', () => {
  // The ticket's acceptance, written as one assertion over the set: five panes
  // must render five distinguishable rows.
  it('never renders two panes with the same label', () => {
    const labels = labelsOf(REPORTED)
    expect(labels).toHaveLength(5)
    expect(new Set(labels).size).toBe(5)
  })

  it('keeps the three colliding titles tellable apart', () => {
    const labels = labelsOf(REPORTED)
    expect(labels.slice(0, 3)).toEqual([
      'cineco-frontend-developer (1)',
      'cineco-frontend-developer (2)',
      'cineco-frontend-developer (3)'
    ])
    expect(labels[3]).toBe('cineco-backend-developer')
    expect(labels[4]).toBe('Revisión de espacio en disco')
  })

  // The direction a naive fix breaks silently: a tab with one agent must keep
  // its conversation name, or generated titles are lost everywhere.
  it('keeps the conversation name when one pane owns the tab', () => {
    expect(
      labelsOf([
        {
          paneKey: 'p:solo',
          groupKey: 'tab-solo',
          conversationName: 'Fix the login flow',
          ownText: 'claude',
          agentType: 'claude'
        }
      ])
    ).toEqual(['Fix the login flow'])
  })

  it('keeps singleton conversation names across different tabs', () => {
    expect(
      labelsOf([
        {
          paneKey: 'p:a',
          groupKey: 'tab-a',
          conversationName: 'First conversation',
          ownText: 'claude',
          agentType: 'claude'
        },
        {
          paneKey: 'p:b',
          groupKey: 'tab-b',
          conversationName: 'Second conversation',
          ownText: 'claude',
          agentType: 'claude'
        }
      ])
    ).toEqual(['First conversation', 'Second conversation'])
  })

  it('preserves a distinct title while disambiguating colliding titles', () => {
    const labels = labelsOf([
      {
        paneKey: 'p:parent',
        groupKey: 'tab-mixed',
        conversationName: 'Parent Terminal',
        ownText: 'parent prompt',
        agentType: 'claude'
      },
      {
        paneKey: 'p:child-a',
        groupKey: 'tab-mixed',
        conversationName: 'Shared conversation',
        ownText: 'same prompt',
        agentType: 'claude'
      },
      {
        paneKey: 'p:child-b',
        groupKey: 'tab-mixed',
        conversationName: 'Shared conversation',
        ownText: 'same prompt',
        agentType: 'claude'
      }
    ])
    expect(labels).toEqual(['Parent Terminal', 'same prompt (1)', 'same prompt (2)'])
  })

  // The case the reviewer flagged as blocking: if every pane was dispatched from
  // one turn their own text collides too, and falling back to it alone would
  // rebuild the bug.
  it('disambiguates even when every pane carries identical text', () => {
    const identical: AgentRowLabelInput[] = ['a', 'b', 'c'].map((id) => ({
      paneKey: `p:${id}`,
      groupKey: 'tab-1',
      conversationName: 'one dispatch turn',
      ownText: 'one dispatch turn',
      agentType: 'claude'
    }))
    const labels = labelsOf(identical)
    expect(new Set(labels).size).toBe(3)
  })

  it('falls back to the agent type when a pane owns no text at all', () => {
    const blank: AgentRowLabelInput[] = ['a', 'b'].map((id) => ({
      paneKey: `p:${id}`,
      groupKey: 'tab-1',
      conversationName: null,
      ownText: '   ',
      agentType: 'codex'
    }))
    expect(new Set(labelsOf(blank)).size).toBe(2)
  })

  it('does not collide with an existing ordinal-looking title', () => {
    const labels = labelsOf([
      { ...REPORTED[0], paneKey: 'p:a', ownText: 'worker' },
      { ...REPORTED[1], paneKey: 'p:b', ownText: 'worker' },
      { ...REPORTED[2], paneKey: 'p:c', ownText: 'worker (1)' }
    ])
    expect(new Set(labels).size).toBe(3)
  })
})
