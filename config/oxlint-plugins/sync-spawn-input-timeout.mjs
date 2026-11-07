// Why: a sync spawn that pipes `input` blocks the whole event loop until the child
// exits; a child that never sees EOF froze `npm test` for 4 hours (ORCA-1123).
const SYNC_SPAWN_NAMES = new Set(['spawnSync', 'execFileSync', 'execSync'])

function calleeName(callee) {
  if (callee.type === 'Identifier') {
    return callee.name
  }
  if (callee.type === 'MemberExpression' && !callee.computed) {
    return callee.property.name
  }
  return null
}

function propertyKey(property) {
  if (property.type !== 'Property' || property.computed) {
    return null
  }
  if (property.key.type === 'Identifier') {
    return property.key.name
  }
  return typeof property.key.value === 'string' ? property.key.value : null
}

function disablesTimeout(value) {
  return (
    (value.type === 'Literal' && value.value === 0) ||
    (value.type === 'Identifier' && value.name === 'undefined')
  )
}

function createRule(context) {
  return {
    CallExpression(node) {
      const name = calleeName(node.callee)
      if (!SYNC_SPAWN_NAMES.has(name)) {
        return
      }
      const options = node.arguments.find((argument) => argument.type === 'ObjectExpression')
      if (!options) {
        return
      }
      const byKey = new Map(options.properties.map((property) => [propertyKey(property), property]))
      if (!byKey.has('input')) {
        return
      }
      const timeout = byKey.get('timeout')
      if (timeout && !disablesTimeout(timeout.value)) {
        return
      }
      context.report({
        node,
        message: `${name} with \`input\` needs a \`timeout\`: a child that never sees EOF blocks the event loop forever, and no test or app timer can end it.`
      })
    }
  }
}

export default {
  meta: { name: 'sync-spawn-input-timeout' },
  rules: {
    'require-timeout': { create: createRule }
  }
}
