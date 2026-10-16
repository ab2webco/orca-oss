import { describe, expect, it } from 'vitest'

import { allyPartsOf } from '../hooks/allies'
import { cellWidthOf, fitCells } from '../hooks/cell-width'
import { chipRowsOf, MORE_CHIP_KEY, type Chip, type PlacedChip } from '../hooks/chip-rows'
import { HUD_MIN_COLUMNS, hudGridOf, hudLineOf } from '../hooks/fleet-hud'
import { setGameLocale } from '../hooks/game-strings'
import { sceneOf } from '../hooks/scenes/index'
import { glyphs } from './grid-digest'

const QUEST = sceneOf('quest')
const more = (count: number): string => `+${count}`

const CHIPS: readonly Chip[] = [
  { key: 'team', priority: 0, labels: ['⚑ Equipo: 3 compañeros', '⚑ Equipo 3', '⚑ 3'] },
  { key: 'working', priority: 2, labels: ['2 trabajando', '● 2'] },
  { key: 'idle', priority: 5, labels: ['0 inactivos', '○ 0'] },
  { key: 'waiting', priority: 1, labels: ['1 te espera', '! 1'] },
  { key: 'review', priority: 3, labels: ['#901 abierto · CI fallando', '#901 ✗'] },
  { key: 'item', priority: 4, labels: ['ORCA-1 In Progress', 'ORCA-1'] }
]

// A row takes each chip's label plus its one-space padding on both sides, and one cell between chips.
const rowWidthOf = (row: readonly PlacedChip[]): number =>
  row.reduce((sum, chip) => sum + chip.width, 0) + Math.max(0, row.length - 1)

const keysOf = (rows: readonly (readonly PlacedChip[])[]): string[] =>
  rows.flat().map((chip) => chip.key)

describe('cell width', () => {
  it('counts wide East Asian characters as two cells', () => {
    expect(cellWidthOf('abc')).toBe(3)
    expect(cellWidthOf('チーム 3 人')).toBe(11)
    expect(cellWidthOf('팀원 3명')).toBe(8)
    expect(cellWidthOf('⚑ ● ○ ▤ ↻ ♥')).toBe(11)
  })

  it('cuts by cells and marks the cut with an ellipsis', () => {
    expect(fitCells('scout patrol', 20)).toBe('scout patrol')
    expect(fitCells('scout patrol', 6)).toBe('scout…')
    expect(fitCells('チームの状態', 7)).toBe('チーム…')
    expect(cellWidthOf(fitCells('チームの状態', 6))).toBeLessThanOrEqual(6)
    expect(fitCells('abc', 0)).toBe('')
  })
})

describe('chip rows', () => {
  it('lays every chip at full length on one row when the band is wide', () => {
    const rows = chipRowsOf(CHIPS, { columns: 160, maxRows: 2, more })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.map((chip) => chip.label)).toEqual(CHIPS.map((chip) => chip.labels[0]))
  })

  it('never splits a chip: every row fits the width at every width', () => {
    for (const columns of [20, 28, 32, 36, 40, 46, 50, 56, 60, 76, 80, 116, 120, 156]) {
      const rows = chipRowsOf(CHIPS, { columns, maxRows: 2, more })
      expect(rows.length).toBeLessThanOrEqual(2)
      for (const row of rows) {
        expect(rowWidthOf(row), `row at ${columns}`).toBeLessThanOrEqual(columns)
        for (const chip of row) {
          expect(chip.width).toBe(cellWidthOf(chip.label) + 2)
        }
      }
    }
  })

  it('shortens the least important labels first, before it drops a chip', () => {
    const rows = chipRowsOf(CHIPS, { columns: 56, maxRows: 2, more })
    expect(keysOf(rows)).toEqual(CHIPS.map((chip) => chip.key))
    const labels = rows.flat().map((chip) => chip.label)
    expect(labels).toContain('○ 0')
    expect(labels).toContain('⚑ Equipo: 3 compañeros')
  })

  it('drops the lowest priority chips first and counts them in a +N chip', () => {
    const rows = chipRowsOf(CHIPS, { columns: 14, maxRows: 2, more })
    const keys = keysOf(rows)
    expect(keys[0]).toBe('team')
    expect(keys).toContain(MORE_CHIP_KEY)
    expect(keys).not.toContain('idle')
    const shown = keys.filter((key) => key !== MORE_CHIP_KEY).length
    const plus = rows.flat().find((chip) => chip.key === MORE_CHIP_KEY)
    expect(plus?.label).toBe(`+${CHIPS.length - shown}`)
  })

  it('cuts a chip that is wider than the band alone', () => {
    const rows = chipRowsOf([{ key: 'note', priority: 0, labels: ['x'.repeat(50)] }], {
      columns: 20,
      maxRows: 1
    })
    expect(rows[0]?.[0]?.label).toBe(`${'x'.repeat(17)}…`)
    expect(rowWidthOf(rows[0] ?? [])).toBe(20)
  })

  it('without a +N keeps every chip at its shortest, on as many rows as it takes', () => {
    const menu: Chip[] = [
      { key: 'panel', priority: 0, labels: ['▤ Panel'] },
      { key: 'refresh', priority: 1, labels: ['↻ Actualizar', '↻'] },
      { key: 'pet', priority: 2, labels: ['♥ Acariciar a Clawd', '♥'] }
    ]
    expect(chipRowsOf(menu, { columns: 28, maxRows: 1 })).toEqual([
      [
        { key: 'panel', label: '▤ Panel', width: 9 },
        { key: 'refresh', label: '↻ Actualizar', width: 14 },
        { key: 'pet', label: '♥', width: 3 }
      ]
    ])
    expect(keysOf(chipRowsOf(menu, { columns: 10, maxRows: 1 }))).toEqual([
      'panel',
      'refresh',
      'pet'
    ])
  })
})

const PARTY = [
  { name: 'builder', phase: 'build', state: 'working', says: 'working' },
  { name: 'tester', phase: 'verify', state: 'working', mood: 'hurt', says: 'working' },
  { name: 'scribe', phase: 'docs', state: 'waiting', says: 'waiting' }
] as const

describe('hud at narrow widths', () => {
  it('never claims an empty party while teammates are there', () => {
    for (const columns of [30, 36, 40, 58]) {
      expect(glyphs(hudGridOf(QUEST, PARTY, columns, 4))).not.toContain('No party yet.')
    }
  })

  it('counts the teammates the frame has no room for', () => {
    expect(glyphs(hudGridOf(QUEST, PARTY, 58, 4))).toContain('+2')
    expect(glyphs(hudGridOf(QUEST, PARTY, 90, 4))).not.toContain('+')
  })

  it('collapses to one line of text below the frame’s minimum, fitted to the width', () => {
    expect(HUD_MIN_COLUMNS).toBe(37)
    for (const columns of [16, 24, 30, 36]) {
      const line = hudLineOf(PARTY, columns, { level: { level: 2, into: 30, need: 200 } })
      expect(cellWidthOf(line)).toBeLessThanOrEqual(columns)
    }
    const line = hudLineOf(PARTY, 120, { isDemo: true })
    expect(line).toContain('DEMO')
    expect(line).toContain('builder')
    expect(line).toContain('! scribe')
    expect(line).toContain('× tester')
    expect(hudLineOf([], 120, {})).toContain('No party yet.')
  })

  it('writes the compact line in the session language', () => {
    try {
      setGameLocale('es')
      expect(hudLineOf([], 120, {})).toContain('Aún no hay grupo.')
      expect(hudLineOf(PARTY, 120, { level: { level: 2, into: 30, need: 200 } })).toContain('Nv 2')
    } finally {
      setGameLocale('en')
    }
  })
})

describe('ally rows', () => {
  const row = {
    key: 'ally-status-scout',
    tone: 'status',
    label: 'scout',
    text: '◆ 3 rangers on patrol along the northern ridge',
    badge: 'Opus 5.5·high'
  } as const
  const widthOf = (parts: ReturnType<typeof allyPartsOf>): number =>
    (parts.label === undefined ? 0 : cellWidthOf(parts.label) + 2) +
    cellWidthOf(parts.text) +
    1 +
    (parts.badge === undefined ? 0 : cellWidthOf(parts.badge) + 2)

  it('keeps everything when the row fits', () => {
    expect(allyPartsOf(row, 120)).toEqual({ label: 'scout', text: row.text, badge: row.badge })
  })

  it('cuts the text before the badge, and the badge once the text would drop below a word', () => {
    const mid = allyPartsOf(row, 50)
    expect(mid.badge).toBe(row.badge)
    expect(mid.text.endsWith('…')).toBe(true)
    expect(allyPartsOf(row, 30).badge).toBeUndefined()
    for (const columns of [20, 30, 40, 50, 60]) {
      expect(widthOf(allyPartsOf(row, columns))).toBeLessThanOrEqual(columns)
    }
  })
})
