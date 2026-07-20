# Operations Management

Manages dedicated System Operator identities from current D1 facts. Only an
authorized Operator Manager may list operators, replace role assignments, enable or
disable an operator, or delete an operator. Mutations use optimistic timestamps,
prevent self-management and removal of the last enabled manager, revoke affected
Operator Sessions and impersonations atomically, and append accepted or rejected
global Operations audit evidence.
