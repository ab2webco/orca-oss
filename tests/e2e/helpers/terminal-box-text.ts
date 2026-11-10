/**
 * The text inside each rounded box (`╭─╮ │ │ ╰─╯`) on a terminal screen, top to bottom, with a
 * box's wrapped rows joined by one space. Only the columns between a box's borders count, so
 * whatever the pane draws beside the box stays out of its text.
 */
export function boxedTexts(rows: readonly string[]): string[] {
  const texts: string[] = []
  rows.forEach((row, top) => {
    for (let left = row.indexOf('╭'); left !== -1; left = row.indexOf('╭', left + 1)) {
      const right = row.indexOf('╮', left)
      if (right === -1) {
        continue
      }
      const lines: string[] = []
      for (let line = top + 1; line < rows.length; line += 1) {
        const inside = rows[line]!
        if (inside[left] !== '│' || inside[right] !== '│') {
          break
        }
        lines.push(inside.slice(left + 1, right).trim())
      }
      texts.push(lines.filter(Boolean).join(' '))
    }
  })
  return texts
}
