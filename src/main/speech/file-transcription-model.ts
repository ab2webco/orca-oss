import type { SpeechModelManifest, SpeechModelState } from '../../shared/speech-types'
import type {
  SpeechTranscribeErrorCode,
  SpeechTranscribeErrorData
} from '../../shared/speech-transcribe-errors'
import { SPEECH_MODEL_CATALOG, getCatalogModel, isLocalSpeechModel } from './model-catalog'

/** `--language auto` is the default: a mixed es/en note transcribes worse when
 *  one language is forced. For the local transducer models the recognizer takes
 *  no language parameter at all, so the tag is a model-suitability constraint,
 *  never engine steering. */
export const AUTO_LANGUAGE = 'auto'

const MULTILINGUAL = 'multilingual'

export type SpeechModelSelection =
  | { ok: true; manifest: SpeechModelManifest }
  | { ok: false; code: SpeechTranscribeErrorCode; message: string; data: SpeechTranscribeErrorData }

export type SpeechModelSelectionInput = {
  states: readonly SpeechModelState[]
  /** Normalized `--language` value, or 'auto'. */
  language: string
  /** Explicit `--model`; when set it is honored even if English-only. */
  requestedModelId?: string
  /** The model picked in Settings → Voice, used only when it serves the language. */
  preferredModelId?: string
}

/** The multilingual model Orca points people at; never an English-only one. */
export function recommendedMultilingualModelId(): string {
  const recommended = SPEECH_MODEL_CATALOG.find(
    (manifest) =>
      isLocalSpeechModel(manifest) && manifest.recommended === true && isMultilingual(manifest)
  )
  const anyMultilingual = SPEECH_MODEL_CATALOG.find(
    (manifest) => isLocalSpeechModel(manifest) && isMultilingual(manifest)
  )
  return recommended?.id ?? anyMultilingual?.id ?? ''
}

// Why: catalog `language` values are coverage sets ('zh-en'), not BCP-47 tags,
// so a requested tag is reduced to its primary subtag ('es-419' → 'es') and
// matched against the set's members. Do not "fix" this into locale parsing.
export function normalizeLanguageTag(value: string | undefined): string {
  const trimmed = (value ?? '').trim().toLowerCase()
  if (trimmed === '' || trimmed === AUTO_LANGUAGE) {
    return AUTO_LANGUAGE
  }
  return trimmed.split(/[-_]/)[0]
}

function isMultilingual(manifest: SpeechModelManifest): boolean {
  return manifest.language === MULTILINGUAL
}

export function modelServesLanguage(manifest: SpeechModelManifest, language: string): boolean {
  if (isMultilingual(manifest)) {
    return true
  }
  // Why: 'auto' means the audio may switch languages mid-file, which a
  // single-language model transcribes into confident nonsense. Only a
  // multilingual model can be chosen without the caller naming a language.
  if (language === AUTO_LANGUAGE) {
    return false
  }
  return manifest.language
    .toLowerCase()
    .split('-')
    .some((tag) => tag === language)
}

function isReady(states: readonly SpeechModelState[], modelId: string): boolean {
  return states.some((state) => state.id === modelId && state.status === 'ready')
}

function readyLocalModels(states: readonly SpeechModelState[]): SpeechModelManifest[] {
  return SPEECH_MODEL_CATALOG.filter(
    (manifest) => isLocalSpeechModel(manifest) && isReady(states, manifest.id)
  )
}

function downloadStep(modelId: string): string {
  return `Download it: orca speech models download ${modelId}`
}

const SETTINGS_STEP = 'Or open Settings → Voice in Orca and download a model there.'

/** Picks the model a file transcription should run on, or explains why none fits. */
export function selectFileTranscriptionModel(
  input: SpeechModelSelectionInput
): SpeechModelSelection {
  const { states, language } = input
  const ready = readyLocalModels(states)
  const readyModelIds = ready.map((manifest) => manifest.id)
  const recommendedModelId = recommendedMultilingualModelId()

  const requestedModelId = input.requestedModelId?.trim()
  if (requestedModelId) {
    return selectRequestedModel({
      requestedModelId,
      states,
      language,
      readyModelIds,
      recommendedModelId
    })
  }

  if (ready.length === 0) {
    return {
      ok: false,
      code: 'voice_not_configured',
      message: 'Voice is not set up on this Orca: no speech model is downloaded.',
      data: {
        recommendedModelId,
        readyModelIds,
        requestedLanguage: language,
        nextSteps: [downloadStep(recommendedModelId), SETTINGS_STEP]
      }
    }
  }

  const suitable = ready.filter((manifest) => modelServesLanguage(manifest, language))
  if (suitable.length === 0) {
    return {
      ok: false,
      code: 'model_language_mismatch',
      message:
        language === AUTO_LANGUAGE
          ? `The downloaded speech models are single-language (${readyModelIds.join(', ')}); transcribing without --language needs a multilingual model.`
          : `No downloaded speech model covers language "${language}" (downloaded: ${readyModelIds.join(', ')}).`,
      data: {
        recommendedModelId,
        readyModelIds,
        requestedLanguage: language,
        nextSteps: [
          downloadStep(recommendedModelId),
          `Or force one of the downloaded models with --model <id>: ${readyModelIds.join(', ')}`
        ]
      }
    }
  }

  // Why: the default must never be "the fastest downloaded model" — an
  // English-only model on Spanish audio returns fluent garbage that nobody
  // notices. Preference order: the Settings → Voice pick (when it serves the
  // language), then the recommended multilingual model, then anything left.
  const preferredModelId = input.preferredModelId?.trim()
  const preferred = preferredModelId
    ? suitable.find((manifest) => manifest.id === preferredModelId)
    : undefined
  const chosen =
    preferred ??
    suitable.find((manifest) => manifest.recommended === true && isMultilingual(manifest)) ??
    suitable.find(isMultilingual) ??
    suitable[0]
  return { ok: true, manifest: chosen }
}

function selectRequestedModel(args: {
  requestedModelId: string
  states: readonly SpeechModelState[]
  language: string
  readyModelIds: string[]
  recommendedModelId: string
}): SpeechModelSelection {
  const { requestedModelId, states, language, readyModelIds, recommendedModelId } = args
  const manifest = getCatalogModel(requestedModelId)
  if (!manifest) {
    return {
      ok: false,
      code: 'model_unknown',
      message: `Unknown speech model "${requestedModelId}".`,
      data: {
        modelId: requestedModelId,
        recommendedModelId,
        nextSteps: ['List the catalog: orca speech models list']
      }
    }
  }
  if (!isLocalSpeechModel(manifest)) {
    return {
      ok: false,
      code: 'model_not_supported',
      message: `Speech model "${requestedModelId}" is a cloud model; file transcription runs only on local models.`,
      data: {
        modelId: requestedModelId,
        recommendedModelId,
        nextSteps: [downloadStep(recommendedModelId)]
      }
    }
  }
  // Why: an explicit --model is honored even when it is English-only — that is
  // the caller's call. It is refused only when they also named a language the
  // model does not cover, because then the two flags contradict each other.
  if (language !== AUTO_LANGUAGE && !modelServesLanguage(manifest, language)) {
    return {
      ok: false,
      code: 'model_language_mismatch',
      message: `Speech model "${manifest.id}" covers "${manifest.language}", not "${language}".`,
      data: {
        modelId: manifest.id,
        recommendedModelId,
        readyModelIds,
        requestedLanguage: language,
        nextSteps: [downloadStep(recommendedModelId)]
      }
    }
  }
  if (!isReady(states, manifest.id)) {
    return {
      ok: false,
      code: 'model_not_downloaded',
      message: `Speech model "${manifest.id}" is not downloaded.`,
      data: {
        modelId: manifest.id,
        recommendedModelId,
        readyModelIds,
        nextSteps: [downloadStep(manifest.id), SETTINGS_STEP]
      }
    }
  }
  return { ok: true, manifest }
}
