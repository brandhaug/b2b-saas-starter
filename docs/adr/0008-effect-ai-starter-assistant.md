# Effect AI starter assistant

The assistant uses one Effect `LanguageModel` workflow with Workers AI, OpenAI-compatible, and deterministic mock adapters. Configuration selects the layer; missing provider credentials keep local development usable. Provider and model identifiers come from the selected model context so replies report the provider that actually answered.

Adapters accept system/user text prompts and reject unsupported tools, structured output, and streaming rather than silently dropping inputs. They use typed AI errors internally; the assistant boundary maps failures to its public unavailable error. Shared acceptance and error policies keep provider switching out of application behavior.
