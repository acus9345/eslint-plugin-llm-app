import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { docsUrl, getLlmCall, getProp, parentOf } from "../utils.js";

const STREAM_METHODS = new Set(["stream", "streamText", "streamObject", "generateContentStream"]);

/** Whether the call returns a stream: `stream: true`, `.stream()`, `streamText()` and similar. */
function isStreamingCall(node: ESTree.CallExpression): boolean {
  const call = getLlmCall(node);
  if (!call) return false;
  if (STREAM_METHODS.has(call.method)) return true;
  const stream = getProp(call.request, "stream");
  return stream?.value.type === "Literal" && stream.value.value === true;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow streaming LLM responses that are never read",
      recommended: true,
      url: docsUrl("no-unconsumed-stream"),
    },
    schema: [],
    messages: {
      discarded:
        "This streaming response is thrown away. An unread stream keeps the connection open and you still pay for the output; read it, or drop `stream` if you don't need it.",
      unused:
        "`{{name}}` holds a streaming response that is never read. An unread stream keeps the connection open and you still pay for the output; iterate it, pipe it to the response, or await its final message.",
    },
  },
  create(context) {
    return {
      CallExpression(node: ESTree.CallExpression) {
        if (!isStreamingCall(node)) return;
        // Climb through `await` and `void`.
        let child: ESTree.Node = node;
        let parent = parentOf(node);
        while (
          parent &&
          (parent.type === "AwaitExpression" ||
            (parent.type === "UnaryExpression" && parent.operator === "void") ||
            (parent as { type: string }).type === "TSAsExpression" ||
            (parent as { type: string }).type === "TSNonNullExpression")
        ) {
          child = parent;
          parent = parentOf(parent);
        }
        if (!parent) return;
        if (parent.type === "ExpressionStatement") {
          context.report({ node, messageId: "discarded" });
          return;
        }
        if (parent.type === "VariableDeclarator" && parent.init === child && parent.id.type === "Identifier") {
          const [variable] = context.sourceCode.getDeclaredVariables(parent);
          if (variable && !variable.references.some((ref) => ref.isRead())) {
            context.report({ node: parent.id, messageId: "unused", data: { name: parent.id.name } });
          }
        }
      },
    };
  },
};

export default rule;
