import { defineRule, type ESTree } from '@oxlint/plugins'
import { getPropertyName, getStringValue, unwrapExpression } from '../internal/ast.ts'

/**
 * Catches `value._tag === 'Some'` and its siblings: a comparison against the
 * discriminant Effect owns on Option, Either, Result, Exit and Cause. Those tags
 * are internal, the public guards are not, and a renamed tag would break the
 * comparison silently while `Option.isSome` keeps compiling.
 *
 * The rule only fires when the matching module is imported, so the starter's own
 * tagged unions keep their `_tag` checks. It reads both `import { Option } from
 * 'effect'` and `import * as Option from 'effect/Option'`.
 *
 * Ported from oxlint-plugin-executor/rules/no-effect-internal-tags.js (MIT).
 */

type TagOwner = {
  readonly modules: readonly string[]
  readonly guard: string
}

const EFFECT_MODULES = new Set(['Option', 'Either', 'Result', 'Cause', 'Exit'])

const TAG_OWNERS = new Map<string, TagOwner>([
  ['Some', { modules: ['Option'], guard: 'Option.isSome' }],
  ['None', { modules: ['Option'], guard: 'Option.isNone' }],
  [
    'Left',
    { modules: ['Either', 'Result'], guard: 'Either.isLeft or Result.isFailure' }
  ],
  [
    'Right',
    { modules: ['Either', 'Result'], guard: 'Either.isRight or Result.isSuccess' }
  ],
  [
    'Success',
    { modules: ['Exit', 'Result'], guard: 'Exit.isSuccess or Result.isSuccess' }
  ],
  [
    'Failure',
    { modules: ['Exit', 'Result'], guard: 'Exit.isFailure or Result.isFailure' }
  ],
  ['Fail', { modules: ['Cause'], guard: 'Cause.match' }],
  ['Die', { modules: ['Cause'], guard: 'Cause.match' }],
  ['Interrupt', { modules: ['Cause'], guard: 'Cause.match' }],
  ['Sequential', { modules: ['Cause'], guard: 'Cause.match' }],
  ['Parallel', { modules: ['Cause'], guard: 'Cause.match' }],
  ['Then', { modules: ['Cause'], guard: 'Cause.match' }],
  ['Both', { modules: ['Cause'], guard: 'Cause.match' }],
  ['Empty', { modules: ['Cause'], guard: 'Cause.match' }]
])

const EQUALITY_OPERATORS = new Set(['===', '!==', '==', '!='])

function importedEffectModules(node: ESTree.ImportDeclaration): readonly string[] {
  const source = node.source.value

  if (source.startsWith('effect/')) {
    const submodule = source.slice('effect/'.length)
    if (EFFECT_MODULES.has(submodule)) return [submodule]
    return []
  }

  if (source !== 'effect') return []

  const modules: string[] = []
  for (const specifier of node.specifiers) {
    if (specifier.type !== 'ImportSpecifier') continue
    const name = getPropertyName(specifier.imported)
    if (name !== undefined && EFFECT_MODULES.has(name)) modules.push(name)
  }
  return modules
}

function getTagAccess(node: ESTree.Node): ESTree.MemberExpression | undefined {
  const expression = unwrapExpression(node)
  if (expression?.type !== 'MemberExpression') return undefined

  if (expression.computed) {
    if (getStringValue(expression.property) !== '_tag') return undefined
    return expression
  }

  if (getPropertyName(expression.property) !== '_tag') return undefined
  return expression
}

function ownerForImportedModules(
  tag: string,
  imported: ReadonlySet<string>
): TagOwner | undefined {
  const owner = TAG_OWNERS.get(tag)
  if (owner === undefined) return undefined
  if (!owner.modules.some((moduleName) => imported.has(moduleName))) return undefined
  return owner
}

export default defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow direct _tag checks on Effect-owned data types.' }
  },
  create(context) {
    const imported = new Set<string>()

    function reportTagComparison(
      accessCandidate: ESTree.Node,
      tagCandidate: ESTree.Node
    ) {
      const access = getTagAccess(accessCandidate)
      if (access === undefined) return

      const tag = getStringValue(tagCandidate)
      if (tag === undefined) return

      const owner = ownerForImportedModules(tag, imported)
      if (owner === undefined) return

      context.report({
        node: access,
        message: `Comparing _tag to "${tag}" reads an Effect internal. Use ${owner.guard} instead.`
      })
    }

    return {
      ImportDeclaration(node) {
        for (const moduleName of importedEffectModules(node)) imported.add(moduleName)
      },
      BinaryExpression(node) {
        if (imported.size === 0) return
        if (!EQUALITY_OPERATORS.has(node.operator)) return

        reportTagComparison(node.left, node.right)
        reportTagComparison(node.right, node.left)
      }
    }
  }
})
