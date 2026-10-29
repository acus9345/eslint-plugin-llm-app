# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-29

### Added

- `require-max-tokens`: LLM calls with no output token limit.
- `require-timeout`: LLM calls with no timeout or abort signal, with a `checkClients` option for client-level timeouts.
- `no-unbounded-retry`: retry loops with no attempt limit.
- `no-hardcoded-api-key`: provider API keys and secrets in code, prompts and config objects.
- `no-unconsumed-stream`: streaming responses that are discarded or never read.
- `no-json-parse-llm-output`: `JSON.parse` on raw model output, pointing to structured outputs or llm-json-mend.
- `recommended` and `strict` flat configs.
- Support for the Anthropic, OpenAI and Google GenAI SDKs and the Vercel AI SDK.

[0.1.0]: https://github.com/acus9345/eslint-plugin-llm-app/releases/tag/v0.1.0
