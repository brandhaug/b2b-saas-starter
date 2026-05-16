# Effect errors over better-result

The starter uses Effect v4 typed errors, schemas, and results as its error model instead of carrying `better-result` forward from Contributor as a parallel convention. Contributor utilities that depend on `better-result` should be adapted to Effect patterns unless an interop boundary genuinely requires a plain result value.
