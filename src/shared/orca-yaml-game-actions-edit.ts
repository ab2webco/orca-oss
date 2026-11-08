import { isMap, isSeq, parseDocument } from 'yaml'
import { isOrcaYamlTextWithinLimit } from './orca-yaml-file-limit'
import type { OrchestratorGameAction } from './orchestrator-game-actions'
import { isSameGameAction } from './orchestrator-game-machine-actions'

export type OrcaYamlEdit =
  | { ok: true; text: string }
  | { ok: false; reason: 'invalid' | 'too-large' }

/** orca.yaml's text with only `orchestratorGame.actions` replaced; every other line and comment
 *  stays, so hook trust, which hashes script text, is untouched. */
export function withOrcaYamlGameActions(
  text: string,
  actions: OrchestratorGameAction[]
): OrcaYamlEdit {
  const document = parseDocument(text, { uniqueKeys: true })
  const game = document.getIn(['orchestratorGame'])
  const isMapping = (node: unknown): boolean => node === null || node === undefined || isMap(node)
  if (document.errors.length > 0 || !isMapping(document.contents) || !isMapping(game)) {
    return { ok: false, reason: 'invalid' }
  }
  if (actions.length > 0) {
    const was = document.getIn(['orchestratorGame', 'actions'])
    const kept = isSeq(was) ? was.items : []
    // Why reuse a node: an action left as it was keeps its own comments and flow style.
    const items = actions.map(
      (action) =>
        kept.find((node) =>
          isSameGameAction((node as { toJSON?: () => unknown }).toJSON?.(), action)
        ) ?? document.createNode(action)
    )
    document.setIn(['orchestratorGame', 'actions'], document.createNode(items))
  } else {
    document.deleteIn(['orchestratorGame', 'actions'])
  }
  const next = document.toString()
  return isOrcaYamlTextWithinLimit(next)
    ? { ok: true, text: next }
    : { ok: false, reason: 'too-large' }
}
