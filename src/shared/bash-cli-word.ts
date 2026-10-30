import { quotePosixShell } from './wsl-login-shell-command'

const BASH_SAFE_WORD = /^[A-Za-z0-9_./:@%+=,-]+$/

export const bashWord = (word: string): string =>
  BASH_SAFE_WORD.test(word) ? word : quotePosixShell(word)

// Why: the lead runs these in Claude Code's Bash tool, Git Bash on Windows, where `\` escapes and a space splits.
export const bashWordOfCli = (cli: string): string =>
  bashWord(/^[A-Za-z]:\\/.test(cli) ? cli.replaceAll('\\', '/') : cli)
