import { describe, expect, it } from 'vitest'
import type { SpeechModelState } from '../../shared/speech-types'
import {
  modelServesLanguage,
  normalizeLanguageTag,
  recommendedMultilingualModelId,
  selectFileTranscriptionModel
} from './file-transcription-model'
import { getCatalogModel } from './model-catalog'

const MULTILINGUAL = 'parakeet-tdt-0.6b-v3-int8'
const ENGLISH_ONLY = 'parakeet-tdt-0.6b-v2-int8'
const CHINESE_ENGLISH = 'zipformer-bilingual-zh-en'

function ready(...ids: string[]): SpeechModelState[] {
  return ids.map((id) => ({ id, status: 'ready' }))
}

describe('normalizeLanguageTag', () => {
  it('defaults to auto and reduces a tag to its primary subtag', () => {
    expect(normalizeLanguageTag(undefined)).toBe('auto')
    expect(normalizeLanguageTag('')).toBe('auto')
    expect(normalizeLanguageTag('AUTO')).toBe('auto')
    expect(normalizeLanguageTag('es-419')).toBe('es')
    expect(normalizeLanguageTag('pt_BR')).toBe('pt')
  })
})

describe('modelServesLanguage', () => {
  it('matches a member of a coverage set like zh-en', () => {
    const manifest = getCatalogModel(CHINESE_ENGLISH)!
    expect(modelServesLanguage(manifest, 'en')).toBe(true)
    expect(modelServesLanguage(manifest, 'zh')).toBe(true)
    expect(modelServesLanguage(manifest, 'es')).toBe(false)
  })

  it('refuses a single-language model when no language was named', () => {
    expect(modelServesLanguage(getCatalogModel(ENGLISH_ONLY)!, 'auto')).toBe(false)
    expect(modelServesLanguage(getCatalogModel(MULTILINGUAL)!, 'auto')).toBe(true)
  })
})

describe('selectFileTranscriptionModel', () => {
  it('recommends a multilingual model, never an English-only one', () => {
    expect(recommendedMultilingualModelId()).toBe(MULTILINGUAL)
  })

  it('prefers the multilingual model over the faster English-only one on auto', () => {
    const selection = selectFileTranscriptionModel({
      states: ready(ENGLISH_ONLY, MULTILINGUAL),
      language: 'auto',
      preferredModelId: ENGLISH_ONLY
    })
    expect(selection).toMatchObject({ ok: true, manifest: { id: MULTILINGUAL } })
  })

  it('reports model_language_mismatch when only an English-only model is downloaded', () => {
    const selection = selectFileTranscriptionModel({
      states: ready(ENGLISH_ONLY),
      language: 'auto'
    })
    expect(selection).toMatchObject({
      ok: false,
      code: 'model_language_mismatch',
      data: { readyModelIds: [ENGLISH_ONLY], recommendedModelId: MULTILINGUAL }
    })
  })

  it('uses an English-only model when English was explicitly requested', () => {
    const selection = selectFileTranscriptionModel({
      states: ready(ENGLISH_ONLY),
      language: 'en'
    })
    expect(selection).toMatchObject({ ok: true, manifest: { id: ENGLISH_ONLY } })
  })

  it('honors the Settings → Voice pick when it serves the language', () => {
    const selection = selectFileTranscriptionModel({
      states: ready(MULTILINGUAL, CHINESE_ENGLISH),
      language: 'en',
      preferredModelId: CHINESE_ENGLISH
    })
    expect(selection).toMatchObject({ ok: true, manifest: { id: CHINESE_ENGLISH } })
  })

  it('reports voice_not_configured when no local model is downloaded', () => {
    const selection = selectFileTranscriptionModel({ states: [], language: 'auto' })
    expect(selection).toMatchObject({
      ok: false,
      code: 'voice_not_configured',
      data: { recommendedModelId: MULTILINGUAL }
    })
    expect(selection.ok === false && selection.data.nextSteps?.[0]).toContain(
      `orca speech models download ${MULTILINGUAL}`
    )
  })

  it('honors an explicit English-only model even on auto', () => {
    const selection = selectFileTranscriptionModel({
      states: ready(ENGLISH_ONLY, MULTILINGUAL),
      language: 'auto',
      requestedModelId: ENGLISH_ONLY
    })
    expect(selection).toMatchObject({ ok: true, manifest: { id: ENGLISH_ONLY } })
  })

  it('reports the language mismatch before the download, since downloading will not help', () => {
    const selection = selectFileTranscriptionModel({
      states: ready(MULTILINGUAL),
      language: 'es',
      requestedModelId: ENGLISH_ONLY
    })
    expect(selection).toMatchObject({ ok: false, code: 'model_language_mismatch' })
  })

  it('refuses an explicit model that does not cover the requested language', () => {
    const selection = selectFileTranscriptionModel({
      states: ready(ENGLISH_ONLY, MULTILINGUAL),
      language: 'es',
      requestedModelId: ENGLISH_ONLY
    })
    expect(selection).toMatchObject({
      ok: false,
      code: 'model_language_mismatch',
      data: { modelId: ENGLISH_ONLY, requestedLanguage: 'es' }
    })
  })

  it('names the missing model when the requested one is not downloaded', () => {
    const selection = selectFileTranscriptionModel({
      states: ready(MULTILINGUAL),
      language: 'auto',
      requestedModelId: CHINESE_ENGLISH
    })
    expect(selection).toMatchObject({
      ok: false,
      code: 'model_not_downloaded',
      data: { modelId: CHINESE_ENGLISH }
    })
  })

  it('separates an unknown id from a cloud model', () => {
    expect(
      selectFileTranscriptionModel({ states: [], language: 'auto', requestedModelId: 'nope' })
    ).toMatchObject({ ok: false, code: 'model_unknown' })
    expect(
      selectFileTranscriptionModel({
        states: [],
        language: 'auto',
        requestedModelId: 'openai-gpt-4o-transcribe'
      })
    ).toMatchObject({ ok: false, code: 'model_not_supported' })
  })

  it('treats a downloading model as not usable yet', () => {
    const selection = selectFileTranscriptionModel({
      states: [{ id: MULTILINGUAL, status: 'downloading', progress: 0.4 }],
      language: 'auto',
      requestedModelId: MULTILINGUAL
    })
    expect(selection).toMatchObject({ ok: false, code: 'model_not_downloaded' })
  })
})
