import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneClientForWorkspace } from './client'

const {
  acquireMock,
  releaseMock,
  getClientsMock,
  planeRequestMock,
  planeFetchMock,
  clearTokenMock
} = vi.hoisted(() => ({
  acquireMock: vi.fn(async () => undefined),
  releaseMock: vi.fn(),
  getClientsMock: vi.fn(),
  planeRequestMock: vi.fn(),
  planeFetchMock: vi.fn(),
  clearTokenMock: vi.fn()
}))

const { statMock, readFileMock } = vi.hoisted(() => ({
  statMock: vi.fn(),
  readFileMock: vi.fn()
}))

class MockPlaneApiError extends Error {
  status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.status = status
  }
}

vi.mock('./client', () => ({
  acquire: acquireMock,
  release: releaseMock,
  getClients: getClientsMock,
  planeRequest: planeRequestMock,
  planeFetch: planeFetchMock,
  PlaneApiError: MockPlaneApiError,
  clearWorkspaceTokenOnAuthError: clearTokenMock
}))

vi.mock('node:fs/promises', () => ({
  stat: statMock,
  readFile: readFileMock
}))

function client(workspaceSlug = 'acme'): PlaneClientForWorkspace {
  return {
    baseUrl: 'https://api.plane.so',
    workspaceSlug,
    headers: { 'x-api-key': `key-${workspaceSlug}`, 'x-workspace-slug': workspaceSlug }
  }
}

const FILE_BYTES = Buffer.from('fake png bytes')

function mockRegularFile(size = FILE_BYTES.byteLength): void {
  statMock.mockResolvedValue({ isFile: () => true, size })
  readFileMock.mockResolvedValue(FILE_BYTES)
}

const GRANT_RESPONSE = {
  upload_data: {
    url: 'https://storage.example.com/uploads',
    fields: { 'Content-Type': 'image/png', key: 'ws/abc-shot.png', policy: 'signed-policy' }
  },
  asset_id: 'asset-1'
}

const UPLOAD_ARGS = {
  projectId: 'proj-1',
  workItemId: 'wi-1',
  filePath: '/qa/shot.png',
  workspaceId: 'acme'
}

const ATTACHMENTS_PATH = '/api/v1/workspaces/acme/projects/proj-1/work-items/wi-1/attachments/'

beforeEach(() => {
  acquireMock.mockClear()
  releaseMock.mockClear()
  getClientsMock.mockReset()
  planeRequestMock.mockReset()
  planeFetchMock.mockReset()
  clearTokenMock.mockClear()
  statMock.mockReset()
  readFileMock.mockReset()
  getClientsMock.mockReturnValue([client()])
})

describe('uploadWorkItemAttachment: validation (nothing is sent)', () => {
  it('fails on a missing file without any network call', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    statMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result).toEqual({
      ok: false,
      failedStep: 'validate',
      error: 'File not found: /qa/shot.png'
    })
    expect(planeRequestMock).not.toHaveBeenCalled()
    expect(planeFetchMock).not.toHaveBeenCalled()
  })

  it('refuses an empty file before starting the flow', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    statMock.mockResolvedValue({ isFile: () => true, size: 0 })

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result).toEqual({
      ok: false,
      failedStep: 'validate',
      error: 'File is empty: /qa/shot.png'
    })
    expect(readFileMock).not.toHaveBeenCalled()
    expect(planeRequestMock).not.toHaveBeenCalled()
  })

  it('refuses a file over the size limit before starting the flow', async () => {
    const { MAX_ATTACHMENT_BYTES, uploadWorkItemAttachment } =
      await import('./plane-work-item-attachments')
    statMock.mockResolvedValue({ isFile: () => true, size: MAX_ATTACHMENT_BYTES + 1 })

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failedStep).toBe('validate')
      expect(result.error).toContain('attachment upload limit')
    }
    expect(planeRequestMock).not.toHaveBeenCalled()
  })
})

describe('uploadWorkItemAttachment: step 1 (upload grant)', () => {
  it('reports a grant failure and never touches storage', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    mockRegularFile()
    planeRequestMock.mockRejectedValue(new MockPlaneApiError('grant denied', 500))

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failedStep).toBe('upload-grant')
      expect(result.error).toContain('grant denied')
      expect(result.error).toContain('Nothing was uploaded.')
    }
    expect(planeFetchMock).not.toHaveBeenCalled()
    expect(releaseMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an unexpected grant shape instead of guessing', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    mockRegularFile()
    planeRequestMock.mockResolvedValue({ upload_data: { url: 42 }, asset_id: 'asset-1' })

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failedStep).toBe('upload-grant')
      expect(result.error).toContain('unexpected upload grant')
    }
    expect(planeFetchMock).not.toHaveBeenCalled()
  })
})

describe('uploadWorkItemAttachment: step 2 (storage upload)', () => {
  it('does not confirm when the storage POST fails', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    mockRegularFile()
    planeRequestMock.mockResolvedValue(GRANT_RESPONSE)
    planeFetchMock.mockResolvedValue(
      new Response('denied', { status: 403, statusText: 'Forbidden' })
    )

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failedStep).toBe('binary-upload')
      expect(result.error).toContain('403')
      expect(result.error).toContain('nothing was attached')
    }
    // Exactly one Plane call (the grant); the confirm PATCH must never run.
    expect(planeRequestMock).toHaveBeenCalledTimes(1)
  })

  it('maps a transport error to a clear storage failure', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    mockRegularFile()
    planeRequestMock.mockResolvedValue(GRANT_RESPONSE)
    planeFetchMock.mockRejectedValue(new Error('socket hang up'))

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failedStep).toBe('binary-upload')
      expect(result.error).toContain('socket hang up')
    }
    expect(planeRequestMock).toHaveBeenCalledTimes(1)
  })
})

describe('uploadWorkItemAttachment: step 3 (confirm)', () => {
  it('reports the unconfirmed asset id when the confirm PATCH fails', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    mockRegularFile()
    planeRequestMock
      .mockResolvedValueOnce(GRANT_RESPONSE)
      .mockRejectedValueOnce(new MockPlaneApiError('confirm exploded', 500))
    planeFetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failedStep).toBe('confirm')
      expect(result.unconfirmedAssetId).toBe('asset-1')
      expect(result.error).toContain('asset-1')
      expect(result.error).toContain('NOT confirmed')
    }
  })
})

describe('uploadWorkItemAttachment: happy path', () => {
  it('runs grant → storage POST → confirm and returns the attachment', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    mockRegularFile()
    planeRequestMock.mockResolvedValueOnce(GRANT_RESPONSE).mockResolvedValueOnce(undefined)
    planeFetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    const result = await uploadWorkItemAttachment(UPLOAD_ARGS)

    expect(result).toEqual({
      ok: true,
      attachment: {
        id: 'asset-1',
        name: 'shot.png',
        size: FILE_BYTES.byteLength,
        contentType: 'image/png',
        isUploaded: true
      }
    })

    const [, grantPath, grantInit] = planeRequestMock.mock.calls[0]
    expect(grantPath).toBe(ATTACHMENTS_PATH)
    expect(grantInit?.method).toBe('POST')
    expect(JSON.parse(grantInit?.body as string)).toEqual({
      name: 'shot.png',
      type: 'image/png',
      size: FILE_BYTES.byteLength
    })

    const [, confirmPath, confirmInit] = planeRequestMock.mock.calls[1]
    expect(confirmPath).toBe(`${ATTACHMENTS_PATH}asset-1/`)
    expect(confirmInit?.method).toBe('PATCH')

    // Both Plane calls hold the gate; the storage POST runs outside it.
    expect(acquireMock).toHaveBeenCalledTimes(2)
    expect(releaseMock).toHaveBeenCalledTimes(2)
  })

  it('POSTs a multipart form to the grant url with the file part last', async () => {
    const { uploadWorkItemAttachment } = await import('./plane-work-item-attachments')
    mockRegularFile()
    planeRequestMock.mockResolvedValueOnce(GRANT_RESPONSE).mockResolvedValueOnce(undefined)
    planeFetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await uploadWorkItemAttachment(UPLOAD_ARGS)

    const [storageUrl, storageInit] = planeFetchMock.mock.calls[0]
    expect(storageUrl).toBe('https://storage.example.com/uploads')
    expect(storageInit.method).toBe('POST')
    expect(storageInit.signal).toBeInstanceOf(AbortSignal)

    const contentType = (storageInit.headers as Record<string, string>)['Content-Type']
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
    const boundary = contentType.split('boundary=')[1]

    const body = Buffer.from(storageInit.body as Uint8Array).toString('utf8')
    for (const [name, value] of Object.entries(GRANT_RESPONSE.upload_data.fields)) {
      expect(body).toContain(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}`)
    }
    const filePartIndex = body.indexOf('name="file"; filename="shot.png"')
    expect(filePartIndex).toBeGreaterThan(-1)
    for (const name of Object.keys(GRANT_RESPONSE.upload_data.fields)) {
      expect(body.indexOf(`name="${name}"`)).toBeLessThan(filePartIndex)
    }
    expect(body).toContain('fake png bytes')
    expect(body.trimEnd().endsWith(`--${boundary}--`)).toBe(true)
  })
})

describe('listWorkItemAttachments', () => {
  it('maps a bare array response', async () => {
    const { listWorkItemAttachments } = await import('./plane-work-item-attachments')
    planeRequestMock.mockResolvedValue([
      {
        id: 'a1',
        attributes: { name: 'shot.png', size: 14, type: 'image/png' },
        is_uploaded: true
      }
    ])

    const attachments = await listWorkItemAttachments({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(attachments).toEqual([
      { id: 'a1', name: 'shot.png', size: 14, contentType: 'image/png', isUploaded: true }
    ])
    expect(planeRequestMock).toHaveBeenCalledWith(expect.anything(), ATTACHMENTS_PATH)
  })

  it('maps a paginated results envelope and flags unconfirmed rows', async () => {
    const { listWorkItemAttachments } = await import('./plane-work-item-attachments')
    planeRequestMock.mockResolvedValue({
      results: [{ id: 'a2', attributes: { name: 'clip.mp4', size: 99, type: 'video/mp4' } }]
    })

    const attachments = await listWorkItemAttachments({ projectId: 'proj-1', workItemId: 'wi-1' })

    expect(attachments).toEqual([
      { id: 'a2', name: 'clip.mp4', size: 99, contentType: 'video/mp4', isUploaded: false }
    ])
  })
})
