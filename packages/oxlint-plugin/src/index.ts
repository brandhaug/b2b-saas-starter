import { definePlugin } from '@oxlint/plugins'
import noDarkPrefix from './rules/no-dark-prefix.ts'
import noDeepWorkspaceImports from './rules/no-deep-workspace-imports.ts'
import noEffectEscapeHatch from './rules/no-effect-escape-hatch.ts'
import noEffectInternalTags from './rules/no-effect-internal-tags.ts'
import noHexColor from './rules/no-hex-color.ts'
import noInlineSchemaCompile from './rules/no-inline-schema-compile.ts'
import noInterfaceMergeOutsideDts from './rules/no-interface-merge-outside-dts.ts'
import noMismatchedAugmentationContext from './rules/no-mismatched-augmentation-context.ts'
import noSchemaClass from './rules/no-schema-class.ts'
import noUnknownErrorMessage from './rules/no-unknown-error-message.ts'
import noUnsupportedEffectApi from './rules/no-unsupported-effect-api.ts'
import preferEffectPredicate from './rules/prefer-effect-predicate.ts'

// Rule ids are alphabetical. The root `lint.config.ts` enables and scopes
// every one of them; see packages/oxlint-plugin/AGENTS.md for what each
// catches.
export default definePlugin({
  meta: { name: 'starter' },
  rules: {
    'no-dark-prefix': noDarkPrefix,
    'no-deep-workspace-imports': noDeepWorkspaceImports,
    'no-effect-escape-hatch': noEffectEscapeHatch,
    'no-effect-internal-tags': noEffectInternalTags,
    'no-hex-color': noHexColor,
    'no-inline-schema-compile': noInlineSchemaCompile,
    'no-interface-merge-outside-dts': noInterfaceMergeOutsideDts,
    'no-mismatched-augmentation-context': noMismatchedAugmentationContext,
    'no-schema-class': noSchemaClass,
    'no-unknown-error-message': noUnknownErrorMessage,
    'no-unsupported-effect-api': noUnsupportedEffectApi,
    'prefer-effect-predicate': preferEffectPredicate
  }
})
