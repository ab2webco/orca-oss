import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ghExecFileAsyncMock } = vi.hoisted(() => ({ ghExecFileAsyncMock: vi.fn() }))
vi.mock('./gh-utils', () => ({ ghExecFileAsync: ghExecFileAsyncMock }))

import { _resetGhConditionalRestCache, readGhRestConditionally } from './gh-conditional-rest'

const ENDPOINT = 'repos/acme/widgets/pulls?head=acme%3Afeature&state=all&per_page=1'
const included = (status: string, etag: string | null, body: string): string =>
  [`HTTP/2.0 ${status}`, 'Content-Type: application/json', ...(etag ? [`Etag: ${etag}`] : [])]
    .join('\r\n')
    .concat('\r\n\r\n', body)

// gh exits non-zero on a 304 and leaves the headers on stdout.
const notModified = (): Error =>
  Object.assign(new Error('gh: HTTP 304'), {
    stderr: 'gh: HTTP 304',
    stdout: included('304 Not Modified', '"abc"', '')
  })

beforeEach(() => {
  _resetGhConditionalRestCache()
  ghExecFileAsyncMock.mockReset()
})

describe('readGhRestConditionally', () => {
  it('serves the cached body when GitHub answers 304 to the stored ETag', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({
        stdout: included('200 OK', 'W/"abc"', '[{"number":7}]'),
        stderr: ''
      })
      .mockRejectedValueOnce(notModified())

    expect(await readGhRestConditionally('local', ENDPOINT)).toBe('[{"number":7}]')
    expect(await readGhRestConditionally('local', ENDPOINT)).toBe('[{"number":7}]')

    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(1, ['api', ENDPOINT, '--include'], {})
    expect(ghExecFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      ['api', ENDPOINT, '--include', '--header', 'If-None-Match: W/"abc"'],
      {}
    )
  })

  it('replaces the cached body when the resource changed', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: included('200 OK', '"v1"', '[1]'), stderr: '' })
      .mockResolvedValueOnce({ stdout: included('200 OK', '"v2"', '[2]'), stderr: '' })
      .mockRejectedValueOnce(notModified())

    await readGhRestConditionally('local', ENDPOINT)
    expect(await readGhRestConditionally('local', ENDPOINT)).toBe('[2]')
    expect(await readGhRestConditionally('local', ENDPOINT)).toBe('[2]')
    expect(ghExecFileAsyncMock.mock.calls[2][0]).toContain('If-None-Match: "v2"')
  })

  it('makes one request for N concurrent readers of the same endpoint', async () => {
    ghExecFileAsyncMock.mockResolvedValue({ stdout: included('200 OK', '"e"', '[]'), stderr: '' })

    const bodies = await Promise.all(
      Array.from({ length: 9 }, () => readGhRestConditionally('local', ENDPOINT))
    )

    expect(bodies).toEqual(Array(9).fill('[]'))
    expect(ghExecFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('keeps scopes apart, so one gh host or account never answers for another', async () => {
    ghExecFileAsyncMock.mockResolvedValue({ stdout: included('200 OK', '"e"', '[]'), stderr: '' })

    await readGhRestConditionally('local\0github.com', ENDPOINT)
    await readGhRestConditionally('ssh:box\0github.com', ENDPOINT)

    expect(ghExecFileAsyncMock.mock.calls.map(([args]) => args)).toEqual([
      ['api', ENDPOINT, '--include'],
      ['api', ENDPOINT, '--include']
    ])
  })

  it('rethrows a real failure instead of serving the cached body', async () => {
    ghExecFileAsyncMock
      .mockResolvedValueOnce({ stdout: included('200 OK', '"e"', '[]'), stderr: '' })
      .mockRejectedValueOnce(
        Object.assign(new Error('gh: HTTP 502'), {
          stderr: 'gh: HTTP 502',
          stdout: included('502 Bad Gateway', null, '')
        })
      )

    await readGhRestConditionally('local', ENDPOINT)
    await expect(readGhRestConditionally('local', ENDPOINT)).rejects.toThrow('HTTP 502')
  })

  it('reads a body printed without headers as an uncached answer', async () => {
    ghExecFileAsyncMock.mockResolvedValue({ stdout: '[3]', stderr: '' })

    expect(await readGhRestConditionally('local', ENDPOINT)).toBe('[3]')
    await readGhRestConditionally('local', ENDPOINT)

    expect(ghExecFileAsyncMock.mock.calls[1][0]).toEqual(['api', ENDPOINT, '--include'])
  })
})
