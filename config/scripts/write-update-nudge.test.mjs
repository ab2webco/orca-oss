import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildNudge, parseReleaseAnnouncement } from './write-update-nudge.mjs'

const SCRIPT = fileURLToPath(new URL('./write-update-nudge.mjs', import.meta.url))

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
}

const VALID = {
  headline: 'Faster terminal start',
  highlights: ['Tabs restore in half the time', 'SSH panes keep their scrollback'],
  link: 'https://github.com/ab2webco/orca-oss/releases/tag/v1.4.161-lab.1'
}

describe('parseReleaseAnnouncement', () => {
  it('treats a blank file as no announcement', () => {
    expect(parseReleaseAnnouncement('')).toBeNull()
    expect(parseReleaseAnnouncement('\n  \n')).toBeNull()
  })

  it('accepts a well-formed announcement and trims its lines', () => {
    expect(
      parseReleaseAnnouncement(
        JSON.stringify({ ...VALID, headline: '  Faster terminal start ', highlights: [' One '] })
      )
    ).toEqual({ headline: 'Faster terminal start', highlights: ['One'], link: VALID.link })
  })

  it('accepts a headline alone', () => {
    expect(parseReleaseAnnouncement(JSON.stringify({ headline: 'Faster' }))).toEqual({
      headline: 'Faster',
      highlights: []
    })
  })

  it.each([
    ['broken JSON', '{"headline": ', /not valid JSON/],
    ['an array', '[]', /must be a JSON object/],
    ['a missing headline', { highlights: ['One'] }, /headline must be/],
    ['a multi-line headline', { headline: 'One\ntwo' }, /headline must be/],
    ['an over-long headline', { headline: 'x'.repeat(81) }, /at most 80 characters/],
    ['a typo in a key', { headline: 'Faster', highlight: ['One'] }, /unknown key "highlight"/],
    ['non-array highlights', { headline: 'Faster', highlights: 'One' }, /must be an array/],
    ['four highlights', { headline: 'F', highlights: ['1', '2', '3', '4'] }, /at most 3 entries/],
    ['a blank highlight', { headline: 'F', highlights: ['One', ' '] }, /highlights\[1\] must be/],
    ['an over-long highlight', { headline: 'F', highlights: ['x'.repeat(121)] }, /at most 120/],
    [
      'a repeated highlight',
      { headline: 'F', highlights: ['One', 'One '] },
      /highlights\[1\] repeats/
    ],
    ['an http link', { headline: 'F', link: 'http://example.com' }, /https URL/],
    ['a non-URL link', { headline: 'F', link: 'release notes' }, /https URL/]
  ])('rejects %s', (_, input, message) => {
    const text = typeof input === 'string' ? input : JSON.stringify(input)
    expect(() => parseReleaseAnnouncement(text)).toThrow(message)
  })

  it('lists every problem at once', () => {
    expect(() =>
      parseReleaseAnnouncement(JSON.stringify({ highlights: 'x', link: 'nope' }))
    ).toThrow(/headline must be[\s\S]*highlights must be[\s\S]*link must be/)
  })
})

describe('buildNudge', () => {
  it('writes the same id and range as before when there is no announcement', () => {
    expect(buildNudge({ version: '1.4.161-lab.1', prev: '1.4.160-lab.50', content: null })).toEqual(
      {
        id: 'orca-lab-1.4.161-lab.1',
        minVersion: '1.0.0',
        maxVersion: '1.4.160-lab.50'
      }
    )
  })

  it('embeds the announcement as the content block stamped with the release version', () => {
    expect(
      buildNudge({ version: '1.4.161-lab.1', prev: '1.4.160-lab.50', content: VALID })
    ).toEqual({
      id: 'orca-lab-1.4.161-lab.1',
      minVersion: '1.0.0',
      maxVersion: '1.4.160-lab.50',
      content: { version: '1.4.161-lab.1', ...VALID }
    })
  })
})

describe('command line', () => {
  it('--check fails the dispatch on a malformed announcement and passes on a missing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-nudge-'))
    const bad = join(dir, 'next-release.json')
    writeFileSync(bad, JSON.stringify({ headline: 'Faster', highlight: ['typo'] }))

    const rejected = runScript(['--check', bad])
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toContain('unknown key "highlight"')

    const missing = runScript(['--check', join(dir, 'absent.json')])
    expect(missing.status).toBe(0)
  })

  it('writes the announcement into nudge.json and reports it on --check', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-nudge-'))
    const announcement = join(dir, 'next-release.json')
    const out = join(dir, 'nudge.json')
    writeFileSync(announcement, JSON.stringify({ ...VALID, link: ` ${VALID.link} ` }))

    const checked = runScript(['--check', announcement])
    expect(checked.status).toBe(0)
    expect(checked.stdout).toContain('announcement OK: "Faster terminal start"')

    const written = runScript([
      '--version',
      '1.4.161-lab.1',
      '--prev',
      '1.4.160-lab.50',
      '--announcement',
      announcement,
      '--out',
      out
    ])
    expect(written.status).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
      id: 'orca-lab-1.4.161-lab.1',
      minVersion: '1.0.0',
      maxVersion: '1.4.160-lab.50',
      content: { version: '1.4.161-lab.1', ...VALID }
    })
  })

  it('still writes a content-less nudge when the announcement is malformed at finalize', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-nudge-'))
    const bad = join(dir, 'next-release.json')
    const out = join(dir, 'nudge.json')
    writeFileSync(bad, '{not json')

    const result = runScript([
      '--version',
      '1.4.161-lab.1',
      '--prev',
      '1.4.160-lab.50',
      '--announcement',
      bad,
      '--out',
      out
    ])

    expect(result.status).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual({
      id: 'orca-lab-1.4.161-lab.1',
      minVersion: '1.0.0',
      maxVersion: '1.4.160-lab.50'
    })
  })
})
