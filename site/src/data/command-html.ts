// A shown command as HTML with each flag and short word kept whole: a wrapped block must never split
// `--ticket` after `--` or `task-create` at its hyphen. A long argument may still break, so it cannot
// push past a phone's edge.
const escape = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const commandHtml = (line: string): string =>
  escape(line)
    .split(' ')
    .map((word) =>
      word.startsWith('--') || word.length <= 20 ? `<span class="nowrap">${word}</span>` : word
    )
    .join(' ')
