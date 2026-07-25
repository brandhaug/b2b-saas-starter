# Issue tracker: Local Markdown

Issues and PRDs for this repository live as Markdown files in `.scratch/`. External pull requests are not part of the triage queue.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append under a `## Comments` heading

When a skill says to publish to the issue tracker, create or update the corresponding file under `.scratch/<feature-slug>/`.

## Wayfinding operations

- The map is `.scratch/<effort>/map.md`.
- Child tickets are `.scratch/<effort>/issues/<NN>-<slug>.md`.
- A `Type:` line records `research`, `prototype`, `grilling`, or `task`.
- A `Status:` line records `claimed` or `resolved` for Wayfinder tickets.
- A `Blocked by:` line records dependency ticket numbers.
