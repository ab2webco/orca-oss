import { afterEach, describe, expect, it } from 'vitest'

import { gameViewArgvOf } from '../hooks/game-config'
import { parseGameState } from '../hooks/game-state'
import { setGameLocale } from '../hooks/game-strings'
import { GAME_VIEWS } from '../hooks/game-view'
import { viewCommandOf, viewListOf } from '../hooks/view-command'

afterEach(() => setGameLocale('en'))

describe('/orca-game:view arguments', () => {
  it('lists the views with no argument and takes a view with an optional scope', () => {
    expect(viewCommandOf('')).toEqual({ list: true })
    expect(viewCommandOf('FLAT')).toEqual({ view: 'flat', scope: 'pane' })
    expect(viewCommandOf('2d-hd project')).toEqual({ view: '2d-hd', scope: 'project' })
    expect(viewCommandOf(' zen  global ')).toEqual({ view: 'zen', scope: 'global' })
  })

  it('names what it did not understand', () => {
    expect(viewCommandOf('3d')).toEqual({
      error: 'Unknown view "3d". Use /orca-game:view off, flat, zen, 2d-classic or 2d-hd.'
    })
    expect(viewCommandOf('flat machine')).toEqual({
      error: 'Unknown scope "machine". Use pane, project or global.'
    })
  })
})

describe('the /orca-game:view list', () => {
  it('shows every view of the shared table with its cost, the current one and the suggested one', () => {
    const list = viewListOf('zen', 'flat', ['pane', 'project', 'global'])

    expect(list).toBe(
      [
        'Game views (● now, ★ suggested for this machine):',
        '  ○ Off         light',
        '  ○ Flat        light   ★',
        '  ● Zen         medium',
        '  ○ 2D classic  medium',
        '  ○ 2D hd       heavy',
        '/orca-game:view <view> [pane|project|global]: pane (the default) changes this pane only, project stores it for this project on this machine, global for every project.'
      ].join('\n')
    )
    expect(list.split('\n').slice(1, -1)).toHaveLength(GAME_VIEWS.length)
  })

  it('says when this Orca cannot store a view beyond the pane, and leaves out an unknown suggestion', () => {
    const list = viewListOf('2d-hd', undefined, ['pane'])

    expect(list).not.toMatch(/\s★$/m)
    expect(list.split('\n').at(-1)).toBe(
      '/orca-game:view <view>: changes this pane only; this Orca cannot store a view for a project or every project.'
    )
  })

  it('speaks Spanish with the same views in the same order', () => {
    setGameLocale('es')

    expect(viewListOf('flat', '2d-classic', ['pane', 'global']).split('\n')).toEqual([
      'Vistas del juego (● ahora, ★ sugerida para esta máquina):',
      '  ○ Apagado     ligera',
      '  ● Plano       ligera',
      '  ○ Zen         media',
      '  ○ 2D clásico  media   ★',
      '  ○ 2D hd       pesada',
      '/orca-game:view <vista> [pane|global]: pane (por defecto) cambia solo este panel y global la guarda para todos los proyectos.'
    ])
  })
})

describe('the CLI call that stores a view', () => {
  it('runs orca game view with the scope, only through the absolute CLI Orca handed over', () => {
    expect(gameViewArgvOf('/opt/orca/bin/orca', 'flat', 'project')).toEqual([
      '/opt/orca/bin/orca',
      'game',
      'view',
      'flat',
      '--scope',
      'project',
      '--json'
    ])
    expect(gameViewArgvOf('orca', 'flat', 'global')).toBeUndefined()
  })
})

describe('the view switch fields of orca game state', () => {
  it('reads the writable scopes and the suggested view, and drops what it does not know', () => {
    const state = parseGameState(
      JSON.stringify({
        config: {},
        agents: [],
        worktree: null,
        links: [],
        warnings: [],
        viewScopes: ['project', 'global', 'galaxy'],
        suggestedView: '2d-hd'
      })
    )
    expect(state?.viewScopes).toEqual(['project', 'global'])
    expect(state?.suggestedView).toBe('2d-hd')
  })

  it('leaves both out from an older Orca', () => {
    const state = parseGameState(
      JSON.stringify({ config: {}, agents: [], worktree: null, links: [], warnings: [] })
    )
    expect(state).not.toHaveProperty('viewScopes')
    expect(state).not.toHaveProperty('suggestedView')
  })
})
