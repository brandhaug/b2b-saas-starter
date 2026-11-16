import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import { getPropertyName, getStringValue, unwrapExpression } from '../internal/ast.ts'

/**
 * Catches `value._tag === 'Some'` and its siblings: a comparison against the
 * discriminant Effect owns on Option, Either, Result, Exit and Cause. Those tags
 * are internal, the public guards are not, and a renamed tag would break the
 * comparison silently while `Option.isSome` keeps compiling.
 *
 * `Some`, `None`, `Success` and `Failure` fire in any file that imports from
 * `effect` or `effect/*`: values from `Schema.decodeUnknownOption`,
 * `Schema.decodeUnknownResult` or `Effect.exit` carry them without the file
 * importing Option, Result or Exit, and no starter union uses those four tags.
 * Every other tag fires only when its owning module is imported, so the
 * starter's own tagged unions keep their `_tag` checks. Both `import { Option }
 * from 'effect'` and `import * as Option from 'effect/Option'` count.
 *
 * Ported from oxlint-plugin-executor/rules/no-effect-internal-tags.js (MIT).
 */

type TagOwner = {
  readonly modules: ReadonlyArray<string>
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

/** Tags that name an Effect data type whenever the file uses Effect at all. */
const EFFECT_CLAIMED_TAGS = new Set(['Some', 'None', 'Success', 'Failure'])

const EQUALITY_OPERATORS = new Set(['===', '!==', '==', '!='])

export default defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow direct _tag checks on Effect-owned data types.' }
  },
  create(context) {
    const imported = new Set<string>()
    let importsEffect = false

    return {
      ImportDeclaration(node) {
        if (isEffectSource(node.source.value)) {
          importsEffect = true
        }
        for (const moduleName of importedEffectModules(node)) {
          imported.add(moduleName)
        }
      },
      BinaryExpression(node) {
        if (!importsEffect || !EQUALITY_OPERATORS.has(node.operator)) {
          return
        }

        reportTagComparison(node.left, node.right)
        reportTagComparison(node.right, node.left)
      }
    }

    function reportTagComparison(
      accessCandidate: ESTree.Node,
      tagCandidate: ESTree.Node
    ) {
      const access = getTagAccess(accessCandidate)
      if (access === undefined) {
        return
      }

      const tag = getStringValue(tagCandidate)
      if (tag === undefined) {
        return
      }

      const owner = ownerForTag(tag, imported)
      if (owner === undefined) {
        return
      }

      context.report({
        node: access,
        message: `Comparing _tag to "${tag}" reads an Effect internal. Use ${owner.guard} instead.`
      })
    }
  }
})

function importedEffectModules(node: ESTree.ImportDeclaration): ReadonlyArray<string> {
  const source = node.source.value

  if (source.startsWith('effect/')) {
    const submodule = source.slice('effect/'.length)
    if (EFFECT_MODULES.has(submodule)) {
      return [submodule]
    }
    return []
  }

  if (source !== 'effect') {
    return []
  }

  const modules: Array<string> = []
  for (const specifier of node.specifiers) {
    if (specifier.type !== 'ImportSpecifier') {
      continue
    }
    const name = getPropertyName(specifier.imported)
    if (name !== undefined && EFFECT_MODULES.has(name)) {
      modules.push(name)
    }
  }
  return modules
}

function getTagAccess(node: ESTree.Node): ESTree.MemberExpression | undefined {
  const expression = unwrapExpression(node)
  if (expression?.type !== 'MemberExpression') {
    return undefined
  }

  if (expression.computed) {
    if (getStringValue(expression.property) !== '_tag') {
      return undefined
    }
    return expression
  }

  if (getPropertyName(expression.property) !== '_tag') {
    return undefined
  }
  return expression
}

function isEffectSource(source: string): boolean {
  return source === 'effect' || source.startsWith('effect/')
}

function ownerForTag(tag: string, imported: ReadonlySet<string>): TagOwner | undefined {
  const owner = TAG_OWNERS.get(tag)
  if (owner === undefined) {
    return undefined
  }
  if (EFFECT_CLAIMED_TAGS.has(tag)) {
    return owner
  }
  if (!owner.modules.some((moduleName) => imported.has(moduleName))) {
    return undefined
  }
  return owner
}
