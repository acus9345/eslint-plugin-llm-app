import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { docsUrl, findKey, getLlmCall, type CallKind } from "../utils.js";

const KEYS: Record<CallKind, string[]> = {
  anthropic: ["max_tokens"],
  "openai-chat": ["max_completion_tokens", "max_tokens"],
  "openai-responses": ["max_output_tokens"],
  "openai-completions": ["max_tokens"],
  google: ["maxOutputTokens"],
  "ai-sdk": ["maxOutputTokens", "maxTokens"],
};

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require an output token limit on LLM calls",
      recommended: true,
      url: docsUrl("require-max-tokens"),
    },
    schema: [],
    messages: {
      missing:
        "This {{api}} call has no output token limit ({{keys}}). A runaway response costs money and time; set a limit that fits the task.",
    },
  },
  create(context) {
    return {
      CallExpression(node: ESTree.CallExpression) {
        const call = getLlmCall(node);
        if (!call) return;
        const keys = KEYS[call.kind];
        if (findKey(call.request, keys, ["config", "generationConfig", "providerOptions"]) !== false) return;
        context.report({
          node: call.request,
          messageId: "missing",
          data: { api: label(call.kind), keys: keys.join(" or ") },
        });
      },
    };
  },
};

export function label(kind: CallKind): string {
  return {
    anthropic: "Anthropic",
    "openai-chat": "OpenAI Chat Completions",
    "openai-responses": "OpenAI Responses",
    "openai-completions": "OpenAI Completions",
    google: "Google GenAI",
    "ai-sdk": "AI SDK",
  }[kind];
}

export default rule;
