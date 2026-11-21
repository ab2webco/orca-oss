import { office3dFloorOnly, teamOffice3dLayoutOf } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/shared/team-scene/team-office3d-layout'
import { office3dStage, type Office3dStage } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/renderer/src/components/team-scene/team-office3d-stage'
import { dioramaRenderer } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/renderer/src/components/team-scene/team-diorama-stage'

const q = new URLSearchParams(location.search)
let dark = q.get('theme') === 'dark' || (!q.get('theme') && matchMedia('(prefers-color-scheme: dark)').matches)
const host = (name: string) => (name ? { kind: 'remote', name, environmentId: 'e-' + name, reachable: name !== 'gpu-box' } : { kind: 'local' })
const floor = (key: string, keys: string[], decided: boolean, reachable = true, taken = 0) => ({
  key, host: host(key), members: keys.map((paneKey) => ({ paneKey, decisions: decided ? [{ id: 'd', verdict: 'allow', gesture: null }] : [] })),
  cap: 5, running: keys.length, reachable, lead: key === '', taken, free: 5 - keys.length - taken
})
const site = { stage: 2, broken: false }
const m = (key: string, activity: string, over = {}) => ({ key, name: key, characterKey: null, activity, reportId: null, mergedPr: null, site, ...over })
const members = [m('ada', 'working'), m('bo', 'resting'), m('cy', 'done'), m('di', 'needsYou'), m('ed', 'working', { ci: 'failure' }), m('fi', 'working')]
const full = teamOffice3dLayoutOf([floor('', ['ada', 'bo', 'cy'], false, true, 1), floor('m2-studio', ['di', 'ed'], true), floor('gpu-box', ['fi'], false, false)] as never, { leadAdvisor: true })
const input = { lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' }, advisor: { line: null }, members } as never
const status = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const canvas = document.querySelector('canvas')!
const renderer = dioramaRenderer(canvas, true)!
const chips = document.getElementById('chips')!
// The asker's floor first: the phone opens where someone needs you.
let shown = 'm2-studio'
let stage: Office3dStage | null = null
const label = (k: string) => (k === '' ? "Lead's machine" : k)
const paint = () => {
  document.documentElement.classList.toggle('dark', dark)
  stage?.dispose()
  stage = office3dStage(renderer, { width: canvas.parentElement!.clientWidth, dark, status, input, layout: office3dFloorOnly(full, shown), pace: 'normal', maxHeight: 300, words: { thisMachine: "Lead's machine", offline: 'Offline' } })
  chips.innerHTML = ''
  for (const f of full.floors) {
    const b = document.createElement('button')
    b.textContent = label(f.key) + (f.reachable ? '' : ' · offline')
    b.setAttribute('aria-pressed', String(f.key === shown))
    b.onclick = () => { shown = f.key; paint() }
    chips.appendChild(b)
  }
}
paint()
document.getElementById('theme')!.onclick = () => { dark = !dark; paint() }
const loop = () => { stage?.draw(performance.now() / 1000); requestAnimationFrame(loop) }
if (q.get('still')) stage!.draw(Number(q.get('still'))); else loop()
;(window as never as { done: boolean }).done = true
;(window as never as { pick: (k: string) => void }).pick = (k) => { shown = k; paint(); if (q.get('still')) stage!.draw(Number(q.get('still'))) }
