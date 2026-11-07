import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  findClaudeSessionUniverse,
  type ClaudeSessionLookupFs
} from './claude-resume-session-lookup'

/** An in-memory tree: `links` maps a path to its real path, `files` and `dirs` are real paths. */
function fakeFs(args: {
  links?: Record<string, string>
  dirs: Record<string, string[]>
  files: string[]
}): ClaudeSessionLookupFs & { reads: string[] } {
  const reads: string[] = []
  return {
    reads,
    realpath: async (target) => {
      const real = args.links?.[target] ?? target
      if (!(real in args.dirs)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      }
      return real
    },
    readdir: async (dir) => {
      reads.push(dir)
      return args.dirs[dir] ?? []
    },
    isFile: async (file) => args.files.includes(file)
  }
}

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e'

describe('findClaudeSessionUniverse', () => {
  it('finds the one managed vault that holds the conversation', async () => {
    const fs = fakeFs({
      dirs: { '/home/me/.claude/projects': ['-repo'], '/orca/a/auth/projects': ['-repo'] },
      files: [`/orca/a/auth/projects/-repo/${SESSION}.jsonl`]
    })

    expect(
      await findClaudeSessionUniverse({
        sessionId: SESSION,
        universes: [
          { accountId: null, configDir: '/home/me/.claude' },
          { accountId: 'acct-a', configDir: '/orca/a/auth' }
        ],
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'found', accountId: 'acct-a' })
  })

  it('finds a conversation kept only in the shared home', async () => {
    const fs = fakeFs({
      dirs: { '/home/me/.claude/projects': ['-repo'], '/orca/a/auth/projects': [] },
      files: [`/home/me/.claude/projects/-repo/${SESSION}.jsonl`]
    })

    expect(
      await findClaudeSessionUniverse({
        sessionId: SESSION,
        universes: [
          { accountId: null, configDir: '/home/me/.claude' },
          { accountId: 'acct-a', configDir: '/orca/a/auth' }
        ],
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'found', accountId: null })
  })

  it('reports a conversation no universe holds as missing', async () => {
    const fs = fakeFs({ dirs: { '/home/me/.claude/projects': ['-repo'] }, files: [] })

    expect(
      await findClaudeSessionUniverse({
        sessionId: SESSION,
        universes: [
          { accountId: null, configDir: '/home/me/.claude' },
          { accountId: 'acct-a', configDir: '/orca/missing/auth' }
        ],
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'missing' })
  })

  it('reports two vaults holding the conversation as ambiguous', async () => {
    const fs = fakeFs({
      dirs: { '/orca/a/auth/projects': ['-repo'], '/orca/b/auth/projects': ['-other'] },
      files: [
        `/orca/a/auth/projects/-repo/${SESSION}.jsonl`,
        `/orca/b/auth/projects/-other/${SESSION}.jsonl`
      ]
    })

    expect(
      await findClaudeSessionUniverse({
        sessionId: SESSION,
        universes: [
          { accountId: 'acct-a', configDir: '/orca/a/auth' },
          { accountId: 'acct-b', configDir: '/orca/b/auth' }
        ],
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'ambiguous', accountIds: ['acct-a', 'acct-b'] })
  })

  // Why: every universe Orca links shares one transcript store, so the file there names no account.
  it('reads a hit in the shared transcript store as every linked universe, and scans it once', async () => {
    const fs = fakeFs({
      links: {
        '/home/me/.claude/projects': '/orca/claude-transcripts/projects',
        '/orca/a/auth/projects': '/orca/claude-transcripts/projects'
      },
      dirs: { '/orca/claude-transcripts/projects': ['-repo'] },
      files: [`/orca/claude-transcripts/projects/-repo/${SESSION}.jsonl`]
    })

    expect(
      await findClaudeSessionUniverse({
        sessionId: SESSION,
        universes: [
          { accountId: null, configDir: '/home/me/.claude' },
          { accountId: 'acct-a', configDir: '/orca/a/auth' }
        ],
        fs,
        pathApi: path.posix
      })
    ).toEqual({ kind: 'ambiguous', accountIds: [null, 'acct-a'] })
    expect(fs.reads).toEqual(['/orca/claude-transcripts/projects'])
  })

  const WIN_VAULT_A = 'C:\\Users\\me\\AppData\\Roaming\\orca\\claude-accounts\\a\\auth'
  const WIN_VAULT_B = 'C:\\Users\\me\\AppData\\Roaming\\orca\\claude-accounts\\b\\auth'

  it('joins Windows paths to find the vault that holds the conversation', async () => {
    const fs = fakeFs({
      dirs: {
        'C:\\Users\\me\\.claude\\projects': ['C--repo'],
        [`${WIN_VAULT_A}\\projects`]: ['C--repo']
      },
      files: [`${WIN_VAULT_A}\\projects\\C--repo\\${SESSION}.jsonl`]
    })

    expect(
      await findClaudeSessionUniverse({
        sessionId: SESSION,
        universes: [
          { accountId: null, configDir: 'C:\\Users\\me\\.claude' },
          { accountId: 'acct-a', configDir: WIN_VAULT_A }
        ],
        fs,
        pathApi: path.win32,
        caseInsensitivePaths: true
      })
    ).toEqual({ kind: 'found', accountId: 'acct-a' })
  })

  // Why: Windows resolves one junction target under either drive-letter case.
  it('groups Windows store paths that differ only in case as one directory', async () => {
    const fs = fakeFs({
      links: {
        [`${WIN_VAULT_A}\\projects`]: 'C:\\orca\\claude-transcripts\\projects',
        [`${WIN_VAULT_B}\\projects`]: 'c:\\Orca\\Claude-Transcripts\\projects'
      },
      dirs: {
        'C:\\orca\\claude-transcripts\\projects': ['C--repo'],
        'c:\\Orca\\Claude-Transcripts\\projects': ['C--repo']
      },
      files: [`C:\\orca\\claude-transcripts\\projects\\C--repo\\${SESSION}.jsonl`]
    })

    expect(
      await findClaudeSessionUniverse({
        sessionId: SESSION,
        universes: [
          { accountId: 'acct-a', configDir: WIN_VAULT_A },
          { accountId: 'acct-b', configDir: WIN_VAULT_B }
        ],
        fs,
        pathApi: path.win32,
        caseInsensitivePaths: true
      })
    ).toEqual({ kind: 'ambiguous', accountIds: ['acct-a', 'acct-b'] })
    expect(fs.reads).toHaveLength(1)
  })

  it('never touches the disk for an id that is not a plain file name', async () => {
    const fs = fakeFs({ dirs: {}, files: [] })
    const realpath = vi.spyOn(fs, 'realpath')

    for (const sessionId of ['../secrets', 'a/b', 'a\\b', '.hidden', '']) {
      expect(
        await findClaudeSessionUniverse({
          sessionId,
          universes: [{ accountId: null, configDir: '/home/me/.claude' }],
          fs,
          pathApi: path.posix
        })
      ).toEqual({ kind: 'missing' })
    }
    expect(realpath).not.toHaveBeenCalled()
  })
})
