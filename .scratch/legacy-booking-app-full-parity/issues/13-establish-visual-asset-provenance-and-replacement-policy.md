# Establish Visual Asset Provenance and Replacement Policy

Type: research
Status: resolved
Blocked by: 03

## Question

What redistribution and usage rights can be established from primary evidence for each bundled SF Pro and Bebas Neue font, the password-mask font, the 96 SVG assets and provider marks, and the referenced group-appointment Lottie animation—and for every asset whose rights or source cannot be established, what parity-safe licensed replacement, product-owned retrieval step, or implementation constraint must the full-parity plan require?

## Answer

The primary-source findings and per-class requirements are recorded in [Visual Asset Provenance and Replacement Policy](../research/visual-asset-provenance-and-replacement-policy.md).

The checked-in legacy assets are visual evidence, not a redistributable library. The rebuilt app must not ship the bundled SF Pro subsets: Apple's published terms do not provide a suitable grant for modified webfont redistribution, so parity uses the installed system UI stack on Apple platforms and a visually validated open fallback elsewhere. The untraceable password-mask WOFF must be removed in favor of native password masking. Bebas Neue may remain only by replacing the legacy bytes with a reproducibly subsetted, hashed upstream release under SIL OFL 1.1 and retaining its notices.

Rights remain unestablished for all 96 SVGs and the missing group-appointment Lottie content. Product-owned UI symbols and illustrations require a documented ownership/assignment record or a clean, independently licensed recreation; provider and payment marks must come from current official SDKs, brand kits, or the contracted PSP/acquirer and appear only for enabled integrations. Until those marks are authorized, generic product-owned icons and accessible text are the required fallback. The Lottie must be retrieved from the product/design DAM with ownership evidence or replaced by newly commissioned or product-owned CSS/SVG motion that preserves timing and communicative purpose without tracing the missing work.

The implementation plan must require an asset manifest recording source, owner, terms, permitted use, notices, hashes, transformations, reviewer, and expiry/replacement trigger for every shipped visual asset. CI must reject unmanifested assets and the known legacy font hashes. Visual parity tests compare observable role, layout, silhouette, color, and timing; they must never require copying an unproven binary or path. This closes the provenance decision without adding a new Wayfinder ticket: applying the manifest gate and replacements belongs in [Synthesize the Full-Parity Implementation Plan](./12-synthesize-full-parity-implementation-plan.md).
