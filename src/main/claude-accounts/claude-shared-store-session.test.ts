import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { findSessionInSharedStore, type SharedStoreFs } from './claude-shared-store-session'

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e'

function fakeFs(args: { dirs: Record<string, string[]>; files: string[] }): SharedStoreFs {
  return {
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

const STORE = '/orca/claude-transcripts/projects'

describe('findSessionInSharedStore', () => {
  it('finds a conversation by its id in any project of the store', async () => {
    const fs = fakeFs({
      dirs: { [STORE]: ['-other', '-repo'] },
      files: [`${STORE}/-repo/${SESSION}.jsonl`]
    })

    expect(
      await findSessionInSharedStore({
        storeRoot: STORE,
        session: { key: 'session_id', id: SESSION },
        fs,
        pathApi: path.posix
      })
    ).toBe('found')
  })

  // Why: recent Claude Code can name the transcript file apart from its session id.
  it('finds a conversation by the file name its transcript path names', async () => {
    const fs = fakeFs({
      dirs: { [STORE]: ['-repo'] },
      files: [`${STORE}/-repo/transcript-file.jsonl`]
    })

    expect(
      await findSessionInSharedStore({
        storeRoot: STORE,
        session: {
          key: 'session_id',
          id: SESSION,
          transcriptPath: '/orca/claude-accounts/gone/auth/projects/-repo/transcript-file.jsonl'
        },
        fs,
        pathApi: path.posix
      })
    ).toBe('found')
  })

  it('reports a conversation the store does not hold as missing', async () => {
    const fs = fakeFs({ dirs: { [STORE]: ['-repo'] }, files: [] })

    expect(
      await findSessionInSharedStore({
        storeRoot: STORE,
        session: { key: 'session_id', id: SESSION },
        fs,
        pathApi: path.posix
      })
    ).toBe('missing')
  })

  it('says there is no store when its directory does not exist, so nothing is refused', async () => {
    expect(
      await findSessionInSharedStore({
        storeRoot: STORE,
        session: { key: 'session_id', id: SESSION },
        fs: fakeFs({ dirs: {}, files: [] }),
        pathApi: path.posix
      })
    ).toBe('no-store')
  })

  it('joins Windows paths', async () => {
    const winStore = 'C:\\Users\\me\\AppData\\Roaming\\orca\\claude-transcripts\\projects'
    const fs = fakeFs({
      dirs: { [winStore]: ['C--repo'] },
      files: [`${winStore}\\C--repo\\${SESSION}.jsonl`]
    })

    expect(
      await findSessionInSharedStore({
        storeRoot: winStore,
        session: {
          key: 'session_id',
          id: SESSION,
          transcriptPath: `C:\\Users\\me\\.claude\\projects\\C--repo\\${SESSION}.jsonl`
        },
        fs,
        pathApi: path.win32
      })
    ).toBe('found')
  })

  it('never reads a file name that could leave the store', async () => {
    const fs = fakeFs({ dirs: { [STORE]: ['-repo'] }, files: [] })
    const isFile = vi.spyOn(fs, 'isFile')

    for (const id of ['../secrets', 'a/b', 'a\\b', '.hidden']) {
      expect(
        await findSessionInSharedStore({
          storeRoot: STORE,
          session: { key: 'session_id', id },
          fs,
          pathApi: path.posix
        })
      ).toBe('missing')
    }
    expect(isFile).not.toHaveBeenCalled()
  })
})
