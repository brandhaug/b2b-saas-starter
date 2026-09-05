import { defineConfig } from 'vite-plus'
import {
  type Capability,
  REACT_DOCTOR_RULE_REGISTRY
} from 'oxlint-plugin-react-doctor/core'

// The repo's lint configuration. It lives beside `vite.config.ts` rather than
// inside it because `vp lint` is the single biggest block of policy in the
// repo, and 900 lines of `'error'` hid the ~30 places where a deliberate
// decision was made. `vp` discovers only `vite.config.ts`; that file
// imports `lintConfig` from here, so `vp lint` still runs with no extra flags.
//
// The shape to read for: each plugin is switched on wholesale at `error` from a
// name list, and every deviation — a rule that is off, or a rule that carries
// options — sits in one block at the end of `rules` with the reason it
// deviates. Per-path exemptions live in `overrides`, one comment per block.

/**
 * Rule names as whitespace-separated text rather than an array: the formatter
 * fills these lines, so a plugin's enabled set stays a paragraph instead of one
 * line per rule.
 */
function ruleNames(list: string): Array<string> {
  return list.split(/\s+/u).filter((name) => name.length > 0)
}

/**
 * Switch every named rule of one plugin on at `error`. `prefix` carries its own
 * separator so the core ESLint rules can pass an empty one.
 */
function enable(prefix: string, list: string): Record<string, 'error'> {
  return Object.fromEntries(
    ruleNames(list).map((name) => [`${prefix}${name}`, 'error'])
  )
}

// --- Bulk enablement -------------------------------------------------------
// oxlint's Rust plugins expose no importable rule registry, so their enabled
// sets are spelled out. Adding a name here is the whole gesture; the severity
// is always `error` and lives in `enable`.

// ESLint core rules oxlint reimplements.
const CORE = `
  array-callback-return block-scoped-var curly default-case-last default-param-last
  eqeqeq guard-for-in no-array-constructor no-await-in-loop no-case-declarations
  no-constructor-return no-duplicate-imports no-empty no-empty-function no-eq-null
  no-extend-native no-fallthrough no-implied-eval no-label-var no-labels
  no-lone-blocks no-lonely-if no-loop-func no-multi-str no-nested-ternary no-new-func
  no-new-wrappers no-object-constructor no-param-reassign no-promise-executor-return
  no-proto no-prototype-builtins no-regex-spaces no-return-assign no-script-url
  no-self-compare no-sequences no-shadow no-template-curly-in-string no-throw-literal
  no-unexpected-multiline no-unmodified-loop-condition no-unneeded-ternary
  no-unreachable-loop no-unused-expressions no-useless-call no-useless-concat
  no-useless-constructor no-useless-rename no-var object-shorthand prefer-const
  prefer-exponentiation-operator prefer-object-has-own prefer-object-spread
  prefer-regex-literals prefer-template preserve-caught-error radix
`

// TypeScript discipline (oxlint's typescript plugin, spelled with the
// typescript-eslint prefix). The type-aware members rely on `options.typeAware`.
const TYPESCRIPT = `
  adjacent-overload-signatures await-thenable ban-tslint-comment
  consistent-generic-constructors no-array-delete no-base-to-string
  no-confusing-non-null-assertion no-deprecated no-duplicate-enum-values
  no-duplicate-type-constituents no-dynamic-delete no-empty-object-type
  no-explicit-any no-extra-non-null-assertion no-extraneous-class
  no-floating-promises no-for-in-array no-invalid-void-type no-misused-new
  no-misused-promises no-misused-spread no-mixed-enums no-namespace
  no-non-null-asserted-nullish-coalescing no-non-null-asserted-optional-chain
  no-non-null-assertion no-require-imports no-this-alias
  no-unnecessary-boolean-literal-compare no-unnecessary-condition
  no-unnecessary-template-expression no-unnecessary-type-constraint
  no-unsafe-declaration-merging no-unsafe-enum-comparison no-unsafe-function-type
  no-wrapper-object-types prefer-enum-initializers prefer-for-of prefer-function-type
  prefer-literal-enum-member prefer-namespace-keyword prefer-optional-chain
  prefer-ts-expect-error require-array-sort-compare require-await
  restrict-plus-operands return-await switch-exhaustiveness-check
  triple-slash-reference unbound-method use-unknown-in-catch-callback-variable
`

const UNICORN = `
  catch-error-name consistent-date-clone consistent-empty-array-spread
  consistent-existence-index-check error-message filename-case new-for-builtins
  no-abusive-eslint-disable no-accessor-recursion no-array-fill-with-reference-type
  no-array-sort no-await-expression-member no-await-in-promise-methods
  no-confusing-array-with no-document-cookie no-empty-file no-hex-escape
  no-instanceof-array no-invalid-fetch-options no-invalid-remove-event-listener
  no-length-as-slice-end no-magic-array-flat-depth no-negated-condition
  no-negation-in-equality-check no-new-array no-object-as-default-parameter
  no-single-promise-in-promise-methods no-thenable no-typeof-undefined
  no-unnecessary-array-splice-count no-unnecessary-await no-unnecessary-slice-end
  no-unreadable-array-destructuring no-useless-fallback-in-spread
  no-useless-length-check no-useless-promise-resolve-reject no-useless-spread
  no-useless-switch-case no-zero-fractions numeric-separators-style prefer-array-find
  prefer-array-flat-map prefer-array-index-of prefer-array-some prefer-at
  prefer-blob-reading-methods prefer-classlist-toggle prefer-date-now
  prefer-dom-node-append prefer-dom-node-text-content prefer-event-target
  prefer-import-meta-properties prefer-keyboard-event-key
  prefer-logical-operator-over-ternary prefer-math-min-max prefer-modern-dom-apis
  prefer-modern-math-apis prefer-native-coercion-functions prefer-node-protocol
  prefer-number-properties prefer-object-from-entries prefer-optional-catch-binding
  prefer-regexp-test prefer-set-has prefer-set-size prefer-single-call prefer-spread
  prefer-string-raw prefer-string-replace-all prefer-string-slice
  prefer-structured-clone prefer-type-error require-array-join-separator
  require-number-to-fixed-digits-argument require-post-message-target-origin
  switch-case-braces text-encoding-identifier-case throw-new-error
`

const OXC = `
  approx-constant bad-array-method-on-arguments bad-bitwise-operator
  bad-char-at-comparison bad-comparison-sequence bad-match-all-arg bad-min-max-func
  bad-object-literal-comparison bad-replace-all-arg branches-sharing-code
  const-comparisons double-comparisons erasing-op misrefactored-assign-op
  missing-throw no-accumulating-spread no-async-endpoint-handlers no-barrel-file
  number-arg-out-of-range only-used-in-recursion uninvoked-array-callback
`

const IMPORT = `
  export no-absolute-path no-cycle no-duplicates no-empty-named-blocks
  no-mutable-exports no-named-as-default no-self-import
`

const PROMISE = `
  always-return no-callback-in-promise no-multiple-resolved no-nesting no-new-statics
  no-promise-in-callback no-return-wrap param-names prefer-catch spec-only
  valid-params
`

const VITEST = `
  consistent-vitest-vi hoisted-apis-on-top no-alias-methods no-commented-out-tests
  no-conditional-tests no-disabled-tests no-duplicate-hooks no-focused-tests
  no-identical-title no-import-node-test no-standalone-expect no-test-prefixes
  no-test-return-statement no-unneeded-async-expect-function
  padding-around-test-blocks prefer-comparison-matcher prefer-each
  prefer-equality-matcher prefer-hooks-in-order prefer-hooks-on-top prefer-spy-on
  prefer-to-be-object prefer-to-contain prefer-to-have-length
  require-to-throw-message valid-describe-callback valid-expect
  valid-expect-in-promise
`

const REACT = `
  button-has-type checked-requires-onchange-or-readonly display-name error-boundaries
  globals hook-use-state iframe-missing-sandbox immutability incompatible-library
  jsx-boolean-value jsx-key jsx-no-comment-textnodes
  jsx-no-constructed-context-values jsx-no-duplicate-props jsx-no-script-url
  jsx-no-target-blank jsx-no-undef jsx-pascal-case jsx-props-no-spread-multi
  no-children-prop no-clone-element no-danger no-danger-with-children
  no-direct-mutation-state no-find-dom-node no-is-mounted
  no-object-type-as-default-prop no-render-return-value no-string-refs no-this-in-sfc
  no-unknown-property no-unstable-nested-components only-export-components
  preserve-manual-memoization purity refs require-render-return self-closing-comp
  set-state-in-effect set-state-in-render static-components style-prop-object
  unsupported-syntax use-memo void-dom-elements-no-children void-use-memo
`

const REACT_HOOKS = `
  exhaustive-deps rules-of-hooks
`

const JSX_A11Y = `
  alt-text anchor-has-content anchor-is-valid aria-activedescendant-has-tabindex
  aria-props aria-proptypes aria-role aria-unsupported-elements autocomplete-valid
  click-events-have-key-events heading-has-content html-has-lang iframe-has-title
  img-redundant-alt interactive-supports-focus label-has-associated-control lang
  mouse-events-have-key-events no-access-key no-aria-hidden-on-focusable
  no-distracting-elements no-interactive-element-to-noninteractive-role
  no-noninteractive-element-to-interactive-role no-noninteractive-tabindex
  no-redundant-roles no-static-element-interactions role-has-required-aria-props
  role-supports-aria-props scope tabindex-no-positive
`

// Effect discipline (oxlint-plugin-effect), the full `recommended` preset
// except `noNullish` (see the deviations block). The preset is written for
// Effect-native TypeScript, so the members that assume no JSX and no DOM are
// switched off for `apps/web` in an override.
const EFFECT = `
  noAs noAsyncFunction noDynamicImports noEffectBind noEffectDo noGlobals noNewError
  noNewPromise noNodeBuiltinImport noTernary noTestLifecycleHooks noThrowStatement
  noTryCatch preferEffectFn
`

// The three remaining JS plugins, each listed in full — every rule the plugin
// ships as of the pinned version. anti-slop and vite-plus do export a `rules`
// map and could be derived the way react-doctor is; 26 names between the three
// of them is not worth making every `vp` command load three more plugin modules
// to answer `vp dev`.
const ANTI_SLOP = `
  no-chained-type-assertions no-conditional-empty-object-spread
  no-known-value-widening no-module-mocking no-object-parameters no-reflect-apply
  no-reflect-get no-runtime-typeof no-shape-in-symbol-names no-unknown-parameters
  no-unknown-returns no-unknown-type-aliases no-unsafe-dictionary-type
  no-widen-then-assert require-safety-comment-for-type-assertion
`

const STARTER = `
  no-deep-workspace-imports no-effect-escape-hatch no-effect-internal-tags
  no-inline-schema-compile no-interface-merge-outside-dts
  no-mismatched-augmentation-context no-schema-class no-unknown-error-message
  no-unsupported-effect-api prefer-effect-predicate
`

const VITE_PLUS = `
  prefer-vite-plus-imports
`

// --- react-doctor ----------------------------------------------------------
// react-doctor ships 884 rules for a dozen React ecosystems, which is why this
// one plugin is derived rather than listed. Its registry tags every rule with
// the libraries it needs (`requires`), so the enabled set is "every rule this
// stack can satisfy, minus the five groups below". A react-doctor upgrade that
// adds a rule for a library named in STACK turns that rule on, which is the
// intent.

/** The libraries react-doctor may assume when deciding a rule applies here. */
const STACK: ReadonlySet<Capability> = new Set<Capability>([
  'i18n',
  'react',
  'react-compiler',
  'react:18',
  'react:19',
  'react:19.2',
  'ssr',
  'tailwind',
  'tailwind:3.4',
  'tailwind:4',
  'tanstack-query',
  'tanstack-start',
  'zod:4'
])

// Already reported by an enabled Rust plugin (react, jsx-a11y, react-hooks).
// Two messages for one mistake is the thing to avoid, and the Rust rule is the
// faster of the two. `no-direct-mutation-state` is the one name held by both
// plugins that stays on in both, which is why it is absent from this list.
const RD_DUPLICATED_BY_OXLINT = `
  alt-text anchor-has-content anchor-is-valid aria-activedescendant-has-tabindex
  aria-props aria-proptypes aria-role aria-unsupported-elements autocomplete-valid
  button-has-type checked-requires-onchange-or-readonly click-events-have-key-events
  display-name exhaustive-deps forbid-elements heading-has-content hook-use-state
  html-has-lang iframe-has-title iframe-missing-sandbox img-redundant-alt
  interactive-supports-focus jsx-boolean-value jsx-curly-brace-presence jsx-key
  jsx-no-comment-textnodes jsx-no-constructed-context-values jsx-no-duplicate-props
  jsx-no-script-url jsx-no-undef jsx-no-useless-fragment jsx-pascal-case
  jsx-props-no-spread-multi label-has-associated-control lang
  mouse-events-have-key-events no-access-key no-aria-hidden-on-focusable
  no-children-prop no-clone-element no-danger no-danger-with-children
  no-distracting-elements no-find-dom-node
  no-interactive-element-to-noninteractive-role no-is-mounted no-namespace
  no-noninteractive-element-to-interactive-role no-noninteractive-tabindex
  no-redundant-roles no-render-return-value no-static-element-interactions
  no-string-refs no-this-in-sfc no-unknown-property no-unstable-nested-components
  only-export-components react-in-jsx-scope require-render-return
  role-has-required-aria-props role-supports-aria-props rules-of-hooks scope
  self-closing-comp style-prop-object tabindex-no-positive
  void-dom-elements-no-children
`

// Libraries this repo does not use. react-doctor carries no `requires` token
// for these, so they cannot be gated by STACK: Ink, Jotai, Motion, Redux, React
// Server Components, WebGL, react-markdown.
const RD_UNUSED_LIBRARIES = `
  ink-ctrl-c-handler-requires-exit-option ink-newline-inside-text
  ink-no-bare-process-exit ink-no-direct-raw-mode ink-no-dom-host-elements
  ink-no-dom-router ink-no-focus-in-render ink-no-layout-inside-text
  ink-no-live-hooks-in-render-to-string ink-no-measure-element-in-render
  ink-no-multiple-static ink-no-raw-text ink-no-repeated-render
  ink-prefer-use-animation ink-prefer-use-paste ink-static-is-append-only
  ink-static-requires-key ink-suspense-requires-concurrent
  ink-use-reactive-window-size ink-use-string-width-for-cursor
  ink-use-suspend-terminal ink-valid-aria-semantics
  jotai-derived-atom-returns-fresh-object jotai-select-atom-in-render-body
  jotai-tq-use-raw-query-atom motion-animate-presence-must-outlive-child
  motion-animate-presence-requires-key motion-animate-presence-wait-single-child
  motion-create-in-render motion-drag-axis-constraint-mismatch
  motion-imperative-animation-in-render motion-keyframe-times-mismatch
  motion-layout-on-inline-element motion-unstable-layout-id-in-iteration
  motion-use-transform-range-length motion-value-constructor-in-render
  motion-value-subscription-in-render react-markdown-unsanitized-raw-html
  redux-useselector-inline-derivation redux-useselector-returns-new-collection
  server-after-nonblocking server-auth-actions server-cache-with-object-literal
  server-dedup-props server-fetch-without-revalidate server-hoist-static-io
  server-no-mutable-module-state server-sequential-independent-await use-lazy-motion
  webgl-no-sync-readback-in-animation-loop
`

// Class-component-era React. This repo has no class components, so none of
// these can fire.
const RD_CLASS_COMPONENTS = `
  forward-ref-uses-ref no-did-mount-set-state no-did-update-set-state
  no-initialize-state no-react-children no-redundant-should-component-update
  no-set-state no-unsafe no-will-update-set-state prefer-es6-class
  prefer-function-component state-in-constructor
`

// JSX style limits the repo does not enforce: file naming, fragment syntax,
// handler naming, nesting depth, prop spreading, inline prop identity.
const RD_JSX_STYLE = `
  forbid-component-props forbid-dom-props jsx-filename-extension jsx-fragments
  jsx-handler-names jsx-max-depth jsx-no-jsx-as-prop jsx-no-new-array-as-prop
  jsx-no-new-function-as-prop jsx-no-new-object-as-prop jsx-props-no-spreading
  no-multi-comp
`

// Individually declined: accessibility checks beyond the enabled jsx-a11y set,
// and single rules the repo has not adopted.
const RD_DECLINED = `
  anchor-ambiguous-text aria-braille-equivalent control-has-associated-label
  empty-table-header html-xml-lang-mismatch iframe-title-unique media-has-caption
  no-aria-hidden-on-body no-array-index-key no-autofocus
  no-duplicate-static-id-reference no-event-handler
  no-focusable-content-in-role-text no-noninteractive-element-interactions
  no-pass-live-state-to-parent no-presentation-role-conflict
  no-reset-all-state-on-prop-change no-server-side-image-map no-unescaped-entities
  prefer-tag-over-role
`

/**
 * Every react-doctor rule the stack satisfies, minus the groups above. Scan
 * rules are excluded wholesale: they read files from disk outside the lint
 * pass.
 */
function reactDoctorRules() {
  const excluded = new Set([
    ...ruleNames(RD_DUPLICATED_BY_OXLINT),
    ...ruleNames(RD_UNUSED_LIBRARIES),
    ...ruleNames(RD_CLASS_COMPONENTS),
    ...ruleNames(RD_JSX_STYLE),
    ...ruleNames(RD_DECLINED)
  ])
  const enabled: Record<string, 'error'> = {}
  for (const [name, meta] of Object.entries(REACT_DOCTOR_RULE_REGISTRY)) {
    if (meta.isScanRule || excluded.has(name)) {
      continue
    }
    if (!(meta.requires ?? []).every((capability) => STACK.has(capability))) {
      continue
    }
    enabled[`react-doctor/${name}`] = 'error'
  }
  return enabled
}

// `defineConfig` is used only to contextually type the literal below — oxlint's
// own `OxlintConfig` type is not reachable from here, and without it every
// severity would widen to `string`. Only the `lint` field is exported; the vite
// plugins `defineConfig` adds to its result are discarded.
const { lint = {} } = defineConfig({
  lint: {
    plugins: [
      'typescript',
      'react',
      'react-hooks',
      'jsx-a11y',
      'oxc',
      'unicorn',
      'import',
      'promise',
      'vitest'
    ],
    jsPlugins: [
      'eslint-plugin-better-tailwindcss',
      'oxlint-plugin-effect/plugin',
      {
        name: 'anti-slop',
        specifier: './node_modules/ultracite/config/oxlint/anti-slop/plugin.mjs'
      },
      {
        name: 'starter',
        specifier: './packages/oxlint-plugin/src/index.ts'
      },
      {
        name: 'react-doctor',
        specifier: 'oxlint-plugin-react-doctor'
      },
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin'
      }
    ],
    settings: {
      'better-tailwindcss': {
        entryPoint: 'apps/web/src/index.css'
      }
    },
    options: {
      reportUnusedDisableDirectives: 'deny',
      typeAware: true,
      // Full TS diagnostics stay off: the bundled tsgolint resolves monorepo deps
      // (pnpm's aliased vite, Alchemy's Effect generators) differently from the
      // repo's own `typescript@7.0.2`, reporting overloads tsc accepts — and the
      // repo already has `typecheck` as the dedicated tsc gate. `typeAware` keeps
      // the type-aware lint rules; `typeCheck` would duplicate the tsc gate with a
      // different engine. Revisit when vp bundles a tsgolint that matches.
      typeCheck: false
    },
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'error'
    },
    env: {
      browser: true,
      node: true,
      es2024: true,
      builtin: true
    },
    ignorePatterns: [
      'node_modules/**',
      '.context/**',
      'dist/**',
      '.output/**',
      'apps/web/src/routeTree.gen.ts'
    ],
    rules: {
      ...enable('', CORE),
      ...enable('@typescript-eslint/', TYPESCRIPT),
      ...enable('unicorn/', UNICORN),
      ...enable('oxc/', OXC),
      ...enable('import/', IMPORT),
      ...enable('promise/', PROMISE),
      ...enable('vitest/', VITEST),
      ...enable('react/', REACT),
      ...enable('react-hooks/', REACT_HOOKS),
      ...enable('jsx-a11y/', JSX_A11Y),
      ...enable('effect/', EFFECT),
      ...enable('anti-slop/', ANTI_SLOP),
      ...enable('starter/', STARTER),
      ...enable('vite-plus/', VITE_PLUS),
      ...reactDoctorRules(),

      // --- Deviations ------------------------------------------------------
      // Everything below overrides the blanket `error` above. These are the
      // decisions; the lists above are the defaults.

      // Options, not exceptions: the rule is on, tuned to a repo convention.
      '@typescript-eslint/array-type': ['error', { default: 'generic' }],
      '@typescript-eslint/ban-ts-comment': ['error', { minimumDescriptionLength: 10 }],
      '@typescript-eslint/consistent-indexed-object-style': ['error', 'record'],
      // "type" (not the default "interface"): Effect service shapes and schema-derived
      // aliases are type aliases throughout this repo, and `interface` cannot express them.
      // Declaration merging (`declare module`) and self-referential types still need
      // `interface`; those few sites carry a disable comment naming this rule.
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' }
      ],
      // `ignoreArrowShorthand` is required: without it every `onClick={() => setX(1)}` is a
      // violation, which is idiomatic React, not a confusing void expression.
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true }
      ],
      'func-style': ['error', 'declaration', { allowArrowFunctions: false }],
      'import/consistent-type-specifier-style': ['error', 'prefer-inline'],
      'import/no-unassigned-import': ['error', { allow: ['**/*.css'] }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-else-return': ['error', { allowElseIf: false }],
      'no-underscore-dangle': ['error', { allow: ['_tag'] }],
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          fix: { imports: 'safe-fix', variables: 'off' }
        }
      ],
      'no-warning-comments': ['error', { terms: ['@nocommit'] }],
      'prefer-arrow-callback': ['error', { allowNamedFunctions: true }],
      'prefer-destructuring': ['error', { array: false }],
      // Every raw <button>, <input> and <label> has a wrapper in @/components/ui.
      'react/forbid-elements': [
        'error',
        {
          forbid: [
            {
              element: 'button',
              message:
                'Use <Button> from @/components/ui/button, or add a variant to buttonVariants if none fits.'
            },
            {
              element: 'input',
              message:
                'Use <Input> from @/components/ui/input, or the matching Base UI primitive wrapper in @/components/ui.'
            },
            {
              element: 'label',
              message:
                'Use <Label> from @/components/ui/label so peer-disabled and field wiring stay consistent.'
            }
          ]
        }
      ],
      'react/function-component-definition': [
        'error',
        {
          namedComponents: 'function-declaration',
          unnamedComponents: 'arrow-function'
        }
      ],
      'react/jsx-curly-brace-presence': [
        'error',
        { props: 'never', children: 'never', propElementValues: 'always' }
      ],
      'react/jsx-no-useless-fragment': ['error', { allowExpressions: true }],
      'unicorn/no-instanceof-builtins': ['error', { strategy: 'strict' }],
      'unicorn/no-useless-undefined': [
        'error',
        { checkArguments: false, checkArrowFunctionBody: false }
      ],

      // Off, each for a reason.

      // prefer-as-const is off because it contradicts `effect/noAs`. Given
      // `const x: 'queued' = 'queued'`, prefer-as-const demands `as const`, and noAs then
      // rejects the result. noAs is the rule with the stronger claim, so it wins.
      '@typescript-eslint/prefer-as-const': 'off',
      // consistent-return is off: "return a message, or fall through to undefined" is the
      // shape every validator in the repo uses, because that is the contract TanStack Form
      // wants (`validateEmail`, `validateTokenName`, the inline `onChange` validators) and
      // what `optionalSecret` in alchemy.run.ts needs. The rule would demand an explicit
      // `return undefined` on eleven such functions and buy nothing.
      '@typescript-eslint/consistent-return': 'off',
      // no-unnecessary-type-arguments is off: it fights Effect's convention of spelling out
      // the channels. `Effect.Effect<A, unknown, never>` and `Effect.context<never>()` say
      // "no requirements" to the reader; collapsing them to the defaults makes an Effect
      // signature harder to read, not easier.
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      // no-unnecessary-type-assertion is absent rather than listed, and stays that way.
      // Under oxlint-tsgolint 7.x it is at least deterministic (0.24 flagged necessary casts
      // at random), but it still reports false positives: it called
      // `(await res.json()) as { _tag: string }` unnecessary, and applying the fix produced
      // TS2571 because `Response.json()` returns `unknown`. Since `oxlint --fix` runs in
      // `pnpm run check:fix`, a false positive here silently strips a needed cast.
      // Re-evaluate on the next oxlint-tsgolint upgrade.
      //
      // effect/noNullish is absent for the same reason. It bans `null` and `undefined`
      // outright, which contradicts the Effect v4 schema guidance this repo follows:
      // `Schema.optionalKey` for absent keys, `Schema.optional` when explicit `undefined`
      // is part of the contract, and `Schema.NullOr` / `UndefinedOr` / `NullishOr` when
      // nullish values are part of the encoded contract. It is also unworkable against
      // React and TanStack APIs.

      // Written without the `react/` prefix in the config this file replaced, and
      // kept that way so the resolved rule set does not change. React 17+ needs no
      // React import in scope.
      'react-in-jsx-scope': 'off',
      // Off in the config this file replaced, with no reason recorded there.
      // Kept off so the resolved rule set does not change; turn it back on if
      // nobody can name the case it was hitting.
      'unicorn/no-array-method-this-argument': 'off',
      // Preact rules, named explicitly rather than dropped: this is a React repo, so
      // `preact` is absent from STACK, and these stay pinned off so a react-doctor
      // upgrade that widens the Preact family cannot quietly switch them on.
      'react-doctor/preact-no-children-length': 'off',
      'react-doctor/preact-no-react-hooks-import': 'off',
      'react-doctor/preact-no-render-arguments': 'off',
      'react-doctor/preact-prefer-ondblclick': 'off',
      'react-doctor/preact-prefer-oninput': 'off'
    },
    overrides: [
      {
        files: ['apps/web/**/*.{ts,tsx}'],
        rules: {
          'better-tailwindcss/no-concatenated-classes': 'error',
          'better-tailwindcss/no-conflicting-classes': 'error',
          'better-tailwindcss/no-deprecated-classes': 'error',
          'better-tailwindcss/no-duplicate-classes': 'error',
          'better-tailwindcss/no-restricted-classes': [
            'error',
            {
              restrict: [
                String.raw`^(text|leading|tracking|w|h|min-w|min-h|max-w|max-h|p|px|py|pt|pr|pb|pl|m|mx|my|gap|rounded|z)-\[[^\]]+\]$`
              ]
            }
          ],
          'better-tailwindcss/no-unknown-classes': [
            'error',
            {
              ignore: [
                '^not-prose$',
                '^dark$',
                '^marketing$',
                '^toaster$',
                '^grid-paper$',
                '^band-deep$',
                '^schematic-pulse$',
                '^rise(-[0-9]+)?$',
                '^(bg|text)-brand$'
              ]
            }
          ]
        }
      },
      {
        // No React outside apps/web. rules-of-hooks matches on the `use*` name alone, so
        // Effect's `Effect.useSpan` reads as a hook called from a non-component.
        files: ['packages/**', 'apps/api/**', 'apps/background/**', 'infra/**'],
        rules: {
          'react-hooks/rules-of-hooks': 'off'
        }
      },
      {
        files: [
          'apps/web/src/components/mdx-chart.tsx',
          'apps/web/src/components/charts/**'
        ],
        rules: {
          // The chart components re-export third-party diagram types verbatim, so a
          // deprecated member there is part of the library's shape, not this repo's call.
          '@typescript-eslint/no-deprecated': 'off'
        }
      },
      {
        files: ['apps/web/src/routes/**/*.{ts,tsx}', 'apps/web/src/router.tsx'],
        rules: {
          'react/only-export-components': 'off'
        }
      },
      {
        files: [
          '**/test/**',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.stories.tsx',
          '**/vitest.setup.ts'
        ],
        rules: {
          'no-empty-function': 'off',
          'unicorn/consistent-function-scoping': 'off',
          'starter/no-effect-escape-hatch': 'off',
          'no-await-in-loop': 'off',
          'no-console': 'off',
          'no-script-url': 'off',
          'react/only-export-components': 'off',
          'vitest/require-mock-type-parameters': 'off',
          'vitest/no-conditional-expect': 'off',
          'vitest/expect-expect': [
            'error',
            {
              assertFunctionNames: [
                'expect',
                'expect*',
                'assert*',
                'screen.*',
                'renderWith*'
              ]
            }
          ],
          'vitest/no-standalone-expect': [
            'error',
            {
              additionalTestBlockFunctions: [
                'it.effect',
                'it.live',
                'it.scoped',
                'it.layer'
              ]
            }
          ],
          // Test doubles implement whole third-party interfaces (the fake `D1Database` in
          // `packages/capabilities` has to supply `dump`), so a deprecated member is part of
          // the shape being faked, not a call the starter makes.
          '@typescript-eslint/no-deprecated': 'off',
          'react-hooks/rules-of-hooks': 'off',
          'effect/noTryCatch': 'off',
          'effect/noThrowStatement': 'off',
          'effect/noNewError': 'off',
          'effect/noNewPromise': 'off',
          'anti-slop/no-unknown-parameters': 'off',
          'anti-slop/no-unsafe-dictionary-type': 'off',
          // The bundled oxlint 1.79 engine flags two test-only idioms the previous
          // oxlint 1.80 engine (CI-green on master) accepted: async test doubles whose
          // signature must be async for the API under test but hold no await
          // (`require-await`), and the `!` after a `noUncheckedIndexedAccess` lookup in
          // assertions (`no-non-null-assertion`). Keep the test idiom; re-check when vp
          // bundles oxlint 1.80+.
          '@typescript-eslint/require-await': 'off',
          '@typescript-eslint/no-non-null-assertion': 'off'
        },
        plugins: ['typescript', 'vitest', 'react']
      },
      {
        files: ['scripts/**', 'packages/*/scripts/**', 'infra/**', 'alchemy.run.ts'],
        rules: {
          'no-console': 'off',
          'anti-slop/no-unknown-parameters': 'off',
          'anti-slop/no-unsafe-dictionary-type': 'off',
          'effect/noTryCatch': 'off',
          'effect/noThrowStatement': 'off',
          'effect/noNewError': 'off',
          // Deployment, seeding and build tooling runs on Node before any Worker and before
          // any Effect runtime exists, so `Config` has nowhere to be read from. The Effect
          // guidance scopes `Config` to application logic, and the noGlobals rule itself says
          // platform adapters may switch it off. `process.env`, `process.argv`,
          // `node:fs` and a top-level `await` for the process exit code are the right APIs here.
          'effect/noGlobals': 'off',
          'effect/noNodeBuiltinImport': 'off',
          'effect/noAsyncFunction': 'off',
          // Alchemy provisions optional resources with `yield*` inside a conditional. The
          // `let` + `if` alternative costs a mutable binding and an explicit annotation.
          'effect/noTernary': 'off'
        }
      },
      {
        files: ['packages/db/src/testing.ts', 'packages/db/scripts/**'],
        rules: {
          'no-await-in-loop': 'off'
        }
      },
      {
        // The Effect plugin targets Effect-native TypeScript. These four rules assume no
        // JSX and no DOM: `noTernary` bans conditional rendering, `noAsyncFunction` bans the
        // async event handlers and Testing Library helpers React needs, `noGlobals` bans
        // browser APIs the UI legitimately calls, and `noTestLifecycleHooks` bans the
        // setup/teardown hooks Testing Library and component tests need. The rest of the
        // preset still applies here.
        files: ['apps/web/**'],
        rules: {
          'effect/noTernary': 'off',
          'effect/noAsyncFunction': 'off',
          'effect/noGlobals': 'off',
          'effect/noTestLifecycleHooks': 'off'
        }
      },
      {
        files: ['apps/web/src/components/**', 'apps/web/src/routes/**'],
        rules: {
          'no-restricted-imports': [
            'error',
            {
              patterns: [
                {
                  group: [
                    '@b2b-saas-starter/db',
                    '@b2b-saas-starter/db/*',
                    'drizzle-orm',
                    'drizzle-orm/*'
                  ],
                  message:
                    'UI code must not reach the database. Call a capability through runWorkspaceCapabilities or a server function instead.'
                }
              ]
            }
          ]
        }
      },
      {
        // The one reader of an unknown thrown value. Eight files used to be
        // listed here, each with its own copy of the probe; they all call
        // `failureMessage` now, so the suppression belongs to the helper alone.
        files: ['packages/failure/src/*.ts'],
        rules: {
          'starter/no-unknown-error-message': 'off',
          'unicorn/no-instanceof-builtins': 'off',
          // `unknown` is the input here: the value a promise rejected with,
          // which no schema can narrow before the catch handler runs.
          'anti-slop/no-unknown-parameters': 'off'
        }
      },
      {
        files: ['apps/web/src/router.tsx'],
        rules: {
          'starter/no-unknown-error-message': 'off'
        }
      },
      {
        // The lint plugin is tooling, not application code. Its test harness spawns the
        // real oxlint binary and writes fixtures to a temp directory, which needs
        // `node:child_process` and `node:fs`, and the two vitest rules cannot see through
        // its generic `it()` wrapper to the assertion inside. Everything under `src/` is
        // held to the normal rules.
        files: ['packages/oxlint-plugin/test/**'],
        rules: {
          'effect/noNodeBuiltinImport': 'off',
          'vitest/expect-expect': 'off',
          'vitest/valid-title': 'off'
        }
      },
      {
        // Ambient declaration files cannot use top-level type imports without becoming
        // modules, and augmenting workers-types' `interface Env {}` needs the interface
        // form — which the two style rules below would otherwise reject.
        files: ['**/*.d.ts'],
        rules: {
          '@typescript-eslint/consistent-type-imports': 'off',
          '@typescript-eslint/consistent-type-definitions': 'off',
          '@typescript-eslint/no-empty-object-type': 'off'
        }
      },
      {
        // TanStack Router signals control flow by throwing: `throw notFound()` and
        // `throw redirect()` are its documented API, and route loaders are Promise-typed,
        // so they have no Effect error channel to fail into. Outside the route tree,
        // every throw still needs a per-site justification.
        files: ['apps/web/src/routes/**/*.{ts,tsx}'],
        rules: {
          'effect/noThrowStatement': 'off'
        }
      },
      {
        files: ['apps/web/src/components/ui/**'],
        rules: {
          'react/forbid-elements': 'off',
          'jsx-a11y/label-has-associated-control': 'off'
        },
        plugins: ['jsx-a11y']
      },
      {
        // DESIGN.md class rules. One scheme (Catppuccin Mocha, always dark)
        // makes a `dark:` variant dead code, and raw hex values belong only in
        // index.css where the OKLch tokens are defined — everywhere else the
        // semantic token is the interface. Both rules are scoped to the web
        // app because that is the Tailwind surface; other packages have no
        // stylesheet to drift from.
        files: ['apps/web/**/*.{ts,tsx}'],
        rules: {
          'starter/no-dark-prefix': 'error',
          'starter/no-hex-color': 'error'
        }
      },
      {
        // The root document carries the theme-color meta and the `<html>`
        // scaffolding that must state values before index.css loads.
        files: ['apps/web/src/routes/__root.tsx'],
        rules: {
          'starter/no-hex-color': 'off'
        }
      },
      {
        files: ['packages/logger/src/**', 'apps/web/src/lib/observability.ts'],
        rules: {
          'anti-slop/no-unsafe-dictionary-type': 'off',
          'anti-slop/no-object-parameters': 'off',
          'anti-slop/no-unknown-parameters': 'off'
        }
      },
      {
        // Build configs walk untyped third-party ASTs (mdast/rehype) and plugin option bags.
        // They also run on Node at build time, outside any Worker and any Effect runtime,
        // so `node:path` and friends are the correct APIs there.
        files: ['**/*.config.ts', 'apps/web/src/lib/local-d1-state.ts'],
        rules: {
          // Build-config helpers read better next to the plugin option they feed.
          'unicorn/consistent-function-scoping': 'off',
          'anti-slop/no-unsafe-dictionary-type': 'off',
          'anti-slop/no-unknown-parameters': 'off',
          'effect/noNodeBuiltinImport': 'off',
          'effect/noGlobals': 'off'
        }
      },
      {
        files: [
          'apps/web/src/routes/_knowledge.docs.$category.$slug.tsx',
          'apps/web/src/routes/_knowledge.blog.$slug.tsx',
          'apps/web/src/components/mdx-components.ts',
          'apps/web/src/components/mdx-mermaid.tsx'
        ],
        rules: {
          // MDX pipeline: rendered markdown is trusted repo content, and the component map
          // loads renderers lazily on purpose.
          'react/no-danger': 'off',
          'effect/noDynamicImports': 'off'
        },
        plugins: ['react']
      }
    ]
  }
})

export const lintConfig = lint
