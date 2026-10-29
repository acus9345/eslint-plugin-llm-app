# llm-app/require-timeout

Require a timeout or abort signal on LLM calls.

The Anthropic and OpenAI SDKs wait up to 10 minutes by default, and retry on top of that. A hung request ties up a server worker and leaves the user staring at a spinner.

## Fail

```js
const client = new OpenAI();
await client.chat.completions.create({ model: "gpt-6-luna", messages, max_completion_tokens: 500 });
```

## Pass

```js
// Per request
await client.chat.completions.create({ model, messages, max_completion_tokens: 500 }, { timeout: 30_000 });
await client.messages.create({ model, max_tokens: 500, messages }, { signal: AbortSignal.timeout(30_000) });
await generateText({ model, prompt, abortSignal: AbortSignal.timeout(30_000) });
await ai.models.generateContent({ model, contents, config: { abortSignal: AbortSignal.timeout(30_000) } });

// Or on the client, in the same file
const client = new OpenAI({ timeout: 30_000 });
await client.withOptions({ timeout: 10_000 }).chat.completions.create({ model, messages });
```

When the options are passed as a variable (`create(req, options)`), the call isn't reported.

## Options

```js
"llm-app/require-timeout": ["warn", { checkClients: false }]
```

- `checkClients` (default `true`): a `new X({ timeout })` or `.withOptions({ timeout })` anywhere in the file counts as a timeout for every call in it. Set it to `false` to require one on each call.
