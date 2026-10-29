# eslint-plugin-llm-app

ESLint rules for the mistakes that bite LLM apps in production: calls with no token limit or timeout, retry loops that never stop, hardcoded API keys, streams nobody reads and `JSON.parse` on raw model output.

[![npm](https://img.shields.io/npm/v/eslint-plugin-llm-app)](https://www.npmjs.com/package/eslint-plugin-llm-app)
[![CI](https://github.com/acus9345/eslint-plugin-llm-app/actions/workflows/ci.yml/badge.svg)](https://github.com/acus9345/eslint-plugin-llm-app/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/eslint-plugin-llm-app)](LICENSE)

```
src/plan.ts
  12:46  warning  This OpenAI Chat Completions call has no output token limit (max_completion_tokens or max_tokens)  llm-app/require-max-tokens
  12:46  warning  This OpenAI Chat Completions call has no timeout or abort signal ...                               llm-app/require-timeout
  18:16  warning  JSON.parse on raw model output throws when the model wraps the JSON in a ```json fence ...        llm-app/no-json-parse-llm-output
  24:3   error    This retry loop has no limit ...                                                                 llm-app/no-unbounded-retry
```

Works with the Anthropic, OpenAI and Google GenAI SDKs and the Vercel AI SDK, in JavaScript and TypeScript.

## Install

```bash
npm install --save-dev eslint eslint-plugin-llm-app
```

ESLint 9 or later, flat config:

```js
// eslint.config.js
import llmApp from "eslint-plugin-llm-app";

export default [
  llmApp.configs.recommended,
];
```

For TypeScript, add a parser such as `typescript-eslint` as usual; the rules don't need type information. `llmApp.configs.strict` turns every rule into an error. To pick rules yourself:

```js
export default [
  {
    plugins: { "llm-app": llmApp },
    rules: {
      "llm-app/no-hardcoded-api-key": "error",
      "llm-app/require-timeout": ["warn", { checkClients: false }],
    },
  },
];
```

## Rules

| Rule | What it catches | Recommended |
| --- | --- | --- |
| [require-max-tokens](docs/rules/require-max-tokens.md) | An LLM call with no output token limit | warn |
| [require-timeout](docs/rules/require-timeout.md) | An LLM call with no timeout or abort signal (the SDK default is 10 minutes) | warn |
| [no-unbounded-retry](docs/rules/no-unbounded-retry.md) | A `while (true)` / `for (;;)` retry loop with no attempt limit | error |
| [no-hardcoded-api-key](docs/rules/no-hardcoded-api-key.md) | An Anthropic, OpenAI, Google, Groq, xAI, Hugging Face or similar key in code, a prompt or a config object | error |
| [no-unconsumed-stream](docs/rules/no-unconsumed-stream.md) | A streaming response that's thrown away or never read | error |
| [no-json-parse-llm-output](docs/rules/no-json-parse-llm-output.md) | `JSON.parse` on `choices[0].message.content`, `content[0].text`, `output_text` and the like | warn |

## How it finds LLM calls

The rules look at the shape of the call, without type information:

- Anthropic: `*.messages.create()`, `.stream()`, `.parse()`
- OpenAI: `*.chat.completions.create()`, `*.responses.create()`, `*.completions.create()` and their `stream` / `parse` variants
- Google GenAI: `*.generateContent()`, `*.generateContentStream()`
- AI SDK: `generateText()`, `streamText()`, `generateObject()`, `streamObject()`

The first argument has to be an object literal with a `model` key. That keeps look-alike APIs out (Twilio also has `client.messages.create`), and it means a request built elsewhere and passed in as a variable isn't checked. A request that spreads in other options is skipped too, because the missing setting may be in the spread. The rules lean toward missing a problem rather than reporting one that isn't there.

## License

MIT
