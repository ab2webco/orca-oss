import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

// Every failure carries a stable `code` in the JSON envelope and its own exit
// code, so a plugin can branch on the cause instead of on English prose.
const ERROR_CODE_NOTE =
  'Failures are machine-readable: error.code is one of voice_not_configured (exit 3), model_not_downloaded (4), model_language_mismatch (5), decoder_missing (6), file_not_found (7), file_too_large (8), audio_too_long (9), speech_busy (10), transcribe_failed (11); model_unknown / model_not_supported exit 2 and anything else exits 1.'

export const SPEECH_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['speech', 'transcribe'],
    summary: 'Transcribe an audio file with the local speech models',
    usage: 'orca speech transcribe <file> [--model <id>] [--language <tag|auto>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file', 'model', 'language'],
    positionalArgs: ['file'],
    examples: [
      'orca speech transcribe ./voice-note.opus --json',
      'orca speech transcribe /tmp/meeting.m4a --language es --json',
      'orca speech transcribe ./note.wav --model parakeet-tdt-0.6b-v3-int8'
    ],
    notes: [
      'Runs fully locally on a downloaded model; it never downloads one for you (that is hundreds of MB) and never uploads the audio.',
      '--language defaults to auto and is a model constraint, not engine steering: the local transducer recognizers take no language parameter, so auto means "pick a multilingual model and let it decide". A model is only refused when the language you named is not in its coverage.',
      'Without --model, Orca picks a downloaded multilingual model (never an English-only one, which would return fluent nonsense for Spanish audio). With --model, your choice is honored as long as it covers --language.',
      'An explicit single-language --model on audio in another language is not refused, and may return little or no text (transcribe_failed) instead of a mismatch — name --language too if you want that checked up front.',
      'Needs ffmpeg on PATH (or ORCA_FFMPEG_PATH) to read compressed containers such as .opus, .m4a and .mp3.',
      'Limits: 200 MB per file and 20 minutes of audio.',
      'Plain output is the transcript alone, so it can be piped; --json adds modelId, language, durationSeconds and per-window segments.',
      ERROR_CODE_NOTE
    ]
  },
  {
    path: ['speech', 'models', 'list'],
    summary: 'List the speech models with their download state and language coverage',
    usage: 'orca speech models list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca speech models list --json'],
    notes: [
      'status is ready | not-downloaded | downloading | extracting | error, and language is the catalog coverage (multilingual, en, zh-en …) — enough to check before sending non-English audio.'
    ]
  },
  {
    path: ['speech', 'models', 'download'],
    summary: 'Download a speech model for local transcription and dictation',
    usage: 'orca speech models download <model-id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'model-id'],
    positionalArgs: ['model-id'],
    examples: ['orca speech models download parakeet-tdt-0.6b-v3-int8 --json'],
    notes: [
      'Starts the download and returns immediately; poll orca speech models list for progress.',
      'Model files are hundreds of MB, so only this explicit command downloads them.'
    ]
  }
]
