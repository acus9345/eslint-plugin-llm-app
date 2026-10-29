# llm-app/no-unbounded-retry

Disallow retry loops that never give up.

When a provider has an outage, rate-limits you, or rejects the request for good (bad key, context too long), a `while (true)` retry loop spins forever, burning quota and hiding the error.

The rule reports a `while`, `do...while` or `for` loop that has no real condition (`true`, `for (;;)`, or a bare flag such as `!done`), contains a `try`/`catch` around a call, and has no way out except success. A `throw`, `return`, `break` or `process.exit()` anywhere outside the `try` block counts as a limit.

## Fail

```js
while (true) {
  try {
    return await openai.chat.completions.create(req);
  } catch (err) {
    await sleep(1000);
  }
}

let done = false;
while (!done) {
  try {
    await send();
    done = true;
  } catch {}
}
```

## Pass

```js
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    return await openai.chat.completions.create(req);
  } catch (err) {
    if (attempt === 5) throw err;
    await sleep(2 ** attempt * 250);
  }
}
```

The official SDKs already retry rate limits and server errors (`maxRetries`, default 2). Often the simplest fix is to delete the loop and set `maxRetries` on the client.
