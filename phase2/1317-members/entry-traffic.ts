import { teamOffice3dLayoutOf } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/shared/team-scene/team-office3d-layout'
import { office3dStage } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/renderer/src/components/team-scene/team-office3d-stage'
import { office3dTraffic, office3dTrafficRead } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/shared/team-scene/team-office3d-traffic'
import { dioramaView } from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/src/renderer/src/components/team-scene/team-diorama-view'
import * as THREE from '/Users/fabolivar/orca/workspaces/orca-oss/orca-1302/node_modules/three'
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
const members = [m('a', 'working'), m('b', 'resting'), m('c', 'done'), m('d', 'needsYou'), m('e', 'working', { ci: 'failure' }), m('f', 'working'), m('g', 'resting'), m('h', 'resting')]
const layout = teamOffice3dLayoutOf([floor('', ['a', 'b', 'c', 'g', 'h'], false, true, 0), floor('m2-studio', ['d', 'e'], true), floor('gpu-box', ['f'], false, false)] as never, { leadAdvisor: true })
const traffic = office3dTraffic()
const input0 = { lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' }, advisor: { line: null }, members: members.map((x) => ({ ...x, activity: 'working', ci: undefined })) } as never
const input1 = { lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' }, advisor: { line: null }, members } as never
officeRead()
function officeRead() {
  office3dTrafficRead(traffic, layout, input0, 0, 'normal')
  office3dTrafficRead(traffic, layout, input1, 1, 'normal')
}
const status = { attention: '#e40014', done: '#15803d', working: '#0369a1', risk: '#b45309' }
const canvas = document.querySelector('canvas')!
const view = dioramaView()
const at = (q.get('at') ?? '0,0,0').split(',').map(Number)
view.mode = (q.get('mode') ?? 'all') as never
const stage = office3dStage(dioramaRenderer(canvas, true)!, {
  width, dark, status, layout, pace: 'normal',
  input: { lead: { key: 'lead', name: 'Lead', characterKey: null, activity: 'working' }, advisor: { line: null }, members } as never,
  words: { thisMachine: 'This computer', offline: 'Offline' },
  view,
  traffic,
  maxHeight: Number(q.get('h') ?? 760)
})
stage.draw(0)
;(window as never as { drawAt: (t: number) => void }).drawAt = (t) => stage.draw(t)
;(window as never as { done: boolean }).done = true
