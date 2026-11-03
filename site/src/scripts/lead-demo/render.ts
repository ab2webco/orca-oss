// Renders one Frame of the hero Panel to HTML. Used by Astro for the server-rendered
// still frame and by the client script for every step, so both always match.
import { type Frame, type LogKey, type Member, type Source, type Ticket, xpProgress } from './data'

export type DemoCopy = {
  window: string
  level: string
  todo: string
  members: string
  waveCmd: string
  promptIdle: string
  state: Record<Member['state'], string>
  ci: Record<Member['ci'], string>
  merged: string
  levelUp: string
  log: Record<LogKey, string>
  phoneTitle: string
  phoneFrom: string
  question: string
  options: [string, string]
  answered: string
  titles: Record<string, string>
  sources: Record<Source, string>
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (value: string | number): string => String(value).replace(/[&<>"]/g, (c) => ESCAPES[c])

function sourceBadge(ticket: Ticket, copy: DemoCopy): string {
  return `<span class="src src-${ticket.source}">${esc(copy.sources[ticket.source])}</span>`
}

function todoItem(ticket: Ticket, copy: DemoCopy): string {
  return `<li class="todo-item" data-key="${esc(ticket.id)}">
    <span class="tid mono">${esc(ticket.id)}</span>${sourceBadge(ticket, copy)}
    <span class="ttitle">${esc(copy.titles[ticket.id] ?? '')}</span>
  </li>`
}

function ciPill(m: Member, copy: DemoCopy, flash: boolean): string {
  const extra = flash ? ' flash' : ''
  if (m.merged) {
    return `<span class="pill pill-merged${extra}">${esc(copy.merged)}</span>`
  }
  return `<span class="pill pill-ci-${m.ci}${extra}">${esc(copy.ci[m.ci])}</span>`
}

function memberCard(m: Member, copy: DemoCopy, isNew: boolean, before?: Member): string {
  const flash = before !== undefined && (before.ci !== m.ci || before.merged !== m.merged)
  const pr = m.pr === null ? '' : `<span class="mono">PR #${m.pr}</span>`
  return `<li class="member${isNew ? ' is-new' : ''}" data-state="${m.state}" data-key="${esc(m.ticket.id)}">
    <div class="mrow">
      <span class="dot" data-state="${m.state}"></span>
      <span class="tid mono">${esc(m.ticket.id)}</span>${sourceBadge(m.ticket, copy)}
      <span class="host mono">${esc(m.host)}</span>
    </div>
    <p class="mtitle">${esc(copy.titles[m.ticket.id] ?? '')}</p>
    <div class="mrow meta">
      <span class="branch mono">${esc(m.branch)}</span>${pr}
    </div>
    <div class="mrow foot">
      <span class="mstate">${esc(copy.state[m.state])}</span>${ciPill(m, copy, flash)}
    </div>
  </li>`
}

function logLine(entry: Frame['log'][number], copy: DemoCopy, fresh: boolean): string {
  const xp = entry.xp > 0 ? `<b class="xp-gain">+${entry.xp} XP</b>` : '<b class="xp-ask">?</b>'
  return `<li class="log-line${fresh ? ' is-fresh' : ''}">${xp}<span>${esc(copy.log[entry.key])} <span class="mono">${esc(entry.ticket)}</span></span></li>`
}

function phoneCard(frame: Frame, copy: DemoCopy): string {
  const answered = frame.phone === 'answered'
  const buttons = copy.options
    .map(
      (option, index) =>
        `<span class="opt${answered && index === 0 ? ' is-picked' : ''}">${esc(option)}</span>`
    )
    .join('')
  return `<div class="phone" data-phone="${frame.phone}" aria-hidden="${frame.phone === 'hidden'}">
    <div class="phone-notch"></div>
    <p class="phone-title"><span class="dot" data-state="question"></span>${esc(copy.phoneTitle)}</p>
    <p class="phone-from mono">${esc(copy.phoneFrom)}</p>
    <p class="phone-q">${esc(copy.question)}</p>
    <div class="opts">${buttons}</div>
    <p class="phone-done">${esc(copy.answered)}</p>
  </div>`
}

export function renderPanel(frame: Frame, copy: DemoCopy, previous?: Frame): string {
  const known = new Set(
    previous?.members.map((m) => m.ticket.id) ?? frame.members.map((m) => m.ticket.id)
  )
  const progress = Math.round(xpProgress(frame) * 100)
  const prompt =
    frame.prompt === 'wave'
      ? `<span class="caret-line"><span class="ps">›</span> <span class="typed mono">${esc(copy.waveCmd)}</span></span>`
      : `<span class="caret-line idle"><span class="ps">›</span> ${esc(copy.promptIdle)}</span>`
  return `<div class="win-bar">
      <span class="lights"><i></i><i></i><i></i></span>
      <span class="win-title mono">${esc(copy.window)}</span>
      <span class="lvl"><b>${esc(copy.level)} ${frame.level}</b><span class="xpbar"><span style="width:${progress}%"></span></span><span class="xpnum mono">${frame.xp} XP</span></span>
    </div>
    <div class="win-body">
      <section class="col-todo">
        <h3>${esc(copy.todo)} <span class="count">${frame.todo.length}</span></h3>
        <ul>${frame.todo.map((t) => todoItem(t, copy)).join('')}</ul>
        <div class="prompt">${prompt}</div>
      </section>
      <section class="col-members">
        <h3>${esc(copy.members)} <span class="count">${frame.members.length}</span></h3>
        <ul class="members">${frame.members
          .map((m) =>
            memberCard(
              m,
              copy,
              !known.has(m.ticket.id),
              previous?.members.find((p) => p.ticket.id === m.ticket.id)
            )
          )
          .join('')}</ul>
        <ul class="log">${frame.log.map((e) => logLine(e, copy, previous !== undefined && !previous.log.includes(e))).join('')}</ul>
      </section>
    </div>
    ${frame.levelUp ? `<div class="levelup">${esc(copy.levelUp)} · ${esc(copy.level)} ${frame.level}</div>` : ''}
    ${phoneCard(frame, copy)}`
}
