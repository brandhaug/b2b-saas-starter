import { defineRule, type ESTree } from '@oxlint/plugins'
import {
  getPropertyName,
  isIdentifier,
  parentOf,
  unwrapExpression
} from '../internal/ast.ts'

/**
 * Reports reading `.message` off, or calling `String()` on, a value named like a
 * caught failure. Both are the same mistake: an `unknown` gets flattened into a
 * sentence at the point it is caught, so the typed failure is gone and every call
 * site re-derives the same `instanceof Error` probe.
 *
 * `apps/web/src/lib/cause-message.ts` is the sanctioned reader in the web app, and
 * the package-private normalizers named in the root `vite.config.ts` lint
 * overrides are each their own
 * package's typed boundary. Everywhere else, keep the failure in the Effect error
 * channel and match on its tag.
 *
 * Handler parameters of `Effect.catchTag` and `Effect.catchTags` are exempt: those
 * are already narrowed to one tagged error, so reading `.message` there is a typed
 * read rather than a probe.
 *
 * Ported from github.com/UsefulSoftwareCo/executor,
 * scripts/oxlint-plugin-executor/rules/no-unknown-error-message.js (MIT).
 */

const FAILURE_NAMES = new Set(['cause', 'e', 'err', 'error', 'reason', 'unknownError'])

const STRING_MESSAGE =
  'Do not stringify an unknown failure. Keep it in the Effect error channel and match on its tag, or call `causeMessage(thrown, fallback)` if this is a UI boundary that needs one sentence.'
const MEMBER_MESSAGE =
  'Do not read `.message` off an unknown failure. Match on the tagged error instead, or call `causeMessage(thrown, fallback)` if this is a UI boundary that needs one sentence.'
const DESTRUCTURE_MESSAGE =
  'Do not destructure `message` out of an unknown failure. Match on the tagged error instead, or call `causeMessage(thrown, fallback)` if this is a UI boundary that needs one sentence.'

function identifierName(node: ESTree.Node | null | undefined): string | undefined {
  const expression = unwrapExpression(node)
  if (expression === undefined) {
    return undefined
  }
  if (expression.type !== 'Identifier') {
    return undefined
  }
  return expression.name
}

function isFailureNamed(node: ESTree.Node | null | undefined): boolean {
  const name = identifierName(node)
  if (name === undefined) {
    return false
  }
  return FAILURE_NAMES.has(name)
}

function calleeName(node: ESTree.Node | null | undefined): string | undefined {
  const expression = unwrapExpression(node)
  if (expression === undefined) {
    return undefined
  }
  if (expression.type === 'Identifier') {
    return expression.name
  }
  if (expression.type === 'MemberExpression') {
    return getPropertyName(expression.property)
  }
  return undefined
}

/**
 * True when `node` is the function passed as `Effect.catchTag(tag, handler)`, or a
 * handler in the object `Effect.catchTags({ Tag: handler })`.
 */
function isTagHandler(node: ESTree.Node): boolean {
  const parent = parentOf(node)
  if (parent === undefined) {
    return false
  }

  if (
    parent.type === 'CallExpression' &&
    parent.arguments[1] === node &&
    calleeName(parent.callee) === 'catchTag'
  ) {
    return true
  }

  if (parent.type !== 'Property') {
    return false
  }
  const object = parentOf(parent)
  if (object?.type !== 'ObjectExpression') {
    return false
  }
  const call = parentOf(object)
  if (call?.type !== 'CallExpression') {
    return false
  }
  return calleeName(call.callee) === 'catchTags'
}

/**
 * True when the identifier resolves to the first parameter of the nearest enclosing
 * tag handler, so it is already narrowed to a single tagged error.
 */
function isTagHandlerParameter(node: ESTree.Node | null | undefined): boolean {
  const name = identifierName(node)
  if (name === undefined) {
    return false
  }

  if (node === null || node === undefined) {
    return false
  }
  let current = parentOf(node)
  while (current !== undefined) {
    if (
      current.type === 'ArrowFunctionExpression' ||
      current.type === 'FunctionExpression'
    ) {
      if (!isTagHandler(current)) {
        return false
      }
      return isIdentifier(current.params[0], name)
    }
    current = parentOf(current)
  }
  return false
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow stringifying an unknown failure or reading its message outside the sanctioned normalizers.'
    }
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isIdentifier(unwrapExpression(node.callee), 'String')) {
          return
        }
        if (!node.arguments.some((argument) => isFailureNamed(argument))) {
          return
        }
        context.report({ node, message: STRING_MESSAGE })
      },
      MemberExpression(node) {
        if (getPropertyName(node.property) !== 'message') {
          return
        }
        if (!isFailureNamed(node.object)) {
          return
        }
        if (isTagHandlerParameter(node.object)) {
          return
        }
        context.report({ node, message: MEMBER_MESSAGE })
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'ObjectPattern') {
          return
        }
        if (!isFailureNamed(node.init)) {
          return
        }
        if (isTagHandlerParameter(node.init)) {
          return
        }
        for (const property of node.id.properties) {
          if (property.type !== 'Property') {
            continue
          }
          if (getPropertyName(property.key) !== 'message') {
            continue
          }
          context.report({ node: property, message: DESTRUCTURE_MESSAGE })
        }
      }
    }
  }
})
