import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeSpeechFileTranscription } from '../../shared/runtime-types'
import { RuntimeRpcFailureError } from '../runtime-client'
import { SPEECH_HANDLERS } from './speech'

const transcription: RuntimeSpeechFileTranscription = {
  text: 'hola, esto es una nota de voz',
  segments: ['hola, esto es una nota de voz'],
  modelId: 'parakeet-tdt-0.6b-v3-int8',
  language: 'auto',
  durationSeconds: 3.5,
  sizeBytes: 74_454
}

function failure(code: string, data?: unknown): RuntimeRpcFailureError {
  return new RuntimeRpcFailureError({
    id: 'req-1',
    ok: false,
    error: { code, message: `${code} happened`, ...(data === undefined ? {} : { data }) },
    _meta: { runtimeId: 'runtime-1' }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  process.exitCode = undefined
})

describe('orca speech transcribe', () => {
  it('resolves the path against the caller cwd and prints only the transcript', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'orca-speech-cli-'))
    writeFileSync(join(cwd, 'note.opus'), Buffer.alloc(8))
    const call = vi.fn().mockResolvedValue({
      id: 'req-1',
      ok: true,
      result: transcription,
      _meta: { runtimeId: 'runtime-1' }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SPEECH_HANDLERS['speech transcribe']!({
      client: { call } as never,
      cwd,
      flags: new Map([['file', 'note.opus']]),
      json: false
    })

    expect(call).toHaveBeenCalledWith(
      'speech.transcribe.file',
      { filePath: join(cwd, 'note.opus'), modelId: undefined, language: undefined },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
    expect(log).toHaveBeenCalledWith(transcription.text)
    expect(process.exitCode).toBeUndefined()
  })

  it('emits the whole result envelope in --json mode', async () => {
    const call = vi.fn().mockResolvedValue({
      id: 'req-1',
      ok: true,
      result: transcription,
      _meta: { runtimeId: 'runtime-1' }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SPEECH_HANDLERS['speech transcribe']!({
      client: { call } as never,
      cwd: tmpdir(),
      flags: new Map([['file', '/tmp/note.opus']]),
      json: true
    })

    const printed = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      ok: boolean
      result: RuntimeSpeechFileTranscription
    }
    expect(printed.ok).toBe(true)
    expect(printed.result).toEqual(transcription)
  })

  it('forwards --model and --language unchanged', async () => {
    const call = vi.fn().mockResolvedValue({
      id: 'req-1',
      ok: true,
      result: transcription,
      _meta: { runtimeId: 'runtime-1' }
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SPEECH_HANDLERS['speech transcribe']!({
      client: { call } as never,
      cwd: tmpdir(),
      flags: new Map([
        ['file', '/tmp/note.opus'],
        ['model', 'parakeet-tdt-0.6b-v2-int8'],
        ['language', 'en']
      ]),
      json: true
    })

    expect(call).toHaveBeenCalledWith(
      'speech.transcribe.file',
      {
        filePath: '/tmp/note.opus',
        modelId: 'parakeet-tdt-0.6b-v2-int8',
        language: 'en'
      },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })

  const exitCodeCases: [code: string, exitCode: number][] = [
    ['voice_not_configured', 3],
    ['model_not_downloaded', 4],
    ['model_language_mismatch', 5],
    ['decoder_missing', 6],
    ['file_not_found', 7],
    ['file_too_large', 8],
    ['audio_too_long', 9],
    ['speech_busy', 10],
    ['transcribe_failed', 11],
    ['model_unknown', 2]
  ]

  it.each(exitCodeCases)('exits %s with its own status code %i', async (code, exitCode) => {
    const call = vi.fn().mockRejectedValue(failure(code))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SPEECH_HANDLERS['speech transcribe']!({
      client: { call } as never,
      cwd: tmpdir(),
      flags: new Map([['file', '/tmp/note.opus']]),
      json: true
    })

    expect(process.exitCode).toBe(exitCode)
  })

  it('keeps a runtime that is not running on the generic exit code', async () => {
    const call = vi.fn().mockRejectedValue(failure('runtime_unavailable'))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SPEECH_HANDLERS['speech transcribe']!({
      client: { call } as never,
      cwd: tmpdir(),
      flags: new Map([['file', '/tmp/note.opus']]),
      json: true
    })

    expect(process.exitCode).toBe(1)
  })

  it('prints the machine-readable code and recovery data in --json mode', async () => {
    const call = vi.fn().mockRejectedValue(
      failure('model_not_downloaded', {
        modelId: 'parakeet-tdt-0.6b-v3-int8',
        nextSteps: ['Download it: orca speech models download parakeet-tdt-0.6b-v3-int8']
      })
    )
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SPEECH_HANDLERS['speech transcribe']!({
      client: { call } as never,
      cwd: tmpdir(),
      flags: new Map([['file', '/tmp/note.opus']]),
      json: true
    })

    const printed = JSON.parse(String(log.mock.calls[0]?.[0])) as {
      error: { code: string; data: { modelId: string; nextSteps: string[] } }
    }
    expect(printed.error.code).toBe('model_not_downloaded')
    expect(printed.error.data.modelId).toBe('parakeet-tdt-0.6b-v3-int8')
    expect(printed.error.data.nextSteps[0]).toContain('orca speech models download')
  })
})

describe('orca speech models', () => {
  it('lists models with language coverage and download state', async () => {
    const call = vi.fn().mockResolvedValue({
      id: 'req-1',
      ok: true,
      result: {
        enabled: true,
        selectedModelId: 'parakeet-tdt-0.6b-v3-int8',
        dictationMode: 'toggle',
        models: [
          {
            id: 'parakeet-tdt-0.6b-v3-int8',
            label: 'Parakeet TDT v3',
            provider: 'local',
            sizeBytes: 660 * 1024 * 1024,
            language: 'multilingual',
            recommended: true,
            status: 'ready',
            progress: null
          }
        ]
      },
      _meta: { runtimeId: 'runtime-1' }
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SPEECH_HANDLERS['speech models list']!({
      client: { call } as never,
      cwd: tmpdir(),
      flags: new Map(),
      json: false
    })

    const printed = String(log.mock.calls[0]?.[0])
    expect(printed).toContain('parakeet-tdt-0.6b-v3-int8')
    expect(printed).toContain('multilingual')
    expect(printed).toContain('ready')
  })

  it('starts a download only when asked for one explicitly', async () => {
    const call = vi.fn().mockResolvedValue({
      id: 'req-1',
      ok: true,
      result: { started: true },
      _meta: { runtimeId: 'runtime-1' }
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await SPEECH_HANDLERS['speech models download']!({
      client: { call } as never,
      cwd: tmpdir(),
      flags: new Map([['model-id', 'parakeet-tdt-0.6b-v3-int8']]),
      json: false
    })

    expect(call).toHaveBeenCalledWith(
      'speech.models.download',
      { modelId: 'parakeet-tdt-0.6b-v3-int8' },
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
  })
})
