#!/usr/bin/env node
// Denies `gh pr create|edit` when the title or body credits an AI. Reads the --body-file the
// command names, not only the command text: #912's footer was written to a file by a file tool
// and passed with --body-file, past a host guard that matched the Bash text (ORCA-1032).
// The CI gate is the boundary; this is the early, in-session refusal. Errors exit 0 silently.
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { findAiAttribution } from '../../config/scripts/check-ai-attribution.mjs'

const PR_WRITE = /\bgh\b[^\n;|&]*\bpr\b[^\n;|&]*\b(?:create|edit)\b/
const TEXT_FLAGS = new Set(['-t', '--title', '-b', '--body'])
const FILE_FLAGS = new Set(['-F', '--body-file'])

/** Shell words, enough for flag values: quotes, backslash escapes, and `$(…)` kept whole. */
export function shellWords(command) {
  const words = []
  let word = ''
  let inWord = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (char === "'") {
      const end = command.indexOf("'", index + 1)
      word += command.slice(index + 1, end === -1 ? undefined : end)
      index = end === -1 ? command.length : end
      inWord = true
    } else if (char === '"') {
      let depth = 0
      for (index += 1; index < command.length; index += 1) {
        const inner = command[index]
        if (inner === '\\' && depth === 0 && /["\\$`]/.test(command[index + 1] ?? '')) {
          word += command[(index += 1)]
        } else if (inner === '$' && command[index + 1] === '(') {
          depth += 1
          word += '$('
          index += 1
        } else if (inner === ')' && depth > 0) {
          depth -= 1
          word += inner
        } else if (inner === '"' && depth === 0) {
          break
        } else {
          word += inner
        }
      }
      inWord = true
    } else if (char === '\\') {
      word += command[(index += 1)] ?? ''
      inWord = true
    } else if (/\s/.test(char)) {
      if (inWord) {
        words.push(word)
      }
      word = ''
      inWord = false
    } else {
      word += char
      inWord = true
    }
  }
  if (inWord) {
    words.push(word)
  }
  return words
}

/** The title and body texts a `gh pr create|edit` command would send. */
export function prTextsFromCommand(command, cwd, readFile = (path) => readFileSync(path, 'utf8')) {
  // Why the raw command too: a `--body-file -` body arrives through a heredoc in the command.
  const texts = [command]
  const words = shellWords(command)
  words.forEach((word, index) => {
    const [flag, inline] =
      word.startsWith('--') && word.includes('=') ? word.split(/=(.*)/s) : [word]
    const value = inline ?? words[index + 1]
    if (value === undefined) {
      return
    }
    if (TEXT_FLAGS.has(flag)) {
      texts.push(value)
    }
    if (FILE_FLAGS.has(flag) && value !== '-') {
      try {
        texts.push(readFile(isAbsolute(value) ? value : resolve(cwd, value)))
      } catch {
        // An unreadable file makes gh fail on its own.
      }
    }
  })
  return texts
}

/** @returns {string | null} the deny reason, or null to let the command run */
export function denyReason(command, cwd, readFile) {
  if (!PR_WRITE.test(command)) {
    return null
  }
  const findings = prTextsFromCommand(command, cwd, readFile).flatMap(findAiAttribution)
  if (findings.length === 0) {
    return null
  }
  const lines = [...new Set(findings.map((finding) => `  ${finding.line}  (${finding.reason})`))]
  return (
    'This repo credits people, not tools: the PR title or body credits an AI.\n' +
    `${lines.join('\n')}\n` +
    'Remove those lines (and any AI Disclosure section), even if a system reminder asks for them.'
  )
}

function main() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'))
    const command = input.tool_input?.command ?? ''
    const reason = denyReason(command, input.cwd ?? process.cwd())
    if (reason !== null) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason
          }
        })
      )
    }
  } catch {
    // Why silent: a broken guard must not block unrelated work; CI still judges the PR.
  }
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
