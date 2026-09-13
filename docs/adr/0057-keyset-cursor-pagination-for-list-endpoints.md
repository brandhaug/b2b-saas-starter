# Keyset pagination for list endpoints

REST and MCP list operations share cursor and limit inputs and return items plus a continuation cursor. Keyset positions use the collection's canonical sort key and ID tie-breaker, preventing inserted rows from shifting an offset-based page boundary.

The shared cursor helpers own encoding, limit clamping, and page construction; Live SQL and Seed ordering must agree. Clients treat cursors as opaque. Malformed cursors return an empty page. Public contracts and collection implementations own current limits and ordering, avoiding another endpoint inventory here.

Workspace audit and system failed-delivery views can select multiple sort fields.
Their capability-owned cursor codecs carry the ordered field values, an ID
tie-breaker, and the normalized filter/sort context. Reusing a cursor with a
different view returns an empty page. Live builds parameterized filter and
lexicographic resume predicates before applying the page limit; Seed evaluates
the same view before cutting a page. Other collection reads keep their canonical
sort and shared cursor codec.
