# llm-app/no-unconsumed-stream

Disallow streaming LLM responses that are never read.

A streaming request that nobody reads keeps the HTTP connection open until the server gives up, and the model still generates (and bills) the output. It's usually a leftover from switching to streaming, or a missing `return`.

The rule reports a streaming call (`stream: true`, `.messages.stream()`, `.chat.completions.stream()`, `.responses.stream()`, `generateContentStream()`, `streamText()`, `streamObject()`) whose result is thrown away or stored in a variable that's never read.

## Fail

```js
await openai.chat.completions.create({ model, messages, stream: true });

const stream = await client.messages.create({ model, max_tokens: 500, messages, stream: true });

streamText({ model, prompt });
```

## Pass

```js
const stream = await openai.chat.completions.create({ model, messages, stream: true });
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");

return streamText({ model, prompt }).toTextStreamResponse();

const message = await client.messages.stream({ model, max_tokens: 500, messages }).finalMessage();
```
