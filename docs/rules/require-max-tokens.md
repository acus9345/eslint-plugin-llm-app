# llm-app/require-max-tokens

Require an output token limit on LLM calls.

Without a limit, a model that loops or rambles keeps generating until it hits the model's own maximum. You pay for every token and the user waits for all of them.

## Fail

```js
await openai.chat.completions.create({ model: "gpt-6-luna", messages });
await openai.responses.create({ model: "gpt-6-luna", input });
await ai.models.generateContent({ model: "gemini-3.6-flash", contents });
await generateText({ model: anthropic("claude-sonnet-5-5"), prompt });
```

## Pass

```js
await openai.chat.completions.create({ model: "gpt-6-luna", messages, max_completion_tokens: 800 });
await openai.responses.create({ model: "gpt-6-luna", input, max_output_tokens: 800 });
await ai.models.generateContent({ model: "gemini-3.6-flash", contents, config: { maxOutputTokens: 800 } });
await generateText({ model: anthropic("claude-sonnet-5-5"), prompt, maxOutputTokens: 800 });
```

| SDK | Calls checked | Accepted keys |
| --- | --- | --- |
| Anthropic | `*.messages.create/stream/parse` | `max_tokens` |
| OpenAI | `*.chat.completions.create/stream/parse` | `max_completion_tokens`, `max_tokens` |
| OpenAI | `*.responses.create/stream/parse` | `max_output_tokens` |
| OpenAI | `*.completions.create` | `max_tokens` |
| Google GenAI | `*.generateContent`, `*.generateContentStream` | `maxOutputTokens` (also inside `config` or `generationConfig`) |
| AI SDK | `generateText`, `streamText`, `generateObject`, `streamObject` | `maxOutputTokens`, `maxTokens` |

Only calls whose first argument is an object literal with a `model` key are checked, so Twilio's `client.messages.create({ to, body })` is left alone. A request that spreads in other options (`{ ...defaults, model }`) is skipped, since the limit may be in there.
