import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";
import { docsUrl, findKey, findVariable, getLlmCall, getProp, memberPath, unwrap, type LlmCall } from "../utils.js";
import { label } from "./require-max-tokens.js";

const TIMEOUT_KEYS = ["timeout", "signal", "abortSignal"];
const CLIENT_TIMEOUT_KEYS = ["timeout"];

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

    function objectHasTimeout(obj: ESTree.ObjectExpression, keys: string[]): boolean {
      if (findKey(obj, keys) === true) return true;
      const httpOptions = getProp(obj, "httpOptions");
      if (!httpOptions) return false;
      if (httpOptions.value.type !== "ObjectExpression") return true;
      return findKey(httpOptions.value, keys) !== false;
    }

    function isWithOptionsCallWithTimeout(node: ESTree.CallExpression, keys: string[]): boolean {
      const path = memberPath(unwrap(node.callee));
      if (path[path.length - 1] !== "withOptions") return false;
      const arg = node.arguments[0];
      return arg?.type === "ObjectExpression" && objectHasTimeout(arg, keys);
    }

    function calleeHasWithOptionsTimeout(node: ESTree.Node, scope: Scope.Scope, depth = 0): boolean {
      let cur: ESTree.Node | undefined = unwrap(node);
      while (cur) {
        if (cur.type === "CallExpression") {
          if (isWithOptionsCallWithTimeout(cur, TIMEOUT_KEYS)) return true;
          cur = unwrap(cur.callee);
        } else if (cur.type === "MemberExpression") {
          cur = unwrap(cur.object);
        } else if (cur.type === "Identifier" && checkClients && depth < 2) {
          const v = findVariable(scope, cur.name);
          const def = v?.defs[0];
          if (v?.defs.length === 1 && def?.node.type === "VariableDeclarator" && def.node.init) {
            return calleeHasWithOptionsTimeout(def.node.init, scope, depth + 1);
          }
          break;
        } else {
          break;
        }
      }
      return false;
    }

    return {
      NewExpression(node: ESTree.NewExpression) {
        const arg = node.arguments[0];
        if (arg?.type === "ObjectExpression" && objectHasTimeout(arg, CLIENT_TIMEOUT_KEYS)) clientTimeout = true;
      },
      CallExpression(node: ESTree.CallExpression) {
        // `client.withOptions({ timeout })` counts as a file-level client timeout.
        if (isWithOptionsCallWithTimeout(node, CLIENT_TIMEOUT_KEYS)) {
          clientTimeout = true;
        }

        const call = getLlmCall(node);
        if (!call) return;
        const inRequest = findKey(call.request, TIMEOUT_KEYS, ["config", "httpOptions"]);
        if (inRequest !== false) return;
        if (call.options && findKey(call.options, TIMEOUT_KEYS) !== false) return;
        if (node.arguments[1] && !call.options) return; // options passed as a variable
        if (calleeHasWithOptionsTimeout(node.callee, context.sourceCode.getScope(node))) return;
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
