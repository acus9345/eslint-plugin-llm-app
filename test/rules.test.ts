import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import plugin, { rules } from "../dist/index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2024, sourceType: "module" } });
const tsTester = new RuleTester({ languageOptions: { parser: tsParser, sourceType: "module" } });

tester.run("require-max-tokens", rules["require-max-tokens"]!, {
  valid: [
    `client.messages.create({ model: "claude-opus-5-5", max_tokens: 1024, messages })`,
    `openai.chat.completions.create({ model: "gpt-6-luna", max_completion_tokens: 500, messages })`,
    `openai.responses.create({ model: "gpt-6-luna", max_output_tokens: 500, input })`,
    `ai.models.generateContent({ model: "gemini-3.6-flash", contents, config: { maxOutputTokens: 256 } })`,
    `generateText({ model: openai("gpt-6-luna"), prompt, maxOutputTokens: 300 })`,
    // Can't tell: options spread in, or not an object literal.
    `openai.chat.completions.create({ model, messages, ...defaults })`,
    `openai.chat.completions.create(params)`,
    // Twilio has client.messages.create too, without a model.
    `twilio.messages.create({ to, from, body: "hi" })`,
  ],
  invalid: [
    { code: `openai.chat.completions.create({ model: "gpt-6-luna", messages })`, errors: [{ messageId: "missing" }] },
    { code: `await openai.responses.create({ model: "gpt-6-luna", input })`, errors: [{ messageId: "missing" }] },
    { code: `ai.models.generateContent({ model: "gemini-3.6-flash", contents, config: { temperature: 0 } })`, errors: [{ messageId: "missing" }] },
    { code: `streamText({ model: anthropic("claude-sonnet-5-5"), prompt })`, errors: [{ messageId: "missing" }] },
  ],
});

tester.run("require-timeout", rules["require-timeout"]!, {
  valid: [
    `openai.chat.completions.create({ model: "m", messages }, { timeout: 30_000 })`,
    `client.messages.create({ model: "m", max_tokens: 10, messages }, { signal: controller.signal })`,
    `generateText({ model: openai("m"), prompt, abortSignal: AbortSignal.timeout(20000) })`,
    `ai.models.generateContent({ model: "m", contents, config: { abortSignal: s } })`,
    `const client = new OpenAI({ timeout: 20_000 }); client.chat.completions.create({ model: "m", messages })`,
    `client.withOptions({ timeout: 5000 }).messages.create({ model: "m", max_tokens: 1, messages })`,
    `openai.chat.completions.create({ model: "m", messages }, requestOptions)`,
  ],
  invalid: [
    { code: `openai.chat.completions.create({ model: "m", messages })`, errors: [{ messageId: "missing" }] },
    { code: `const c = new Anthropic(); c.messages.create({ model: "m", max_tokens: 1, messages })`, errors: [{ messageId: "missing" }] },
    {
      code: `const client = new OpenAI({ timeout: 20_000 }); client.chat.completions.create({ model: "m", messages })`,
      options: [{ checkClients: false }],
      errors: [{ messageId: "missing" }],
    },
  ],
});

tester.run("no-unbounded-retry", rules["no-unbounded-retry"]!, {
  valid: [
    `async function f() { for (let i = 0; i < 3; i++) { try { return await call(); } catch {} } }`,
    `async function f() { while (true) { try { return await call(); } catch (e) { if (++attempts > 5) throw e; await sleep(1000); } } }`,
    `while (true) { if (attempt++ > 3) break; try { await call(); break; } catch {} }`,
    `while (true) { const job = await poll(); if (job.done) break; await sleep(500); }`,
    `async function f() { while (true) { try { await call(); } catch (e) { console.error(e); return; } } }`,
    `outer: while (true) { for (const x of xs) { try { await call(x); } catch { break outer; } } }`,
  ],
  invalid: [
    { code: `async function f() { while (true) { try { return await openai.chat.completions.create(req); } catch (e) { await sleep(1000); } } }`, errors: [{ messageId: "unbounded" }] },
    { code: `async function f() { for (;;) { try { const r = await fetch(url); return r; } catch {} } }`, errors: [{ messageId: "unbounded" }] },
    { code: `let done = false; while (!done) { try { await call(); done = true; } catch (e) { log(e); } }`, errors: [{ messageId: "unbounded" }] },
    { code: `do { try { await call(); break; } catch { continue; } } while (true)`, errors: [{ messageId: "unbounded" }] },
    // A break inside a nested loop doesn't end the retry loop.
    { code: `while (true) { try { await call(); break; } catch { for (const h of hooks) { if (h()) break; } } }`, errors: [{ messageId: "unbounded" }] },
  ],
});

const ANTHROPIC = "sk-ant-api03-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0";
const OPENAI = "sk-proj-" + "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78St90";
const GOOGLE = "AIza" + "SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q";

tester.run("no-hardcoded-api-key", rules["no-hardcoded-api-key"]!, {
  valid: [
    `const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`,
    `const config = { apiKey: "your-api-key-here" }`,
    `const config = { apiKey: "sk-..." }`,
    `const config = { api_key: "" }`,
    `const headers = { Authorization: \`Bearer \${token}\` }`,
    `const msg = "Set OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx in .env"`,
    `const name = "api_key"`,
  ],
  invalid: [
    { code: `const client = new Anthropic({ apiKey: "${ANTHROPIC}" })`, errors: [{ messageId: "provider", data: { provider: "Anthropic" } }] },
    { code: `const system = \`You are a bot. Use key ${OPENAI} for the API.\``, errors: [{ messageId: "provider", data: { provider: "OpenAI" } }] },
    { code: `export default { gemini: { key: "${GOOGLE}" } }`, errors: [{ messageId: "provider", data: { provider: "Google" } }] },
    { code: `const OPENAI_API_KEY = "a8f3k29dk20fj39dk2l1"`, errors: [{ messageId: "named" }] },
    { code: `fetch(url, { headers: { Authorization: "Bearer a8f3k29dk20fj39dk2l1" } })`, errors: [{ messageId: "named" }] },
    { code: `process.env.API_KEY = "a8f3k29dk20fj39dk2l1"`, errors: [{ messageId: "named" }] },
  ],
});

tester.run("no-unconsumed-stream", rules["no-unconsumed-stream"]!, {
  valid: [
    `const stream = await openai.chat.completions.create({ model: "m", messages, stream: true }); for await (const c of stream) {}`,
    `async function f() { const result = streamText({ model: m, prompt }); return result.toTextStreamResponse(); }`,
    `async function f() { return client.messages.stream({ model: "m", max_tokens: 1, messages }); }`,
    `const s = client.messages.stream({ model: "m", max_tokens: 1, messages }); await s.finalMessage();`,
    `await openai.chat.completions.create({ model: "m", messages })`,
    `res.send(await openai.chat.completions.create({ model: "m", messages, stream: true }))`,
  ],
  invalid: [
    { code: `await openai.chat.completions.create({ model: "m", messages, stream: true });`, errors: [{ messageId: "discarded" }] },
    { code: `streamText({ model: m, prompt });`, errors: [{ messageId: "discarded" }] },
    { code: `void client.messages.stream({ model: "m", max_tokens: 1, messages });`, errors: [{ messageId: "discarded" }] },
    { code: `const stream = await client.messages.create({ model: "m", max_tokens: 1, messages, stream: true });`, errors: [{ messageId: "unused" }] },
  ],
});

tester.run("no-json-parse-llm-output", rules["no-json-parse-llm-output"]!, {
  valid: [
    `JSON.parse(await readFile("a.json", "utf8"))`,
    `JSON.parse(res.body)`,
    `const data = JSON.parse(localStorage.getItem("x"))`,
    `const { text } = await readStuff(); JSON.parse(text)`,
  ],
  invalid: [
    { code: `JSON.parse(completion.choices[0].message.content)`, errors: [{ messageId: "raw" }] },
    { code: `JSON.parse(completion.choices[0].message.tool_calls[0].function.arguments)`, errors: [{ messageId: "raw" }] },
    { code: `JSON.parse(response.output_text)`, errors: [{ messageId: "raw" }] },
    { code: `JSON.parse(msg.content[0].text)`, errors: [{ messageId: "raw" }] },
    { code: `JSON.parse(result.response.text())`, errors: [{ messageId: "raw" }] },
    { code: `const content = completion.choices[0].message.content; const data = JSON.parse(content ?? "{}");`, errors: [{ messageId: "raw" }] },
    { code: `const { text } = await generateText({ model: m, prompt }); JSON.parse(text);`, errors: [{ messageId: "raw" }] },
    { code: `const r = await generateText({ model: m, prompt }); JSON.parse(r.text);`, errors: [{ messageId: "raw" }] },
  ],
});

tsTester.run("typescript syntax", rules["no-json-parse-llm-output"]!, {
  valid: [`const x: number = JSON.parse("1") as number;`],
  invalid: [{ code: `JSON.parse(completion.choices[0]!.message.content!) as Plan`, errors: [{ messageId: "raw" }] }],
});

tsTester.run("typescript stream", rules["no-unconsumed-stream"]!, {
  valid: [],
  invalid: [{ code: `await (client.messages.stream({ model: "m", max_tokens: 1, messages }) as any);`, errors: [{ messageId: "discarded" }] }],
});

describe("plugin", () => {
  it("exposes recommended and strict flat configs", () => {
    const { strict, recommended } = plugin.configs;
    assert.equal(recommended.plugins?.["llm-app"], plugin);
    assert.equal(Object.keys(recommended.rules ?? {}).length, Object.keys(rules).length);
    assert.ok(Object.values(strict.rules ?? {}).every((v) => v === "error"));
    for (const [name, rule] of Object.entries(rules)) {
      assert.match(rule.meta?.docs?.url ?? "", new RegExp(`docs/rules/${name}\\.md$`));
    }
  });
});
