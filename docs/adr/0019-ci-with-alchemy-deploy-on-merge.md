# CI with Alchemy deploy on merge

GitHub Actions validates changes and deploys through Alchemy after CI and end-to-end tests pass on `master`. Manual dispatch supports a selected ref. Using the repository deploy command in both paths avoids a second infrastructure definition; required production configuration must fail visibly when absent. The workflow and [setup guide](../setup.md) own the current command sequence.
