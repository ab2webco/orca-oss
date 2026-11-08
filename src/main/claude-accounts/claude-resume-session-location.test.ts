import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  locateClaudeResumeSession,
  type ClaudeResumeSessionFs
} from './claude-resume-session-location'

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e'
const STORE = '/orca/claude-transcripts/projects'
const HOME = '/home/me/.claude'
const VAULT = '/orca/claude-accounts/acct-a/auth'

/** `links` maps a path to its real path; `dirs` and `files` are real paths. */
function fakeFs(args: {
  links?: Record<string, string>
  dirs: Record<string, string[]>
  files: string[]
}): ClaudeResumeSessionFs {
  const realOf = (target: string): string => {
    for (const [link, real] of Object.entries(args.links ?? {})) {
      if (target === link || target.startsWith(`${link}/`) || target.startsWith(`${link}\\`)) {
        return real + target.slice(link.length)
      }
    }
    return target
  }
  return {
    realpath: async (target) => {
      const real = realOf(target)
      if (!(real in args.dirs) && !args.files.includes(real)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return real
    },
    readdir: async (dir) => {
      const entries = args.dirs[dir]
      if (!entries) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return entries
    },
    isFile: async (file) => args.files.includes(file)
  }
}

const UNIVERSES = [
  { accountId: null, configDir: HOME },
  { accountId: 'acct-a', configDir: VAULT }
]
const linked = { [`${HOME}/projects`]: STORE, [`${VAULT}/projects`]: STORE }

describe('locateClaudeResumeSession', () => {
  it('reads a conversation the store holds as readable by any account', async () => {
    const fs = fakeFs({
      links: linked,
      dirs: { [STORE]: ['-repo'] },
      files: [`${STORE}/-repo/${SESSION}.jsonl`]
    })

    expect(
      await locateClaudeResumeSession({
        storeRoot: STORE,
        universes: UNIVERSES,
        session: { key: 'session_id', id: SESSION },
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'shared' })
  })

  it('takes a recorded transcript that exists on disk as proof, by its own file name', async () => {
    const fs = fakeFs({
      links: { ...linked, '/orca/claude-accounts/gone/auth/projects': STORE },
      dirs: { [STORE]: ['-repo'] },
      files: [`${STORE}/-repo/transcript-file.jsonl`]
    })

    expect(
      await locateClaudeResumeSession({
        storeRoot: STORE,
        universes: UNIVERSES,
        session: {
          key: 'session_id',
          id: SESSION,
          transcriptPath: '/orca/claude-accounts/gone/auth/projects/-repo/transcript-file.jsonl'
        },
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'shared' })
  })

  // ORCA-718: linking can be skipped (unmigrated leftovers, a failed link), leaving a universe
  // with a real projects/ that only it can read.
  it('runs a recorded transcript kept in an unlinked shared home on the shared home', async () => {
    const fs = fakeFs({
      links: { [`${VAULT}/projects`]: STORE },
      dirs: { [STORE]: [], [`${HOME}/projects`]: ['-repo'] },
      files: [`${HOME}/projects/-repo/${SESSION}.jsonl`]
    })

    expect(
      await locateClaudeResumeSession({
        storeRoot: STORE,
        universes: UNIVERSES,
        session: {
          key: 'session_id',
          id: SESSION,
          transcriptPath: `${HOME}/projects/-repo/${SESSION}.jsonl`
        },
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'universe', accountId: null })
  })

  it('finds a conversation with no path in an unlinked vault and runs it there', async () => {
    const fs = fakeFs({
      links: { [`${HOME}/projects`]: STORE },
      dirs: { [STORE]: ['-repo'], [`${VAULT}/projects`]: ['-repo'] },
      files: [`${VAULT}/projects/-repo/${SESSION}.jsonl`]
    })

    expect(
      await locateClaudeResumeSession({
        storeRoot: STORE,
        universes: UNIVERSES,
        session: { key: 'session_id', id: SESSION },
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'universe', accountId: 'acct-a' })
  })

  it('finds a conversation with no path in an unlinked shared home and runs it there', async () => {
    const fs = fakeFs({
      links: { [`${VAULT}/projects`]: STORE },
      dirs: { [STORE]: ['-repo'], [`${HOME}/projects`]: ['-repo'] },
      files: [`${HOME}/projects/-repo/${SESSION}.jsonl`]
    })

    expect(
      await locateClaudeResumeSession({
        storeRoot: STORE,
        universes: UNIVERSES,
        session: { key: 'session_id', id: SESSION },
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'universe', accountId: null })
  })

  it('reports a conversation in neither the store nor an unlinked universe as missing, scanning only the store', async () => {
    const fs = fakeFs({
      links: linked,
      dirs: { [STORE]: ['-repo'] },
      files: []
    })
    const readdir = vi.spyOn(fs, 'readdir')

    expect(
      await locateClaudeResumeSession({
        storeRoot: STORE,
        universes: UNIVERSES,
        session: {
          key: 'session_id',
          id: SESSION,
          transcriptPath: `/orca/claude-accounts/gone/auth/projects/-repo/${SESSION}.jsonl`
        },
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'missing' })
    expect(readdir.mock.calls.map(([dir]) => dir)).toEqual([STORE])
  })

  it('scans every universe on a host with no store at all', async () => {
    const fs = fakeFs({
      dirs: { [`${HOME}/projects`]: ['-repo'], [`${VAULT}/projects`]: ['-repo'] },
      files: [`${VAULT}/projects/-repo/${SESSION}.jsonl`]
    })

    expect(
      await locateClaudeResumeSession({
        storeRoot: STORE,
        universes: UNIVERSES,
        session: { key: 'session_id', id: SESSION },
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'universe', accountId: 'acct-a' })
  })

  const winStore = 'C:\\Users\\me\\AppData\\Roaming\\orca\\claude-transcripts\\projects'
  const winHome = 'C:\\Users\\me\\.claude'
  const winVault = 'C:\\Users\\me\\AppData\\Roaming\\orca\\claude-accounts\\a\\auth'
  const winUniverses = [
    { accountId: null, configDir: winHome },
    { accountId: 'acct-a', configDir: winVault }
  ]
  // Why: Windows resolves one junction target under either drive-letter case.
  const winLinks = {
    [`${winHome}\\projects`]: winStore.replace('C:', 'c:'),
    [`${winVault}\\projects`]: winStore
  }
  const winDirs = { [winStore]: ['C--repo'], [winStore.replace('C:', 'c:')]: ['C--repo'] }

  it('joins Windows paths to find a conversation in the store', async () => {
    expect(
      await locateClaudeResumeSession({
        storeRoot: winStore,
        universes: winUniverses,
        session: { key: 'session_id', id: SESSION },
        fs: fakeFs({
          links: winLinks,
          dirs: winDirs,
          files: [`${winStore}\\C--repo\\${SESSION}.jsonl`]
        }),
        pathApi: path.win32,
        caseInsensitivePaths: true
      })
    ).toEqual({ kind: 'shared' })
  })

  it('treats Windows universes linked under another drive-letter case as linked, scanning none', async () => {
    const fs = fakeFs({ links: winLinks, dirs: winDirs, files: [] })
    const readdir = vi.spyOn(fs, 'readdir')

    expect(
      await locateClaudeResumeSession({
        storeRoot: winStore,
        universes: winUniverses,
        session: { key: 'session_id', id: SESSION },
        fs,
        pathApi: path.win32,
        caseInsensitivePaths: true
      })
    ).toEqual({ kind: 'missing' })
    expect(readdir.mock.calls.map(([dir]) => dir)).toEqual([winStore])
  })

  it('never reads a file name that could leave its directory', async () => {
    const fs = fakeFs({ links: linked, dirs: { [STORE]: ['-repo'] }, files: [] })
    const isFile = vi.spyOn(fs, 'isFile')

    for (const id of ['../secrets', 'a/b', 'a\\b', '.hidden']) {
      expect(
        await locateClaudeResumeSession({
          storeRoot: STORE,
          universes: UNIVERSES,
          session: { key: 'session_id', id },
          fs,
          pathApi: path.posix
        })
      ).toEqual({ kind: 'missing' })
    }
    expect(isFile).not.toHaveBeenCalled()
  })
})
