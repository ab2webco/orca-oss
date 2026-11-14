// Why: Electron 43's V8 inspector holds an evaluate's awaited answer only weakly, so a GC turns a
// settings write that succeeded into "Execution context was destroyed" (ORCA-895, ORCA-1155).
const EVALUATE_NAMES = new Set(['evaluate', 'evaluateHandle', 'waitForFunction'])
const PROMISE_CHAIN_NAMES = new Set(['then', 'catch', 'finally'])
const TRANSPARENT_TYPES = new Set([
  'ChainExpression',
  'TSNonNullExpression',
  'TSAsExpression',
  'ParenthesizedExpression',
  'ConditionalExpression',
  'LogicalExpression'
])

function memberName(node) {
  return node?.type === 'MemberExpression' && !node.computed ? node.property.name : null
}

function isSettingsWrite(call) {
  const callee = call.callee.type === 'ChainExpression' ? call.callee.expression : call.callee
  const name = memberName(callee)
  if (name === 'updateSettings') {
    return true
  }
  return (
    name === 'set' &&
    memberName(callee.object) === 'settings' &&
    memberName(callee.object.object) === 'api'
  )
}

/** True when the write's promise is what the enclosing code awaits or returns. */
function isHeld(call) {
  let node = call
  for (;;) {
    const parent = node.parent
    if (TRANSPARENT_TYPES.has(parent.type)) {
      node = parent
      continue
    }
    const chained = parent.parent
    if (
      parent.type === 'MemberExpression' &&
      parent.object === node &&
      PROMISE_CHAIN_NAMES.has(memberName(parent)) &&
      chained?.type === 'CallExpression' &&
      chained.callee === parent
    ) {
      node = chained
      continue
    }
    break
  }
  const parent = node.parent
  return (
    parent.type === 'AwaitExpression' ||
    parent.type === 'ReturnStatement' ||
    (parent.type === 'ArrowFunctionExpression' && parent.body === node)
  )
}

function isInsideEvaluate(node) {
  for (let current = node.parent; current; current = current.parent) {
    const isFunction =
      current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression'
    const call = current.parent
    if (
      isFunction &&
      call?.type === 'CallExpression' &&
      call.arguments[0] === current &&
      EVALUATE_NAMES.has(memberName(call.callee))
    ) {
      return true
    }
  }
  return false
}

function createRule(context) {
  return {
    CallExpression(node) {
      if (!isSettingsWrite(node) || !isHeld(node) || !isInsideEvaluate(node)) {
        return
      }
      context.report({
        node,
        message:
          'A settings write awaited or returned inside an evaluate can lose its answer to a GC on Electron 43 (ORCA-895): use writeSettings from tests/e2e/helpers/settings-write.ts.'
      })
    }
  }
}

export default {
  meta: { name: 'e2e-settings-write' },
  rules: {
    'no-held-write-in-evaluate': { create: createRule }
  }
}
