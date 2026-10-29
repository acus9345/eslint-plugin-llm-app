import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { docsUrl, findKey, getLlmCall, keyName, memberPath, unwrap, type LlmCall } from "../utils.js";
import { label } from "./require-max-tokens.js";

const TIMEOUT_KEYS = ["timeout", "signal", "abortSignal"];

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require a timeout or abort signal on LLM calls",
      recommended: true,
      url: docsUrl("require-timeout"),
    },
    schema: [
      {
        type: "object",
        properties: {
          checkClients: {
            type: "boolean",
            description: "Accept a `timeout` set when the client is created in the same file (default true).",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missing:
        "This {{api}} call has no timeout or abort signal. SDK defaults wait up to 10 minutes, so a hung request ties up the user and the server; pass {{hint}}.",
    },
  },
  create(context) {
    const checkClients = (context.options[0] as { checkClients?: boolean } | undefined)?.checkClients ?? true;
    const pending: LlmCall[] = [];
    let clientTimeout = false;

    function objectHasTimeout(obj: ESTree.ObjectExpression): boolean {
      return obj.properties.some((p) => p.type === "Property" && ["timeout", "httpOptions"].includes(keyName(p) ?? ""));
    }

    return {
      NewExpression(node: ESTree.NewExpression) {
        const arg = node.arguments[0];
        if (arg?.type === "ObjectExpression" && objectHasTimeout(arg)) clientTimeout = true;
      },
      CallExpression(node: ESTree.CallExpression) {
        // `client.withOptions({ timeout })` and `createOpenAI({ fetch: ... })`-style factories.
        const path = memberPath(unwrap(node.callee));
        const arg = node.arguments[0];
        if (path[path.length - 1] === "withOptions" && arg?.type === "ObjectExpression" && objectHasTimeout(arg)) {
          clientTimeout = true;
        }

        const call = getLlmCall(node);
        if (!call) return;
        const inRequest = findKey(call.request, TIMEOUT_KEYS, ["config", "httpOptions"]);
        if (inRequest !== false) return;
        if (call.options && findKey(call.options, TIMEOUT_KEYS) !== false) return;
        if (node.arguments[1] && !call.options) return; // options passed as a variable
        pending.push(call);
      },
      "Program:exit"() {
        if (checkClients && clientTimeout) return;
        for (const call of pending) {
          const hint =
            call.kind === "ai-sdk"
              ? "`abortSignal: AbortSignal.timeout(ms)`"
              : call.kind === "google"
                ? "`config: { abortSignal: AbortSignal.timeout(ms) }`"
                : "`{ timeout: ms }` as the second argument, or set `timeout` on the client";
          context.report({ node: call.request, messageId: "missing", data: { api: label(call.kind), hint } });
        }
      },
    };
  },
};

export default rule;
