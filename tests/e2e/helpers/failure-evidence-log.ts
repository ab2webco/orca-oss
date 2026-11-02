import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'

const DEFAULT_MAX_LINES_PER_SOURCE = 2_000
const REDACTED = '<redacted>'

/** Strips home paths and credential-shaped values so a failure dump is safe to upload as a CI artifact. */
export function redactFailureEvidence(text: string, homeDirs: readonly string[]): string {
  let redacted = text
  for (const homeDir of [...homeDirs].filter(Boolean).sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(homeDir).join('~')
  }
  return redacted
    .replace(/([?&#](?:token|key|secret|code|auth)[A-Za-z_]*=)[^&#\s]+/gi, `$1${REDACTED}`)
    .replace(/(Bearer\s+)[\w.~+/=-]+/g, `$1${REDACTED}`)
    .replace(
      /\b(\w*(?:token|secret|password|apikey|api_key))(["']?\s*[:=]\s*["']?)([^\s"',}&#]+)/gi,
      `$1$2${REDACTED}`
    )
}

type SourceLines = { lines: string[]; dropped: number }

export type FailureEvidenceLog = {
  append: (source: string, text: string) => void
  render: () => string
}

export function createFailureEvidenceLog(options: {
  homeDirs: readonly string[]
  maxLinesPerSource?: number
  now?: () => number
}): FailureEvidenceLog {
  const now = options.now ?? Date.now
  const maxLines = options.maxLinesPerSource ?? DEFAULT_MAX_LINES_PER_SOURCE
  const startedAt = now()
  const sources = new Map<string, SourceLines>()
  return {
    append(source, text) {
      const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
      if (lines.length === 0) {
        return
      }
      const entry = sources.get(source) ?? { lines: [], dropped: 0 }
      sources.set(source, entry)
      const offset = now() - startedAt
      entry.lines.push(...lines.map((line) => `[+${offset}ms] ${line}`))
      const overflow = entry.lines.length - maxLines
      if (overflow > 0) {
        entry.lines.splice(0, overflow)
        entry.dropped += overflow
      }
    },
    render() {
      const out: string[] = []
      for (const [source, entry] of sources) {
        out.push(`## ${source}`)
        if (entry.dropped > 0) {
          out.push(`[${entry.dropped} earlier lines dropped]`)
        }
        out.push(...entry.lines, '')
      }
      return redactFailureEvidence(out.join('\n'), options.homeDirs)
    }
  }
}

export function captureProcessOutput(
  log: FailureEvidenceLog,
  source: string,
  app: ElectronApplication
): void {
  const child = app.process()
  child.stdout?.on('data', (chunk: Buffer) => log.append(source, chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => log.append(source, chunk.toString()))
  child.on('exit', (code, signal) => log.append(source, `exit code=${code} signal=${signal}`))
}

// Why warnings/errors only: the remote PTY transport reports a stalled recovery request with console.warn.
export function capturePageWarnings(log: FailureEvidenceLog, source: string, page: Page): void {
  page.on('console', (message) => {
    const type = message.type()
    if (type === 'warning' || type === 'error') {
      log.append(source, `${type} ${message.text()}`)
    }
  })
}

export async function attachFailureEvidence(
  log: FailureEvidenceLog,
  testInfo: TestInfo,
  name: string
): Promise<void> {
  const body = log.render()
  if (body) {
    await testInfo.attach(name, { body, contentType: 'text/plain' })
  }
}
