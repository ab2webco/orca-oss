import { describe, expect, it } from 'vitest'
import {
  classifyPageContextLoss,
  formatPageContextLossLine,
  type PageContextLossObservation
} from './page-context-loss-evidence'

const APP_URL = 'file:///app/out/renderer/index.html'

function observation(
  overrides: Partial<PageContextLossObservation> = {}
): PageContextLossObservation {
  return {
    initialUrl: APP_URL,
    mainFrameNavigations: [],
    loads: 1,
    crashed: false,
    closed: false,
    windowsAtAttach: 1,
    windowsAtReport: 1,
    handleWindowIndex: 0,
    windowUrlsAtReport: [APP_URL],
    ...overrides
  }
}

// ORCA-300: three causes produce the same Playwright message, and the whole
// point of this helper is that they stop being indistinguishable. Each case
// below is one of the three the investigation could not separate.
describe('classifyPageContextLoss', () => {
  it('calls a same-URL main-frame navigation a reload', () => {
    // Orca reloads its own window on several paths; a reload destroys the
    // context without anything having crashed.
    expect(
      classifyPageContextLoss(
        observation({ mainFrameNavigations: [{ atMs: 900, url: APP_URL }], loads: 2 })
      )
    ).toBe('reloaded')
  })

  it('calls a different-URL main-frame navigation a navigation', () => {
    expect(
      classifyPageContextLoss(
        observation({
          mainFrameNavigations: [{ atMs: 900, url: `${APP_URL}#/tasks` }]
        })
      )
    ).toBe('navigated')
  })

  it('calls a handle the app no longer lists the wrong window', () => {
    // Nothing died and nothing navigated: the evaluate asked a page that is no
    // longer one of the app's windows.
    expect(
      classifyPageContextLoss(
        observation({
          handleWindowIndex: -1,
          windowsAtReport: 2,
          windowUrlsAtReport: [APP_URL, APP_URL]
        })
      )
    ).toBe('wrong-window')
  })

  it('separates a reload from a navigation by URL alone', () => {
    // The discriminating pair: identical shape, only the URL differs. If these
    // two ever return the same verdict the helper has stopped distinguishing
    // the two causes it exists for.
    const reload = classifyPageContextLoss(
      observation({ mainFrameNavigations: [{ atMs: 500, url: APP_URL }] })
    )
    const navigation = classifyPageContextLoss(
      observation({ mainFrameNavigations: [{ atMs: 500, url: 'file:///app/other.html' }] })
    )
    expect(reload).toBe('reloaded')
    expect(navigation).toBe('navigated')
    expect(reload).not.toBe(navigation)
  })

  it('reads a crash and a close before the absence of navigation', () => {
    // Both stop the page navigating, so classifying on navigation first would
    // report every crash as 'no-navigation'.
    expect(classifyPageContextLoss(observation({ crashed: true, handleWindowIndex: -1 }))).toBe(
      'page-crashed'
    )
    expect(classifyPageContextLoss(observation({ closed: true, handleWindowIndex: -1 }))).toBe(
      'page-closed'
    )
  })

  it('admits it saw nothing rather than guessing', () => {
    // The honest outcome, and the one that says this recorder is not the
    // instrument that will explain the failure.
    expect(classifyPageContextLoss(observation())).toBe('no-navigation')
  })

  it('says in the line that it cannot see the cause', () => {
    const line = formatPageContextLossLine('spec > test', observation(), 'no-navigation')
    expect(line).toContain('[page-context-loss]')
    expect(line).toContain('this recorder cannot see the cause')
  })

  it('puts the navigation timeline in the line', () => {
    const line = formatPageContextLossLine(
      'spec > test',
      observation({ mainFrameNavigations: [{ atMs: 1200, url: APP_URL }] }),
      'reloaded'
    )
    expect(line).toContain('1200ms→')
    expect(line).toContain('handle index 0')
  })
})
