# Build-time syntax highlighting with Shiki

The starter highlights code blocks at build time using Shiki through the MDX rehype pipeline, so docs, blog posts, and landing-page code snippets share one rendering path and ship zero highlighting JavaScript to the browser. A small `<CodeBlock>` component wraps `<pre>` output for landing-page snippets that are authored in TypeScript rather than MDX so the same theming is applied everywhere.
