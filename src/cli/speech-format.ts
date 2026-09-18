import type {
  RuntimeSpeechFileTranscription,
  RuntimeSpeechSetupState
} from '../shared/runtime-types'

/** Plain output is the transcript alone so `orca speech transcribe … > note.txt`
 *  is useful; metadata only ships in --json. */
export function formatSpeechTranscription(result: RuntimeSpeechFileTranscription): string {
  return result.text
}

export function formatSpeechModelList(state: RuntimeSpeechSetupState): string {
  const lines = state.models.map((model) => {
    const progress =
      model.status === 'downloading' && model.progress !== null
        ? ` ${Math.round(model.progress * 100)}%`
        : ''
    const size = model.sizeBytes ? ` ${Math.round(model.sizeBytes / (1024 * 1024))}MB` : ''
    const marks = [
      model.id === state.selectedModelId ? 'selected' : '',
      model.recommended ? 'recommended' : ''
    ].filter((mark) => mark.length > 0)
    // An older paired host does not send `language`; say so instead of printing undefined.
    return `${model.status === 'ready' ? '✓' : ' '} ${model.id}  ${model.language ?? 'unknown'}  ${model.status}${progress}${size}${
      marks.length > 0 ? `  (${marks.join(', ')})` : ''
    }`
  })
  return [`dictationEnabled: ${state.enabled}`, ...lines].join('\n')
}

export function formatSpeechModelDownloadStarted(modelId: string): string {
  return `Download started for ${modelId}. Poll 'orca speech models list' for progress.`
}
