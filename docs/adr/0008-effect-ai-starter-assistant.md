# Effect AI starter assistant

The assistant uses one Effect `LanguageModel` workflow with Workers AI, OpenAI-compatible, and deterministic mock adapters. Configuration selects the layer, and provider/model identifiers come from that selected context. Typed AI errors map to safe application failures rather than silently switching providers.

The [accepted persistent assistant specification](https://github.com/brandhaug/b2b-saas-starter/issues/444) keeps model execution, context limits and interruption in Effect. AIChatAgent will own saved messages and reconnectable streaming through a narrow adapter to the AI SDK UI-message protocol. This avoids replacing application services or adopting a second model-execution layer; the protocol dependency is an explicit integration cost.

Persistence and streaming are not implemented yet. Current adapters accept system/user text and reject tools, structured output and streaming. The planned implementation adds assistant-role history and streaming, keeps tools disabled, and permits mock generation only for explicit demos/tests. Unconfigured persistent web and REST generation will refuse clearly while conversation browsing and management remain available.
