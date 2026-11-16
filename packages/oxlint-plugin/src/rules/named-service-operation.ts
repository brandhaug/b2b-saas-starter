import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import {
  getPropertyName,
  getStringValue,
  isCalleeOfEnclosingCall,
  unwrapExpression
} from '../internal/ast.ts'
import { isEffectModuleImport } from '../internal/effect-import.ts'

type Identifier = Extract<ESTree.Node, { readonly type: 'Identifier' }>
type ObjectExpression = Extract<ESTree.Node, { readonly type: 'ObjectExpression' }>
type FunctionNode = ESTree.Function

/**
 * Catches a service implementation whose operations are bare `Effect.gen`
 * thunks, so the operation runs without the `Service.operation` span that
 * `named-effect-operation` only checks once `Effect.fn` is already there.
 *
 * An implementation is the object handed to `Tag.of(…)` or
 * `Layer.succeed(Tag)(…)`, or returned from the generator a
 * `Layer.effect(Tag)(…)` runs: an object literal, or a same-file constant
 * holding one. Only its own properties count: objects returned by operations
 * are data. The suggested label drops a trailing `Service` from the tag, as
 * the repo's span names do.
 */
export default defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        "Service implementations expose operations as named Effect.fn('Service.operation') spans, not bare Effect.gen thunks."
    }
  },
  create(context) {
    const checked = new Set<ESTree.Node>()

    function definitionOf(identifier: Identifier) {
      const reference = context.sourceCode
        .getScope(identifier)
        .references.find((candidate) => candidate.identifier === identifier)
      return reference?.resolved?.defs[0]
    }

    /** `Module.method` where `Module` resolves to the `effect` import of that name. */
    function isModuleMember(
      node: ESTree.Node | null | undefined,
      moduleName: string,
      method: string
    ): boolean {
      const member = unwrapExpression(node)
      if (member?.type !== 'MemberExpression') {
        return false
      }
      let name = getPropertyName(member.property)
      if (member.computed) {
        name = getStringValue(member.property)
      }
      const namespace = unwrapExpression(member.object)
      if (name !== method || namespace?.type !== 'Identifier') {
        return false
      }
      const definition = definitionOf(namespace)
      return (
        definition?.type === 'ImportBinding' &&
        isEffectModuleImport(definition.node, moduleName)
      )
    }

    /**
     * `Effect.gen(…)`, optionally followed by `.pipe(…)`. A pipe through
     * `Effect.withSpan` is already traced, and `effect/preferEffectFn` owns
     * that conversion.
     */
    function isGenCall(node: ESTree.Node | null | undefined): boolean {
      const call = unwrapExpression(node)
      if (call?.type !== 'CallExpression') {
        return false
      }
      if (isModuleMember(call.callee, 'Effect', 'gen')) {
        return true
      }
      const callee = unwrapExpression(call.callee)
      return (
        callee?.type === 'MemberExpression' &&
        getPropertyName(callee.property) === 'pipe' &&
        !call.arguments.some((argument) => {
          const step = unwrapExpression(argument)
          return (
            step?.type === 'CallExpression' &&
            isModuleMember(step.callee, 'Effect', 'withSpan')
          )
        }) &&
        isGenCall(callee.object)
      )
    }

    /** A same-file `const x = …` or `function x() {}` the identifier names. */
    function localValue(node: ESTree.Node | null | undefined): ESTree.Node | undefined {
      const expression = unwrapExpression(node)
      if (expression?.type !== 'Identifier') {
        return expression
      }
      const definition = definitionOf(expression)
      if (
        definition?.type === 'Variable' &&
        definition.node.type === 'VariableDeclarator'
      ) {
        return unwrapExpression(definition.node.init) ?? expression
      }
      if (definition?.type === 'FunctionName') {
        return definition.node
      }
      return expression
    }

    /** The generator body of `Effect.gen(function* () {…})`, or a same-file constant of it. */
    function generatorOf(
      node: ESTree.Node | null | undefined
    ): FunctionNode | undefined {
      const call = localValue(node)
      if (
        call?.type !== 'CallExpression' ||
        !isModuleMember(call.callee, 'Effect', 'gen')
      ) {
        return undefined
      }
      for (const argument of call.arguments) {
        const body = unwrapExpression(argument)
        if (body?.type === 'FunctionExpression' && body.generator) {
          return body
        }
      }
      return undefined
    }

    /** Objects a Layer generator returns: literal, `Tag.of(literal)` or a local of either. */
    function checkReturnedImplementations(
      node: ESTree.Node | null | undefined,
      serviceName: string
    ) {
      const generator = generatorOf(node)
      if (generator?.body?.type !== 'BlockStatement') {
        return
      }
      for (const returned of topLevelReturns(generator.body.body)) {
        const value = localValue(returned)
        if (value?.type === 'ObjectExpression') {
          checkImplementation(value, serviceName)
        }
        // `Tag.of(…)` reports through its own CallExpression visit.
      }
    }

    function checkImplementation(object: ObjectExpression, serviceName: string) {
      if (checked.has(object)) {
        return
      }
      checked.add(object)
      for (const property of object.properties) {
        if (property.type !== 'Property' || property.kind !== 'init') {
          continue
        }
        let name = getPropertyName(property.key)
        if (property.computed) {
          name = getStringValue(property.key)
        }
        if (name === undefined) {
          continue
        }
        const form = untracedForm(localValue(property.value))
        if (form === undefined) {
          continue
        }
        const label = `${serviceName}.${name}`
        let replacement = `${name}: Effect.fn('${label}')(function* (…) { … })`
        if (form === 'effect') {
          replacement = `${name}: Effect.fn('${label}')(function* () { … })()`
        }
        context.report({
          node: property,
          message: `Service operation '${name}' runs a bare Effect.gen with no span. Use ${replacement}, with the same label as the sibling Seed/Live adapter. A deliberately untraced operation uses Effect.fnUntraced with a reasoned suppression.`
        })
      }
    }

    function untracedForm(
      value: ESTree.Node | undefined
    ): 'effect' | 'function' | undefined {
      if (value === undefined) {
        return undefined
      }
      if (isGenCall(value)) {
        return 'effect'
      }
      if (
        value.type !== 'ArrowFunctionExpression' &&
        value.type !== 'FunctionExpression' &&
        value.type !== 'FunctionDeclaration'
      ) {
        return undefined
      }
      if (value.generator || value.body === null) {
        return undefined
      }
      if (value.body.type !== 'BlockStatement') {
        if (isGenCall(value.body)) {
          return 'function'
        }
        return undefined
      }
      if (topLevelReturns(value.body.body).some((returned) => isGenCall(returned))) {
        return 'function'
      }
      return undefined
    }

    return {
      CallExpression(node) {
        const callee = unwrapExpression(node.callee)

        // Tag.of({ … }) — the tag must be a local or imported binding, not a
        // global such as Array.of, and not an `effect` module.
        if (
          callee?.type === 'MemberExpression' &&
          getPropertyName(callee.property) === 'of'
        ) {
          const tag = unwrapExpression(callee.object)
          const implementation = localValue(node.arguments[0])
          if (
            tag?.type === 'Identifier' &&
            implementation?.type === 'ObjectExpression'
          ) {
            const definition = definitionOf(tag)
            if (
              definition !== undefined &&
              !(
                definition.type === 'ImportBinding' &&
                isEffectModuleImport(definition.node)
              )
            ) {
              checkImplementation(implementation, tagName(tag))
            }
          }
          return
        }

        // Data-first: Layer.succeed(Tag, impl) / Layer.effect(Tag, gen).
        if (node.arguments.length === 2) {
          if (isModuleMember(callee, 'Layer', 'succeed')) {
            const implementation = localValue(node.arguments[1])
            if (implementation?.type === 'ObjectExpression') {
              checkImplementation(implementation, tagName(node.arguments[0]))
            }
            return
          }
          if (isModuleMember(callee, 'Layer', 'effect')) {
            checkReturnedImplementations(node.arguments[1], tagName(node.arguments[0]))
            return
          }
        }

        if (callee?.type !== 'CallExpression' || isCalleeOfEnclosingCall(node)) {
          return
        }

        // Curried: Layer.succeed(Tag)(impl) / Layer.effect(Tag)(gen).
        if (isModuleMember(callee.callee, 'Layer', 'succeed')) {
          const implementation = localValue(node.arguments[0])
          if (implementation?.type === 'ObjectExpression') {
            checkImplementation(implementation, tagName(callee.arguments[0]))
          }
          return
        }
        if (isModuleMember(callee.callee, 'Layer', 'effect')) {
          checkReturnedImplementations(node.arguments[0], tagName(callee.arguments[0]))
          return
        }
      }
    }
  }
})

/** `FeedService` labels as `Feed`, matching the repo's span names. */
function tagName(node: ESTree.Node | null | undefined): string {
  const tag = unwrapExpression(node)
  let name: string | undefined
  if (tag?.type === 'Identifier') {
    name = tag.name
  } else if (tag?.type === 'MemberExpression') {
    name = getPropertyName(tag.property)
  }
  if (name === undefined) {
    return 'Service'
  }
  return name.replace(/(?<=.)Service$/u, '')
}

/**
 * `return` arguments of a function body, skipping nested functions: an object
 * a callback returns is the callback's data, not the service.
 */
function topLevelReturns(statements: ReadonlyArray<ESTree.Node>): Array<ESTree.Node> {
  const returned: Array<ESTree.Node> = []
  function visit(statement: ESTree.Node | null | undefined) {
    if (statement === null || statement === undefined) {
      return
    }
    if (statement.type === 'ReturnStatement') {
      if (statement.argument !== null) {
        returned.push(statement.argument)
      }
    } else if (statement.type === 'BlockStatement') {
      statement.body.forEach(visit)
    } else if (statement.type === 'IfStatement') {
      visit(statement.consequent)
      visit(statement.alternate)
    } else if (statement.type === 'TryStatement') {
      visit(statement.block)
      visit(statement.handler?.body)
      visit(statement.finalizer)
    } else if (statement.type === 'SwitchStatement') {
      for (const branch of statement.cases) {
        branch.consequent.forEach(visit)
      }
    } else if (statement.type === 'LabeledStatement') {
      visit(statement.body)
    }
  }
  statements.forEach(visit)
  return returned
}
