import { resolve } from 'node:path'
import type {
  RuntimeSpeechFileTranscription,
  RuntimeSpeechSetupState
} from '../../shared/runtime-types'
import { speechTranscribeExitCode } from '../../shared/speech-transcribe-errors'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { printResult, reportCliError } from '../format'
import { RuntimeClientError } from '../runtime-client'
import {
  formatSpeechModelDownloadStarted,
  formatSpeechModelList,
  formatSpeechTranscription
} from '../speech-format'

/** Sized for the 20-minute audio cap: decoding stays well under real time, so
 *  the longest accepted file still settles inside this budget. */
const TRANSCRIBE_TIMEOUT_MS = 15 * 60 * 1000
const MODEL_LIST_TIMEOUT_MS = 30_000

export const SPEECH_HANDLERS: Record<string, CommandHandler> = {
  'speech transcribe': async (ctx) => {
    // Why: the runtime has no idea what the caller's shell cwd is (and under the
    // SSH relay it is not even this process's cwd — see ORCA_CLI_CWD), so the
    // path is resolved here and crosses the boundary absolute.
    const filePath = resolve(ctx.cwd, getRequiredStringFlag(ctx.flags, 'file'))
    try {
      const response = await ctx.client.call<RuntimeSpeechFileTranscription>(
        'speech.transcribe.file',
        {
          filePath,
          modelId: getOptionalStringFlag(ctx.flags, 'model'),
          language: getOptionalStringFlag(ctx.flags, 'language')
        },
        { timeoutMs: TRANSCRIBE_TIMEOUT_MS }
      )
      printResult(response, ctx.json, formatSpeechTranscription)
    } catch (error) {
      reportSpeechFailure(error, ctx)
    }
  },
  'speech models list': async (ctx) => {
    const response = await ctx.client.call<RuntimeSpeechSetupState>(
      'speech.models.list',
      {},
      {
        timeoutMs: MODEL_LIST_TIMEOUT_MS
      }
    )
    printResult(response, ctx.json, formatSpeechModelList)
  },
  'speech models download': async (ctx) => {
    const modelId = getRequiredStringFlag(ctx.flags, 'model-id')
    const response = await ctx.client.call<{ started: true }>(
      'speech.models.download',
      { modelId },
      { timeoutMs: MODEL_LIST_TIMEOUT_MS }
    )
    printResult(response, ctx.json, () => formatSpeechModelDownloadStarted(modelId))
  }
}

// Why: a plugin has to tell "turn something on" from "this broke" by exit code
// alone, so each speech failure code gets its own status. Reported here rather
// than rethrown because src/cli/index.ts flattens every thrown error to 1.
function reportSpeechFailure(error: unknown, ctx: HandlerContext): void {
  const code = error instanceof RuntimeClientError ? error.code : undefined
  reportCliError(error, ctx.json, { commandPath: ['speech', 'transcribe'] })
  process.exitCode = speechTranscribeExitCode(code)
}
