import { teamOffice3dLayoutOf } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/shared/team-scene/team-office3d-layout'
import { office3dStage } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/renderer/src/components/team-scene/team-office3d-stage'
import { dioramaRenderer } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/renderer/src/components/team-scene/team-diorama-stage'

const q = new URLSearchParams(location.search)
const dark = q.get('theme') === 'dark'
const width = Number(q.get('w') ?? 350)
document.documentElement.classList.toggle('dark', dark)
document.body.style.background = dark ? '#0a0a0b' : '#ffffff'
const host = (name: string) => (name ? { kind: 'remote', name, environmentId: 'e-' + name, reachable: name !== 'gpu-box' } : { kind: 'local' })
const floor = (key: string, keys: string[], decided: boolean, reachable = true, taken = 0) => ({
  key, host: host(key), members: keys.map((paneKey) => ({ paneKey, decisions: decided ? [{ id: 'd', verdict: 'allow', gesture: null }] : [] })),
  cap: 5, running: keys.length, reachable, lead: key === '', taken, free: 5 - keys.length - taken
})
const site = { stage: 2, broken: false }
const m = (key: string, activity: string, over = {}) => ({ key, name: key, characterKey: null, activity, reportId: null, mergedPr: null, site, ...over })
const members = [m('a', 'working'), m('b', 'resting'), m('c', 'done'), m('d', 'needsYou'), m('e', 'working', { ci: 'failure' }), m('f', 'working')]
const layout = teamOffice3dLayoutOf([floor('', ['a', 'b', 'c'], false, true, 1), floor('m2-studio', ['d', 'e'], true), floor('gpu-box', ['f'], false, false)] as never, { leadAdvisor: true })
const status = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const canvas = document.querySelector('canvas')!
const stage = office3dStage(dioramaRenderer(canvas, true)!, {
  width, dark, status, layout, pace: 'normal',
  input: { lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' }, advisor: { line: null }, members } as never,
  words: { thisMachine: 'This Mac', offline: 'Offline' }
})
stage.draw(Number(q.get('t') ?? 9))
;(window as never as { done: boolean }).done = true
