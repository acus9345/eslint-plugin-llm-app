# llm-app/no-json-parse-llm-output

Disallow `JSON.parse` on raw model output.

Even when asked for JSON, models sometimes wrap it in a Markdown code fence, add a sentence before it, leave a trailing comma, or stop mid-object when they hit the token limit. `JSON.parse` throws on all of those, usually in production.

The rule reports `JSON.parse(x)` when `x` is read from an SDK response:

- OpenAI: `completion.choices[0].message.content`, `.choices[0].text`, `tool_calls[0].function.arguments`, `response.output_text`
- Anthropic: `message.content[0].text`
- Google: `result.response.text()`, `candidates[0].content.parts[0].text`, `(await ai.models.generateContent(...)).text`
- AI SDK: `text` from `generateText()` or `streamText()`
- Ollama-style: `response.message.content`
- A variable holding one of the above, such as `const content = completion.choices[0].message.content`

## Fail

```js
const plan = JSON.parse(completion.choices[0].message.content);

const { text } = await generateText({ model, prompt });
const data = JSON.parse(text);
```

## Pass

Use structured outputs where the provider has them, or parse with a tolerant parser such as [llm-json-mend](https://www.npmjs.com/package/llm-json-mend), which strips fences, fixes common syntax slips and can validate against a schema:

```js
import { parseJson, parseWithSchema } from "llm-json-mend";

const plan = parseJson(completion.choices[0].message.content);
const data = parseWithSchema(text, PlanSchema);
```
