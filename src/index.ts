import { readFileSync } from "node:fs";
import type { ESLint, Linter, Rule } from "eslint";
import noHardcodedApiKey from "./rules/no-hardcoded-api-key.js";
import noJsonParseLlmOutput from "./rules/no-json-parse-llm-output.js";
import noUnboundedRetry from "./rules/no-unbounded-retry.js";
import noUnconsumedStream from "./rules/no-unconsumed-stream.js";
import requireMaxTokens from "./rules/require-max-tokens.js";
import requireTimeout from "./rules/require-timeout.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string; version: string };

export const rules: Record<string, Rule.RuleModule> = {
  "require-max-tokens": requireMaxTokens,
  "require-timeout": requireTimeout,
  "no-unbounded-retry": noUnboundedRetry,
  "no-hardcoded-api-key": noHardcodedApiKey,
  "no-unconsumed-stream": noUnconsumedStream,
  "no-json-parse-llm-output": noJsonParseLlmOutput,
};

const recommendedRules: Linter.RulesRecord = {
  "llm-app/require-max-tokens": "warn",
  "llm-app/require-timeout": "warn",
  "llm-app/no-unbounded-retry": "error",
  "llm-app/no-hardcoded-api-key": "error",
  "llm-app/no-unconsumed-stream": "error",
  "llm-app/no-json-parse-llm-output": "warn",
};

const plugin = {
  meta: { name: pkg.name, version: pkg.version, namespace: "llm-app" },
  rules,
  configs: {} as Record<"recommended" | "strict", Linter.Config>,
} satisfies ESLint.Plugin;

plugin.configs.recommended = {
  name: "llm-app/recommended",
  plugins: { "llm-app": plugin },
  rules: recommendedRules,
};

plugin.configs.strict = {
  name: "llm-app/strict",
  plugins: { "llm-app": plugin },
  rules: Object.fromEntries(Object.keys(recommendedRules).map((name) => [name, "error"])),
};

export const configs = plugin.configs;
export default plugin;
