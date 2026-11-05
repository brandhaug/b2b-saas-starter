import { definePlugin } from 'vite-plus/lint/plugins'
import namedEffectOperation from './rules/named-effect-operation.ts'
import noBrowserTestInflation from './rules/no-browser-test-inflation.ts'
import noDarkPrefix from './rules/no-dark-prefix.ts'
import noEffectInternalTags from './rules/no-effect-internal-tags.ts'
import noHexColor from './rules/no-hex-color.ts'
import noInlineSchemaCompile from './rules/no-inline-schema-compile.ts'
import noInterfaceMergeOutsideDts from './rules/no-interface-merge-outside-dts.ts'
import noMismatchedAugmentationContext from './rules/no-mismatched-augmentation-context.ts'
import noNestedServiceYield from './rules/no-nested-service-yield.ts'
import noRunPromiseInTests from './rules/no-run-promise-in-tests.ts'
import noRuntimeExecution from './rules/no-runtime-execution.ts'
import noUiAppearanceOverride from './rules/no-ui-appearance-override.ts'
import noUnknownErrorMessage from './rules/no-unknown-error-message.ts'
import preferEffectPredicate from './rules/prefer-effect-predicate.ts'
import requireSuppressionReason from './rules/require-suppression-reason.ts'

// Rule ids are alphabetical. The root `lint.config.ts` enables and scopes
// every one of them; each rule file's doc comment says what it catches.
export default definePlugin({
  meta: { name: 'starter' },
  rules: {
    'named-effect-operation': namedEffectOperation,
    'no-browser-test-inflation': noBrowserTestInflation,
    'no-dark-prefix': noDarkPrefix,
    'no-effect-internal-tags': noEffectInternalTags,
    'no-hex-color': noHexColor,
    'no-inline-schema-compile': noInlineSchemaCompile,
    'no-interface-merge-outside-dts': noInterfaceMergeOutsideDts,
    'no-mismatched-augmentation-context': noMismatchedAugmentationContext,
    'no-nested-service-yield': noNestedServiceYield,
    'no-run-promise-in-tests': noRunPromiseInTests,
    'no-runtime-execution': noRuntimeExecution,
    'no-ui-appearance-override': noUiAppearanceOverride,
    'no-unknown-error-message': noUnknownErrorMessage,
    'prefer-effect-predicate': preferEffectPredicate,
    'require-suppression-reason': requireSuppressionReason
  }
})
