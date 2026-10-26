const fs = require('node:fs')

// Repaints a real Claude Code screen captured with the orca-game Panel at this pane's size, with
// Claude's mouse reporting on. Usage: node claude-dock-frame.cjs <claude-dock-captures.json>
const captures = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const ESC = '\x1b'
// Claude Code docks a pane beside the transcript from 110 columns; below that it sits inline.
const DOCK_FLOOR = 110
const isRule = (line) => /^─+$/.test(line)

function frameOf(cols, rows) {
  const isDocked = cols >= DOCK_FLOOR
  const capture = isDocked ? captures.panel1440 : captures.panel768
  const ruleRow = capture.lines.findIndex(isRule)
  const border = isDocked ? capture.lines[0].indexOf('│') : -1
  const transcriptWidth = cols - (capture.cols - border)
  const besideDock = (line) => line.slice(0, border).padEnd(transcriptWidth) + line.slice(border)
  const lines = capture.lines.map((line, y) => {
    if (isRule(line)) {
      return '─'.repeat(cols)
    }
    return isDocked && y < ruleRow ? besideDock(line) : line.slice(0, cols)
  })
  // Taller panes get blank chat rows under the top one, so a dock still runs from row 0.
  const filler = isDocked ? besideDock(`${' '.repeat(border)}│`) : ''
  const extra = Array(Math.max(0, rows - capture.rows)).fill(filler)
  return [lines[0], ...extra, ...lines.slice(1 + Math.max(0, capture.rows - rows))]
}

function render() {
  const cols = process.stdout.columns || 80
  const rows = process.stdout.rows || 24
  const painted = frameOf(cols, rows).map((line, y) => `${ESC}[${y + 1};1H${line.trimEnd()}`)
  process.stdout.write(`${ESC}[2J${painted.join('')}`)
}

process.stdout.write(`${ESC}[?1049h${ESC}[?25l${ESC}[?1003h${ESC}[?1006h`)
render()
process.stdout.on('resize', render)
process.stdin.setRawMode?.(true)
process.stdin.on('data', (chunk) => {
  if (!chunk.toString('utf8').includes('q')) {
    return
  }
  process.stdout.write(`${ESC}[?1006l${ESC}[?1003l${ESC}[?25h${ESC}[?1049l`)
  process.exit(0)
})
