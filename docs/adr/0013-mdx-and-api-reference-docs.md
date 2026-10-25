# MDX and API reference docs

Narrative documentation lives in MDX. The API worker derives OpenAPI and its Scalar reference from the served HTTP contract, avoiding a separately maintained endpoint description. MCP documentation explains its credential and tool interface while referring to the same capability behavior.

Selected architecture fences use [source-backed examples](../source-examples.md).
A build-only remark plugin validates their explicit text against unique contiguous
lines in the current checkout and adds source links before highlighting. Keeping
ordinary fenced text makes examples readable in source and available to Markdown
exporters. Tutorial code that readers add remains ordinary fences. Historical and
external quotations use immutable links; builds do not fetch repositories.
