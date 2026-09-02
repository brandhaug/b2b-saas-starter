import { defineRule, type ESTree } from '@oxlint/plugins'
import {
  getPropertyName,
  isCalleeOfEnclosingCall,
  schemaMemberAccess,
  unwrapExpression
} from '../internal/ast.ts'

/**
 * Catches Effect Schema decoder and encoder compilers called inside a function
 * body, for example `Schema.decodeUnknownResult(Message)(input)`. Compiling a
 * codec allocates a new function, so a compiler on a request path or a queue
 * consumer rebuilds it on every call.
 *
 * The starter is a reference implementation, so the hot-path shape it shows has
 * to be the correct one: compile once at module scope, call the result.
 *
 * Ported from oxlint-plugin-t3code/rules/no-inline-schema-compile.ts (MIT).
 */

const COMPILER_METHODS = new Set([
  'is',
  'asserts',
  'decodeEffect',
  'decodeExit',
  'decodeOption',
  'decodePromise',
  'decodeResult',
  'decodeSync',
  'decodeUnknownExit',
  'decodeUnknownEffect',
  'decodeUnknownOption',
  'decodeUnknownPromise',
  'decodeUnknownResult',
  'decodeUnknownSync',

  'encodeExit',
  'encodeEffect',
  'encodeOption',
  'encodePromise',
  'encodeResult',
  'encodeSync',
  'encodeUnknownExit',
  'encodeUnknownEffect',
  'encodeUnknownOption',
  'encodeUnknownPromise',
  'encodeUnknownResult',
  'encodeUnknownSync'
])

function getSchemaCompilerMethod(
  callee: ESTree.Node | null | undefined
): string | undefined {
  const access = schemaMemberAccess(callee)
  if (access === undefined) {
    return undefined
  }

  const method = getPropertyName(access.property)
  if (method === undefined || !COMPILER_METHODS.has(method)) {
    return undefined
  }
  return method
}

/**
 * A schema that could live at module scope: a capitalised binding (the repo's
 * schema naming) or a namespaced member. A lower-case binding is usually a
 * parameter or a locally built codec, which cannot be hoisted.
 */
function isStaticSchemaReference(node: ESTree.Node | null | undefined): boolean {
  const expression = unwrapExpression(node)
  if (expression === undefined) {
    return false
  }

  if (expression.type === 'Identifier') {
    const [firstCharacter] = expression.name
    if (firstCharacter === undefined) {
      return false
    }
    return firstCharacter.toUpperCase() === firstCharacter
  }

  return expression.type === 'MemberExpression'
}

/** An inline `Schema.*(...)` literal, including `Schema.fromJsonString(Static)`. */
function isNestedStaticSchemaCall(node: ESTree.Node | null | undefined): boolean {
  const expression = unwrapExpression(node)
  if (expression?.type !== 'CallExpression') {
    return false
  }

  const access = schemaMemberAccess(expression.callee)
  if (access === undefined) {
    return false
  }

  if (getPropertyName(access.property) !== 'fromJsonString') {
    return true
  }

  const [firstArgument] = expression.arguments
  return (
    isStaticSchemaReference(firstArgument) || isNestedStaticSchemaCall(firstArgument)
  )
}

function inlineSchemaMessage(method: string) {
  return `Hoist Schema.${method}(...) to module scope. Both the inline schema and the compiled function are rebuilt on every call, so move the compiled function to a module-level const.`
}

function compilerMessage(method: string) {
  return `Hoist Schema.${method}(...) to module scope. The compiled function is rebuilt on every call, so bind it to a module-level const and call that.`
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Schema decoder and encoder compiler calls inside function bodies; hoist them to module scope.'
    }
  },
  createOnce(context) {
    let functionDepth = 0

    function resetFunctionDepth() {
      functionDepth = 0
    }

    function enterFunction() {
      functionDepth += 1
    }

    function exitFunction() {
      functionDepth -= 1
    }

    return {
      before: resetFunctionDepth,
      FunctionDeclaration: enterFunction,
      'FunctionDeclaration:exit': exitFunction,
      FunctionExpression: enterFunction,
      'FunctionExpression:exit': exitFunction,
      ArrowFunctionExpression: enterFunction,
      'ArrowFunctionExpression:exit': exitFunction,
      CallExpression(node) {
        if (functionDepth === 0) {
          return
        }

        const method = getSchemaCompilerMethod(node.callee)
        if (method === undefined) {
          return
        }
        // Only the `compile(...)(input)` shape rebuilds per call. A bare
        // `const decode = Schema.decodeSync(X)` inside a factory compiles once
        // and is reused by the returned function — the shape this rule steers to.
        if (!isCalleeOfEnclosingCall(node)) {
          return
        }

        const [firstArgument] = node.arguments
        const inlineSchema = isNestedStaticSchemaCall(firstArgument)
        if (!inlineSchema && !isStaticSchemaReference(firstArgument)) {
          return
        }

        if (inlineSchema) {
          context.report({ node: node.callee, message: inlineSchemaMessage(method) })
          return
        }
        context.report({ node: node.callee, message: compilerMessage(method) })
      }
    }
  }
})
