import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

vi.mock('electron', () => ({
  net: { fetch: (...args: unknown[]) => fetchMock(...args) }
}))

import {
  fetchChangelog,
  getReleaseApiUrlForVersion,
  summarizeReleaseBody
} from './updater-changelog'

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as unknown as Response
}

function releaseBody(changes: string[], previousTag = 'v1.4.160-lab.29'): string {
  return [
    '# Orca Lab v1.4.160-lab.30',
    '',
    'Build del laboratorio de Ab2Web basado en Orca.',
    '',
    '> La versión interna es `1.4.160-lab.30` para que ordenen por semver.',
    '',
    `## Cambios desde ${previousTag}`,
    '',
    ...changes.map((change) => `- ${change}`),
    '',
    '## Instalación en macOS',
    'El build de macOS va firmado y notarizado con Developer ID.'
  ].join('\n')
}

// Why the real bodies: synthetic bullets never look like a lab release, where
// `git log` puts the release chore first. Captured with
// `gh api repos/ab2webco/orca-oss/releases/tags/<tag> --jq .body`.
const LAB_30_RELEASE_BODY = `# Orca Lab v1.4.160-lab.30

Build del laboratorio de Ab2Web basado en Orca (upstream stablyai/orca) más las funcionalidades propias del lab. Se distingue por el distintivo "by Ab2Web" en la barra de título.

> La versión interna es \`1.4.160-lab.30\` para que las actualizaciones automáticas ordenen correctamente por semver.

## Cambios desde v1.4.160-lab.29.rc

- chore(release): bump version to 1.4.160-lab.30

## Instalación en macOS
El build de macOS va firmado y notarizado con Developer ID, así que Gatekeeper lo abre sin pasos extra. Descarga el \`.dmg\` o deja que Orca se auto-actualice.

Los archivos \`latest-*.yml\`, \`*.zip\` y \`*.blockmap\` los usa el auto-updater — no descargarlos a mano.`

const LAB_29_RC_RELEASE_BODY = `# Orca Lab v1.4.160-lab.29.rc (release candidate)

Build del laboratorio de Ab2Web basado en Orca (upstream stablyai/orca) más las funcionalidades propias del lab. Se distingue por el distintivo "by Ab2Web" en la barra de título.

> La versión interna es \`1.4.160-lab.29.rc\` para que las actualizaciones automáticas ordenen correctamente por semver.

## Cambios desde v1.4.160-lab.28

- chore(release): bump version to 1.4.160-lab.29.rc
- feat(orchestration): fail a dispatch whose worker never reported (ORCA-191) (#63)
- fix(accounts): resolve a shared Claude terminal's owner instead of locking every account (ORCA-190) (#62)
- chore(release): announce v1.4.160-lab.28 via update nudge

## Instalación en macOS
El build de macOS va firmado y notarizado con Developer ID, así que Gatekeeper lo abre sin pasos extra. Descarga el \`.dmg\` o deja que Orca se auto-actualice.

Los archivos \`latest-*.yml\`, \`*.zip\` y \`*.blockmap\` los usa el auto-updater — no descargarlos a mano.

## Release candidate
No se anuncia ni llega por auto-update: los chequeos normales excluyen los tags \`-lab.N.rc\`. Descargá el instalador a mano para validarlo. Una vez validado, se promueve con un release normal, que sale con el número siguiente.`

function fetchedUrl(): string {
  return fetchMock.mock.calls[0][0] as string
}

describe('getReleaseApiUrlForVersion', () => {
  it('targets the fork release for the incoming lab version', () => {
    expect(getReleaseApiUrlForVersion('1.4.160-lab.30')).toBe(
      'https://api.github.com/repos/ab2webco/orca-oss/releases/tags/v1.4.160-lab.30'
    )
  })

  it('adds the v prefix only once when the version already carries a tag prefix', () => {
    expect(getReleaseApiUrlForVersion('v1.4.161')).toBe(
      'https://api.github.com/repos/ab2webco/orca-oss/releases/tags/v1.4.161'
    )
  })
})

describe('summarizeReleaseBody', () => {
  it('joins the change bullets from the fork release template', () => {
    expect(summarizeReleaseBody(releaseBody(['fix(a): one', 'feat(b): two']))).toBe(
      'fix(a): one · feat(b): two'
    )
  })

  it('caps the bullet list and marks that more changes exist', () => {
    const summary = summarizeReleaseBody(
      releaseBody(['one', 'two', 'three', 'four', 'five', 'six'])
    )
    expect(summary).toBe('one · two · three · four …')
  })

  it('stops at the next heading so install boilerplate never leaks in', () => {
    expect(summarizeReleaseBody(releaseBody(['only change']))).toBe('only change')
  })

  it('truncates an over-long summary', () => {
    const summary = summarizeReleaseBody(releaseBody(['x'.repeat(400)]))
    expect(summary).toHaveLength(280)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('drops the release chore so a bump-only release shows no card', () => {
    expect(summarizeReleaseBody(LAB_30_RELEASE_BODY)).toBe('')
  })

  it('keeps the real changes from a release that shipped some', () => {
    expect(summarizeReleaseBody(LAB_29_RC_RELEASE_BODY)).toBe(
      'feat(orchestration): fail a dispatch whose worker never reported (ORCA-191) (#63) · ' +
        "fix(accounts): resolve a shared Claude terminal's owner instead of locking every account (ORCA-190) (#62)"
    )
  })

  it('falls back to the lead paragraph when the notes carry no change section', () => {
    const body = ['# Orca Lab v1.4.161', '', '> internal aside', '', 'Hotfix build.'].join('\n')
    expect(summarizeReleaseBody(body)).toBe('Hotfix build.')
  })

  it('returns empty when the notes are only headings and asides', () => {
    expect(summarizeReleaseBody('# Orca Lab v1.4.161\n\n> internal aside\n')).toBe('')
  })
})

describe('fetchChangelog', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('reads the fork release for the incoming version, never an upstream host', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        name: 'Orca Lab v1.4.160-lab.30',
        html_url: 'https://github.com/ab2webco/orca-oss/releases/tag/v1.4.160-lab.30',
        body: releaseBody(['fix(fork): keep feedback inside the fork'])
      })
    )

    const result = await fetchChangelog('1.4.160-lab.30')

    expect(fetchedUrl()).toBe(
      'https://api.github.com/repos/ab2webco/orca-oss/releases/tags/v1.4.160-lab.30'
    )
    expect(fetchedUrl()).not.toContain('onorca.dev')
    expect(result).not.toBeNull()
    expect(result!.release.title).toBe('Orca Lab v1.4.160-lab.30')
    expect(result!.release.description).toBe('fix(fork): keep feedback inside the fork')
    expect(result!.release.releaseNotesUrl).toBe(
      'https://github.com/ab2webco/orca-oss/releases/tag/v1.4.160-lab.30'
    )
    expect(result!.releasesBehind).toBeNull()
  })

  it('falls back to the fork tag URL when the release omits html_url', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: '', body: releaseBody(['a change']) }))

    const result = await fetchChangelog('1.4.160-lab.30')

    expect(result!.release.releaseNotesUrl).toBe(
      'https://github.com/ab2webco/orca-oss/releases/tag/v1.4.160-lab.30'
    )
    expect(result!.release.title).toBe('Orca 1.4.160-lab.30')
  })

  it('returns null for a draft release', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ draft: true, name: 'Draft', body: releaseBody(['a change']) })
    )

    expect(await fetchChangelog('1.4.160-lab.30')).toBeNull()
  })

  it('returns null when the release has nothing worth showing', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ name: 'Orca Lab', body: '# Orca Lab\n' }))

    expect(await fetchChangelog('1.4.160-lab.30')).toBeNull()
  })

  it('returns null on a non-ok response so an unpublished tag stays quiet', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })

    expect(await fetchChangelog('1.4.160-lab.30')).toBeNull()
  })

  it('returns null on a non-object payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ version: '1.4.160-lab.30' }]))

    expect(await fetchChangelog('1.4.160-lab.30')).toBeNull()
  })

  it('propagates a transport failure for the caller to swallow', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))

    await expect(fetchChangelog('1.4.160-lab.30')).rejects.toThrow('offline')
  })
})
