import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPartialRepositoryNotice, taskNoticeBannersVisible } from './partial-repository-notice'

/** Why: the route is source-asserted (see github-project-repo-list-load.test.ts);
 *  rendering the 15k-line file is not affordable here. */
const source = readFileSync(new URL('../../app/h/[hostId]/tasks.tsx', import.meta.url), 'utf8')

describe('buildPartialRepositoryNotice', () => {
  it('pluralizes the repository count', () => {
    expect(buildPartialRepositoryNotice(1, 1)).toBe('1 of 1 repository failed to load.')
    expect(buildPartialRepositoryNotice(2, 5)).toBe('2 of 5 repositories failed to load.')
  })
})

describe('taskNoticeBannersVisible', () => {
  it('keeps the banners when only a partial repository notice is set', () => {
    expect(
      taskNoticeBannersVisible({
        error: '',
        partialRepositoryNotice: '2 of 5 repositories failed to load.'
      })
    ).toBe(true)
  })

  it('shows the banners when nothing is wrong', () => {
    expect(taskNoticeBannersVisible({ error: '', partialRepositoryNotice: '' })).toBe(true)
  })

  it('hides the banners behind a real error', () => {
    expect(
      taskNoticeBannersVisible({ error: 'Failed to load tasks', partialRepositoryNotice: '' })
    ).toBe(false)
    expect(
      taskNoticeBannersVisible({
        error: 'Failed to load tasks',
        partialRepositoryNotice: '2 of 5 repositories failed to load.'
      })
    ).toBe(false)
  })
})

describe('tasks route partial repository notice wiring', () => {
  it('routes every partial notice into its own slot, never the error slot', () => {
    const calls = [...source.matchAll(/buildPartialRepositoryNotice\(/g)].map(
      (match) => match.index
    )
    expect(calls).toHaveLength(3)
    for (const index of calls) {
      const setter = source.lastIndexOf('set', index)
      expect(source.slice(setter, index)).toMatch(
        /^setPartialRepositoryNotice\(\s*(\w+(\.\w+)? > 0\s*\?\s*)?$/
      )
    }
  })

  it('gates the three informative banners on the shared visibility rule', () => {
    expect(source).not.toContain("!error && provider === 'github'")
    expect(source).not.toMatch(/!error &&\s*\n\s*provider === 'github'/)
    expect(source.match(/noticeBannersVisible && provider === 'github'/g)).toHaveLength(2)
    expect(source).toMatch(
      /noticeBannersVisible &&\s*\n\s*provider === 'github' &&\s*\n\s*githubMode === 'project'/
    )
    expect(source).toContain(
      'const noticeBannersVisible = taskNoticeBannersVisible({ error, partialRepositoryNotice })'
    )
  })

  it('renders the partial notice as its own banner', () => {
    expect(source).toMatch(
      /\{partialRepositoryNotice \? \(\s*<View style=\{styles\.sourceNoticeBanner\}>\s*<Text style=\{styles\.sourceNoticeText\}>\{partialRepositoryNotice\}<\/Text>/
    )
  })
})
