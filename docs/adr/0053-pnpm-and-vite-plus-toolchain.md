# pnpm and Vite+ toolchain

pnpm manages the workspace and Vite+ supplies the pinned Node and frontend toolchain. Vite Task runs package scripts; the pre-commit hook formats staged files. A single toolchain update path avoids coordinating separate runner, formatter, linter, and test-tool pins. Run the documented checks independently of the format-only commit hook.
