/**
 * Local oxlint plugin, ported from typeonce-dev/ai-automation (rules/oxlint,
 * profile `effect`).
 *
 * Two rules from that profile map onto this repo's boundaries:
 *  - no-silent-error-swallow: an error must reach the Effect error channel,
 *    a tagged error, or a logger.
 *  - no-direct-fetch: HTTP calls belong behind an Effect platform client.
 *
 * Precision beats recall here: `oxlint --fix` runs in the pre-commit hook, so a
 * false positive blocks every commit. Both rules stay silent when they cannot
 * prove the error is discarded.
 */

/** Node types that only wrap an inner expression and carry no meaning here. */
const transparentWrappers = new Set([
  'ParenthesizedExpression',
  'ChainExpression',
  'TSNonNullExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSInstantiationExpression'
])

const unwrap = (node) => {
  let current = node
  while (current && transparentWrappers.has(current.type)) current = current.expression
  return current
}

const isIdentifier = (node, name) => {
  const unwrapped = unwrap(node)
  return unwrapped?.type === 'Identifier' && unwrapped.name === name
}

const isFunctionExpression = (node) =>
  node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionExpression'

/** `Effect.void` / `Effect.unit` — upstream's marker for a discarded error. */
const voidOrUnitMethods = new Set(['void', 'unit'])

const isMemberCallee = ({ node, names }) => {
  const unwrapped = unwrap(node)
  return (
    unwrapped?.type === 'MemberExpression' &&
    unwrapped.computed !== true &&
    unwrapped.property?.type === 'Identifier' &&
    names.has(unwrapped.property.name)
  )
}

const isEffectVoidOrUnit = (node) =>
  isMemberCallee({ node, names: voidOrUnitMethods }) &&
  isIdentifier(unwrap(node).object, 'Effect')

/** Walk a subtree with oxlint's visitor keys, so `parent` links never cycle. */
const someDescendant = ({ node, visitorKeys, predicate }) => {
  const stack = [node]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === null || current === undefined || typeof current !== 'object')
      continue
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item)
      continue
    }
    if (typeof current.type !== 'string') continue
    if (predicate(current)) return true
    for (const key of visitorKeys[current.type] ?? []) stack.push(current[key])
  }
  return false
}

/**
 * `true` when the identifier resolves to a declaration in the file (variable,
 * parameter, function, class, or import). Scope-based rather than
 * `sourceCode.isGlobalReference`, which only answers `true` for names the
 * config declares in `env`/`globals`.
 */
const resolvesToLocalBinding = ({ context, node }) => {
  let scope = context.sourceCode.getScope(node)
  while (scope !== null && scope !== undefined) {
    const variable = scope.set.get(node.name)
    if (variable !== undefined && variable.defs.length > 0) return true
    scope = scope.upper
  }
  return false
}

const noSilentErrorSwallowMessage =
  'Do not swallow this error. Pass it to a tagged error, the Effect error channel, or the logger.'

/**
 * Methods whose handler receives the error. `catch` is matched on any receiver
 * (promise `.catch`, `Effect.catch`); the rest are Effect-specific enough that
 * any receiver is safe to match.
 */
const errorHandlerMethods = new Set([
  'catch',
  'catchAll',
  'catchAllCause',
  'catchAllDefect',
  'catchCause',
  'catchIf',
  'catchReason',
  'catchReasons',
  'catchSome',
  'catchTag',
  'catchTags'
])

/** Calls that prove the catch body did something with the failure. */
const loggingMethods = new Set([
  'annotateLogs',
  'captureException',
  'captureEvent',
  'captureMessage',
  'debug',
  'die',
  'dieMessage',
  'error',
  'fail',
  'failCause',
  'fatal',
  'info',
  'log',
  'logDebug',
  'logError',
  'logFatal',
  'logInfo',
  'logTrace',
  'logWarning',
  'trace',
  'warn'
])

const loggingFunctions = new Set([
  'captureException',
  'die',
  'fail',
  'log',
  'logDebug',
  'logError',
  'logFatal',
  'logInfo',
  'logWarning',
  'reportError'
])

/** Rightmost name of a callee: `fail` for both `fail()` and `Effect.fail()`. */
const calleeName = (node) => {
  const callee = unwrap(node)
  if (callee?.type === 'Identifier') return callee.name
  if (callee?.type === 'MemberExpression' && callee.property?.type === 'Identifier')
    return callee.property.name
  return null
}

const isRescueSignal = (node) => {
  if (node.type === 'ThrowStatement') return true
  if (node.type === 'NewExpression') {
    // `new WebhookDeliveryError()` — the catch replaces the error with a tagged one.
    const name = calleeName(node.callee)
    if (name !== null && /(?:Error|Exception|Failure|Defect)$/.test(name)) return true
  }
  if (node.type !== 'CallExpression') return false
  const callee = unwrap(node.callee)
  if (callee?.type === 'Identifier' && loggingFunctions.has(callee.name)) return true
  return isMemberCallee({ node: callee, names: loggingMethods })
}

/** Parameter bindings introduced by `node`, in source order. */
const parameterVariables = ({ context, node }) =>
  context.sourceCode
    .getDeclaredVariables(node)
    .filter((variable) => variable.defs.some((def) => def.type === 'Parameter'))

/**
 * A leading underscore is the opt-out: `.catch((_error) => fallback)` says the
 * discard is deliberate, the same convention as unused-variable rules.
 */
const isDeliberatelyIgnored = (variable) => variable.name.startsWith('_')

const handlerDiscardsError = ({ context, node }) => {
  if (!isFunctionExpression(node)) return false

  // Upstream's core check: the handler collapses to `Effect.void` / `Effect.unit`.
  if (isEffectVoidOrUnit(node.body)) return true
  if (node.body?.type === 'BlockStatement' && node.body.body.length === 1) {
    const [statement] = node.body.body
    if (statement.type === 'ReturnStatement' && isEffectVoidOrUnit(statement.argument))
      return true
  }

  // No parameter at all: the error cannot have been used.
  if (node.params.length === 0) return true

  const parameters = parameterVariables({ context, node })
  const [errorParameter] = parameters
  if (errorParameter === undefined) return false
  if (isDeliberatelyIgnored(errorParameter)) return false
  return errorParameter.references.length === 0
}

const noSilentErrorSwallow = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Errors must reach the Effect error channel, a tagged error, or a logger.'
    }
  },
  create(context) {
    const { visitorKeys } = context.sourceCode
    const report = (node) =>
      context.report({ node, message: noSilentErrorSwallowMessage })

    const reportIfHandlerDiscards = (argument) => {
      if (handlerDiscardsError({ context, node: argument })) {
        report(argument)
        return
      }
      // `Effect.catchTags({ TagA: () => Effect.void })`
      if (argument?.type !== 'ObjectExpression') return
      for (const property of argument.properties) {
        if (
          property.type === 'Property' &&
          handlerDiscardsError({ context, node: property.value })
        )
          report(property.value)
      }
    }

    return {
      CatchClause(node) {
        if (node.body.body.length === 0) {
          report(node)
          return
        }
        if (node.param !== null && node.param !== undefined) {
          const bound = context.sourceCode.getDeclaredVariables(node)
          if (bound.some((variable) => variable.references.length > 0)) return
          if (bound.some(isDeliberatelyIgnored)) return
        }
        // The binding is absent or unused: accept the catch only if the body
        // logs, rethrows, or builds a tagged error.
        if (someDescendant({ node: node.body, visitorKeys, predicate: isRescueSignal }))
          return
        report(node)
      },
      CallExpression(node) {
        if (!isMemberCallee({ node: node.callee, names: errorHandlerMethods })) return
        for (const argument of node.arguments) reportIfHandlerDiscards(argument)
      }
    }
  }
}

const noDirectFetchMessage =
  'Do not call fetch directly. Use an Effect HttpClient or a dedicated platform adapter.'

/** Receivers that can only mean the global object. */
const globalReceivers = new Set(['global', 'globalThis', 'self', 'window'])

const noDirectFetch = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'HTTP requests must go through an Effect platform client, not global fetch.'
    }
  },
  create(context) {
    const report = (node) => context.report({ node, message: noDirectFetchMessage })

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee)

        if (callee?.type === 'Identifier' && callee.name === 'fetch') {
          // A local `const fetch = ...`, a parameter, or an import named
          // `fetch` is a different function; only the global is banned.
          if (!resolvesToLocalBinding({ context, node: callee })) report(node)
          return
        }

        if (
          callee?.type === 'MemberExpression' &&
          callee.computed !== true &&
          callee.property?.type === 'Identifier' &&
          callee.property.name === 'fetch'
        ) {
          const receiver = unwrap(callee.object)
          if (
            receiver?.type === 'Identifier' &&
            globalReceivers.has(receiver.name) &&
            !resolvesToLocalBinding({ context, node: receiver })
          )
            report(node)
        }
      }
    }
  }
}

export default {
  meta: { name: 'automation' },
  rules: {
    'no-silent-error-swallow': noSilentErrorSwallow,
    'no-direct-fetch': noDirectFetch
  }
}
