import { isBinaryBuffer } from '../../shared/binary-buffer'
import type { DirEntry } from '../../shared/filesystem-entry-types'
import type {
  RuntimeFilePreviewResult,
  RuntimeFileReadChunkResult
} from '../../shared/runtime-types'
import type { CommandHandler, HandlerContext } from '../dispatch'
import {
  getOptionalNonNegativeIntegerFlag,
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { printResult } from '../format'
import { RuntimeClientError, type RuntimeRpcSuccess } from '../runtime-client'
import { getFileWorktreeSelector, resolveFilePath } from './file-worktree-target'

// Why: files.readChunk rejects lengths above 512 KiB.
const MAX_RANGE_BYTES = 512 * 1024
const DEFAULT_RANGE_BYTES = 64 * 1024

type FileReadResult = {
  worktree: string
  path: string
  isBinary: boolean
  content?: string
  mimeType?: string
  offset?: number
  bytesRead?: number
  nextOffset?: number
  eof?: boolean
}

type FileListResult = {
  worktree: string
  path: string
  entries: DirEntry[]
}

// Why: a range can end inside a UTF-8 sequence; stop before it so the next --offset re-reads it whole.
function completeUtf8Length(buffer: Buffer): number {
  for (let back = 1; back <= Math.min(3, buffer.length); back += 1) {
    const byte = buffer[buffer.length - back]
    if ((byte & 0xc0) === 0x80) {
      continue
    }
    const expected = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1
    return expected > back ? buffer.length - back : buffer.length
  }
  return buffer.length
}

function getRangeLimit(ctx: HandlerContext): number {
  const limit = getOptionalPositiveIntegerFlag(ctx.flags, 'limit') ?? DEFAULT_RANGE_BYTES
  if (limit > MAX_RANGE_BYTES) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--limit must be at most ${MAX_RANGE_BYTES} bytes; read larger files in several ranges.`
    )
  }
  return limit
}

async function readWholeFile(
  ctx: HandlerContext,
  worktree: string,
  path: string
): Promise<RuntimeRpcSuccess<FileReadResult>> {
  try {
    const response = await ctx.client.call<RuntimeFilePreviewResult>('files.readPreview', {
      worktree,
      relativePath: path
    })
    const preview = response.result
    const result: FileReadResult = preview.isBinary
      ? {
          worktree,
          path,
          isBinary: true,
          ...(preview.mimeType ? { mimeType: preview.mimeType } : {})
        }
      : { worktree, path, isBinary: false, content: preview.content }
    return { ...response, result }
  } catch (error) {
    if (error instanceof RuntimeClientError && error.message === 'file_too_large') {
      throw new RuntimeClientError(
        error.code,
        `${path} is too large to read whole; read it in ranges with --offset <byte> --limit <bytes>.`
      )
    }
    throw error
  }
}

async function readFileRange(
  ctx: HandlerContext,
  worktree: string,
  path: string,
  offset: number,
  length: number
): Promise<RuntimeRpcSuccess<FileReadResult>> {
  const response = await ctx.client.call<RuntimeFileReadChunkResult>('files.readChunk', {
    worktree,
    relativePath: path,
    offset,
    length
  })
  const chunk = Buffer.from(response.result.contentBase64, 'base64')
  const { eof } = response.result
  if (isBinaryBuffer(chunk)) {
    return { ...response, result: { worktree, path, isBinary: true, offset, eof } }
  }
  const textLength = eof ? chunk.byteLength : completeUtf8Length(chunk)
  return {
    ...response,
    result: {
      worktree,
      path,
      isBinary: false,
      content: chunk.subarray(0, textLength).toString('utf8'),
      offset,
      bytesRead: textLength,
      nextOffset: offset + textLength,
      eof
    }
  }
}

function formatFileRead(result: FileReadResult): string {
  if (result.isBinary) {
    return `${result.path} is a binary file; content not shown.`
  }
  const content = result.content ?? ''
  if (result.eof === false && result.nextOffset !== undefined) {
    return `${content}\n[more after byte ${result.nextOffset}; continue with --offset ${result.nextOffset}]`
  }
  return content
}

function formatFileList(result: FileListResult): string {
  if (result.entries.length === 0) {
    return '(empty directory)'
  }
  return result.entries
    .map((entry) => (entry.isDirectory ? `${entry.name}/` : entry.name))
    .join('\n')
}

export const FILE_CONTENT_HANDLERS: Record<string, CommandHandler> = {
  'file read': async (ctx) => {
    const path = getRequiredStringFlag(ctx.flags, 'path')
    const ranged = ctx.flags.has('offset') || ctx.flags.has('limit')
    const offset = getOptionalNonNegativeIntegerFlag(ctx.flags, 'offset') ?? 0
    const limit = getRangeLimit(ctx)
    const worktree = await getFileWorktreeSelector(ctx)
    const relativePath = await resolveFilePath(ctx, worktree, path)
    const response = ranged
      ? await readFileRange(ctx, worktree, relativePath, offset, limit)
      : await readWholeFile(ctx, worktree, relativePath)
    printResult(response, ctx.json, formatFileRead)
  },
  'file list': async (ctx) => {
    const path = getOptionalStringFlag(ctx.flags, 'path') ?? ''
    const worktree = await getFileWorktreeSelector(ctx)
    const relativePath = await resolveFilePath(ctx, worktree, path, { allowRoot: true })
    const response = await ctx.client.call<DirEntry[]>('files.readDir', { worktree, relativePath })
    printResult(
      { ...response, result: { worktree, path: relativePath, entries: response.result } },
      ctx.json,
      formatFileList
    )
  }
}
