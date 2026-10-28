import { beforeEach, describe, expect, it, vi } from 'vitest'

const callMock = vi.fn()

vi.mock('../runtime-client', () => {
  class RuntimeClient {
    readonly isRemote: boolean
    call = callMock
    getCliStatus = vi.fn()
    openOrca = vi.fn()

    constructor(
      _userDataPath?: string,
      _requestTimeoutMs?: number,
      remotePairingCode?: string | null,
      environmentSelector?: string | null
    ) {
      this.isRemote = Boolean(remotePairingCode || environmentSelector)
    }
  }

  class RuntimeClientError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  }

  class RuntimeRpcFailureError extends RuntimeClientError {
    readonly response: unknown

    constructor(response: unknown) {
      super('runtime_error', 'runtime_error')
      this.response = response
    }
  }

  return {
    RuntimeClient,
    RuntimeClientError,
    RuntimeRpcFailureError
  }
})

import { buildAgentContext } from '../agent-context'
import { main } from '../index'
import { RuntimeClientError } from '../runtime-client'
import { COMMAND_SPECS } from '../specs'
import { buildWorktree, okFixture, queueFixtures, worktreeListFixture } from '../test-fixtures'

function chunkFixture(text: string | Buffer, eof: boolean) {
  const buffer = typeof text === 'string' ? Buffer.from(text, 'utf8') : text
  return okFixture('req_chunk', {
    contentBase64: buffer.toString('base64'),
    bytesRead: buffer.byteLength,
    eof
  })
}

function printed(): string {
  return vi.mocked(console.log).mock.calls[0][0]
}

describe('orca file read/list CLI handlers', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    callMock.mockReset()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('lists both commands in agent-context', () => {
    const commands = buildAgentContext(COMMAND_SPECS).commands.map((command) => command.command)
    expect(commands).toContain('file read')
    expect(commands).toContain('file list')
  })

  it('reads a whole text file through the budgeted preview RPC', async () => {
    queueFixtures(callMock, okFixture('req_read', { content: 'hello\nworld\n', isBinary: false }))

    await main(['file', 'read', 'src/a.ts', '--worktree', 'id:wt-1'], '/tmp/elsewhere')

    expect(callMock).toHaveBeenCalledTimes(1)
    expect(callMock).toHaveBeenCalledWith('files.readPreview', {
      worktree: 'id:wt-1',
      relativePath: 'src/a.ts'
    })
    expect(printed()).toBe('hello\nworld\n')
  })

  it('reads from the paired host named by --environment', async () => {
    queueFixtures(callMock, okFixture('req_read', { content: 'remote', isBinary: false }))

    await main(
      ['file', 'read', 'README.md', '--worktree', 'branch:main', '--environment', 'imac'],
      '/tmp/elsewhere'
    )

    expect(callMock).toHaveBeenCalledWith('files.readPreview', {
      worktree: 'branch:main',
      relativePath: 'README.md'
    })
    expect(printed()).toBe('remote')
  })

  it('requires --worktree when reading from another environment', async () => {
    await main(['file', 'read', 'README.md', '--environment', 'imac'], '/tmp/repo')

    expect(callMock).not.toHaveBeenCalled()
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain(
      'Remote file commands require --worktree'
    )
    expect(process.exitCode).toBe(1)
  })

  it('reports binary previews without dumping their bytes', async () => {
    queueFixtures(
      callMock,
      okFixture('req_read', {
        content: 'iVBORw0KGgo=',
        isBinary: true,
        isImage: true,
        mimeType: 'image/png'
      })
    )

    await main(['file', 'read', 'logo.png', '--worktree', 'id:wt-1', '--json'], '/tmp/elsewhere')

    const output = JSON.parse(printed())
    expect(output.result).toEqual({
      worktree: 'id:wt-1',
      path: 'logo.png',
      isBinary: true,
      mimeType: 'image/png'
    })
  })

  it('prints a binary notice in text mode', async () => {
    queueFixtures(callMock, okFixture('req_read', { content: '', isBinary: true }))

    await main(['file', 'read', 'app.bin', '--worktree', 'id:wt-1'], '/tmp/elsewhere')

    expect(printed()).toBe('app.bin is a binary file; content not shown.')
  })

  it('points an oversized whole-file read at --offset/--limit', async () => {
    callMock.mockRejectedValueOnce(new RuntimeClientError('runtime_error', 'file_too_large'))

    await main(['file', 'read', 'big.log', '--worktree', 'id:wt-1'], '/tmp/elsewhere')

    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('--offset')
    expect(process.exitCode).toBe(1)
  })

  it('reads a byte range through the chunk RPC and reports where to continue', async () => {
    queueFixtures(callMock, chunkFixture('world', false))

    await main(
      ['file', 'read', 'big.log', '--worktree', 'id:wt-1', '--offset', '6', '--limit', '5'],
      '/tmp/elsewhere'
    )

    expect(callMock).toHaveBeenCalledWith('files.readChunk', {
      worktree: 'id:wt-1',
      relativePath: 'big.log',
      offset: 6,
      length: 5
    })
    expect(printed()).toBe('world\n[more after byte 11; continue with --offset 11]')
  })

  it('returns the range and next offset as JSON', async () => {
    queueFixtures(callMock, chunkFixture('tail', true))

    await main(
      ['file', 'read', 'big.log', '--worktree', 'id:wt-1', '--offset', '20', '--json'],
      '/tmp/elsewhere'
    )

    expect(callMock).toHaveBeenCalledWith('files.readChunk', {
      worktree: 'id:wt-1',
      relativePath: 'big.log',
      offset: 20,
      length: 64 * 1024
    })
    expect(JSON.parse(printed()).result).toEqual({
      worktree: 'id:wt-1',
      path: 'big.log',
      isBinary: false,
      content: 'tail',
      offset: 20,
      bytesRead: 4,
      nextOffset: 24,
      eof: true
    })
  })

  it('does not split a multibyte character at the end of a range', async () => {
    // "añ" is 61 c3 b1; a 2-byte range ends inside "ñ".
    queueFixtures(callMock, chunkFixture(Buffer.from([0x61, 0xc3]), false))

    await main(
      ['file', 'read', 'es.txt', '--worktree', 'id:wt-1', '--limit', '2', '--json'],
      '/tmp/elsewhere'
    )

    const result = JSON.parse(printed()).result
    expect(result.content).toBe('a')
    expect(result.nextOffset).toBe(1)
  })

  it('reports a binary range without its bytes', async () => {
    queueFixtures(callMock, chunkFixture(Buffer.from([0x7f, 0x45, 0x00, 0x01]), false))

    await main(
      ['file', 'read', 'app.bin', '--worktree', 'id:wt-1', '--limit', '4'],
      '/tmp/elsewhere'
    )

    expect(printed()).toBe('app.bin is a binary file; content not shown.')
  })

  it('rejects a range larger than the chunk RPC accepts before calling it', async () => {
    await main(
      ['file', 'read', 'big.log', '--worktree', 'id:wt-1', '--limit', String(512 * 1024 + 1)],
      '/tmp/elsewhere'
    )

    expect(callMock).not.toHaveBeenCalled()
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('--limit')
    expect(process.exitCode).toBe(1)
  })

  it('lists a directory with directories marked by a trailing slash', async () => {
    queueFixtures(
      callMock,
      okFixture('req_dir', [
        { name: 'lib', isDirectory: true, isSymlink: false },
        { name: 'index.ts', isDirectory: false, isSymlink: false }
      ])
    )

    await main(['file', 'list', 'src', '--worktree', 'id:wt-1'], '/tmp/elsewhere')

    expect(callMock).toHaveBeenCalledWith('files.readDir', {
      worktree: 'id:wt-1',
      relativePath: 'src'
    })
    expect(printed()).toBe('lib/\nindex.ts')
  })

  it('lists the worktree root when no directory is given', async () => {
    queueFixtures(callMock, okFixture('req_dir', []))

    await main(['file', 'list', '--worktree', 'id:wt-1', '--json'], '/tmp/elsewhere')

    expect(callMock).toHaveBeenCalledWith('files.readDir', {
      worktree: 'id:wt-1',
      relativePath: ''
    })
    expect(JSON.parse(printed()).result).toEqual({
      worktree: 'id:wt-1',
      path: '',
      entries: []
    })
  })

  it('lists the root when given the absolute worktree path from the current worktree', async () => {
    queueFixtures(
      callMock,
      worktreeListFixture([buildWorktree('/tmp/repo', 'feature')]),
      okFixture('req_show', { worktree: buildWorktree('/tmp/repo', 'feature') }),
      okFixture('req_dir', [{ name: 'src', isDirectory: true, isSymlink: false }])
    )

    await main(['file', 'list', '/tmp/repo'], '/tmp/repo/src')

    expect(callMock).toHaveBeenNthCalledWith(3, 'files.readDir', {
      worktree: 'id:repo::/tmp/repo',
      relativePath: ''
    })
    expect(printed()).toBe('src/')
  })
})
