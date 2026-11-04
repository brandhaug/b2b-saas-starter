import { defineRule, type ESTree } from 'vite-plus/lint/plugins'
import { getPropertyName, getStringValue, parentOf } from '../internal/ast.ts'

const controls = new Set([
  'Button',
  'Input',
  'SelectTrigger',
  'Textarea',
  'Spinner',
  'Badge'
])
const appearance =
  /^(?:bg|text|font|leading|tracking|rounded|border|divide|ring|shadow|outline|decoration|fill|stroke|opacity|p|px|py|ps|pe|pt|pr|pb|pl)-|^(?:border|rounded|shadow|underline|overline|line-through|antialiased|tabular-nums)$/u
const layoutText =
  /^text-(?:left|right|center|justify|start|end|wrap|nowrap|balance|pretty)$/u
const appearanceStyle =
  /^(?:color|background.*|font.*|lineHeight|letterSpacing|border.*|boxShadow|textDecoration.*|padding.*|opacity|fill|stroke.*)$/u

export default defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Shared UI components own appearance through variants and sizes.'
    }
  },
  create(context) {
    return {
      'Literal, TemplateElement, Property': (node: ESTree.Node) => {
        const attribute = owningAttribute(node)
        if (attribute === undefined) {
          return
        }
        const opening = parentOf(attribute)
        if (opening?.type !== 'JSXOpeningElement') {
          return
        }
        const name = opening.name
        const local = jsxBinding(name)
        if (local === undefined) {
          return
        }
        let scope = context.sourceCode.getScope(opening)
        let variable = scope.set.get(local)
        while (variable === undefined && scope.upper !== null) {
          scope = scope.upper
          variable = scope.set.get(local)
        }
        const definition = variable?.defs[0]
        if (definition?.type !== 'ImportBinding') {
          return
        }
        const declaration = parentOf(definition.node)
        if (
          declaration?.type !== 'ImportDeclaration' ||
          !/(?:^|\/)ui\/[^/]+$/u.test(declaration.source.value)
        ) {
          return
        }
        let component = local
        if (definition.node.type === 'ImportSpecifier') {
          component = getPropertyName(definition.node.imported) ?? local
        } else if (name.type === 'JSXMemberExpression') {
          component = name.property.name
        }
        let rejected = false
        if (attribute.name.name === 'style' && node.type === 'Property') {
          const property = getPropertyName(node.key)
          rejected =
            property !== undefined &&
            (appearanceStyle.test(property) ||
              (controls.has(component) &&
                /^(?:height|minHeight|maxHeight)$/u.test(property)))
        }
        if (attribute.name.name === 'className') {
          if (!contributesClassValue(node, attribute)) {
            return
          }
          let text = getStringValue(node)
          if (node.type === 'TemplateElement') {
            text = node.value.cooked ?? undefined
          }
          rejected =
            text?.split(/\s+/u).some((token) => isAppearance(token, component)) ?? false
        }
        if (rejected) {
          context.report({
            node,
            message:
              'Use a variant or size on the shared UI component; move feature-specific appearance into its feature component. Keep surrounding layout on a parent where possible. See DESIGN.md.'
          })
        }
      }
    }
  }
})

function jsxBinding(name: ESTree.JSXOpeningElement['name']): string | undefined {
  if (name.type === 'JSXIdentifier') {
    return name.name
  }
  if (name.type === 'JSXMemberExpression' && name.object.type === 'JSXIdentifier') {
    return name.object.name
  }
  return undefined
}

function owningAttribute(node: ESTree.Node): ESTree.JSXAttribute | undefined {
  let current = parentOf(node)
  while (current !== undefined) {
    if (current.type === 'JSXAttribute') {
      return current
    }
    if (current.type === 'JSXElement' || current.type === 'JSXOpeningElement') {
      return undefined
    }
    current = parentOf(current)
  }
  return undefined
}

function contributesClassValue(
  node: ESTree.Node,
  attribute: ESTree.JSXAttribute
): boolean {
  let child = node
  let parent = parentOf(child)
  while (parent !== undefined && parent !== attribute) {
    const contributor = child
    if (
      parent.type === 'BinaryExpression' ||
      parent.type === 'UnaryExpression' ||
      parent.type === 'MemberExpression'
    ) {
      return false
    }
    if (parent.type === 'ConditionalExpression' && parent.test === child) {
      return false
    }
    if (
      parent.type === 'LogicalExpression' &&
      parent.operator === '&&' &&
      parent.left === child
    ) {
      return false
    }
    // clsx/cn object keys contribute classes; their values only select them.
    if (parent.type === 'Property' && parent.key !== child) {
      return false
    }
    if (
      parent.type === 'CallExpression' &&
      !parent.arguments.some((argument) => argument === contributor)
    ) {
      return false
    }
    child = parent
    parent = parentOf(child)
  }
  return true
}

function isAppearance(token: string, component: string | undefined): boolean {
  // Colons inside arbitrary selectors/properties are not variant separators.
  let depth = 0
  let start = 0
  for (let index = 0; index < token.length; index++) {
    const character = token[index]
    if (character === '[' || character === '(') {
      depth++
    }
    if (character === ']' || character === ')') {
      depth--
    }
    if (character === ':' && depth === 0) {
      start = index + 1
    }
  }
  const utility = token.slice(start).replaceAll(/^!|!$/gu, '')
  if (layoutText.test(utility)) {
    return false
  }
  // These unpainted slots compose children; their padding is surrounding layout.
  if (
    (component === 'RadioGroup' || component === 'ItemActions') &&
    /^p[xysetrbl]?-/u.test(utility)
  ) {
    return false
  }
  if (appearance.test(utility)) {
    return true
  }
  if (controls.has(component ?? '') && /^(?:h|min-h|max-h|size)-/u.test(utility)) {
    return true
  }
  return /^\[(?:color|background[^:]*|font[^:]*|padding[^:]*|border[^:]*|box-shadow|opacity):/u.test(
    utility
  )
}
