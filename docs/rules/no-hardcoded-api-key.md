# llm-app/no-hardcoded-api-key

Disallow API keys written into code, prompts or config.

A key in source ends up in git history, in bundles shipped to browsers, in logs, and, when it's inside a prompt, in the model provider's logs too.

The rule reports:

- Strings and template literals containing a key in a known format: Anthropic (`sk-ant-...`), OpenAI (`sk-...`, `sk-proj-...`), OpenRouter, Google (`AIza...`), Groq (`gsk_...`), xAI, Hugging Face (`hf_...`), Replicate (`r8_...`) and Perplexity.
- A string that looks like a secret assigned to a name such as `apiKey`, `api_key`, `x-api-key`, `OPENAI_API_KEY`, `authToken` or `accessToken`, or a literal `Authorization: "Bearer ..."` header.

Placeholders such as `"your-api-key"`, `"sk-..."` or `"sk-xxxx..."` are allowed.

## Fail

```js
const client = new Anthropic({ apiKey: "sk-ant-api03-..." });
const system = `You are a helpful bot. Call the API with key sk-proj-...`;
const OPENAI_API_KEY = "a8f3k29dk20fj39dk2l1";
```

## Pass

```js
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

If a key was committed, deleting it isn't enough: rotate it in the provider's console.

This rule sees JavaScript and TypeScript files, including config written in them (`config.ts`, `eslint.config.js`). Use a secret scanner such as gitleaks for `.env`, JSON and YAML files.
