import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";
import { docsUrl, findVariable, getLlmCall, keyName, memberPath, unwrap } from "../utils.js";

const endsWith = (path: string[], ...suffix: string[]) =>
  path.length >= suffix.length && suffix.every((s, i) => s === "*" || path[path.length - suffix.length + i] === s);

/** The property names on an SDK response that hold the model's text. */
function isOutputPath(path: string[]): boolean {
  if (path.includes("choices") && ["content", "text"].includes(path[path.length - 1] ?? "")) return true; // OpenAI
  if ((path.includes("tool_calls") || path.includes("function_call")) && endsWith(path, "arguments")) return true;
  if (endsWith(path, "output_text")) return true; // OpenAI Responses
  if (endsWith(path, "content", "[]", "text")) return true; // Anthropic
  if (endsWith(path, "message", "content")) return true; // Ollama and similar
  if (endsWith(path, "response", "text", "()")) return true; // Google: result.response.text()
  if (endsWith(path, "candidates", "[]", "content", "parts", "[]", "text")) return true;
  return false;
}

const TEXT_FIELDS = new Set(["text", "output_text", "content"]);
const TRIM_METHODS = new Set(["trim", "trimStart", "trimEnd"]);

function isLlmCallResult(node: ESTree.Node): boolean {
  const inner = unwrap(node);
  return inner.type === "CallExpression" && getLlmCall(inner) !== undefined;
}

function isModelOutput(node: ESTree.Node, scope: Scope.Scope, depth = 0): boolean {
  let n = unwrap(node);
  while (true) {
    // `text ?? ""`, `text || "{}"`, `ok && text`
    if (n.type === "LogicalExpression") {
      n = unwrap(n.operator === "&&" ? n.right : n.left);
      continue;
    }
    // `text.trim()` doesn't strip markdown fences or fix malformed JSON
    if (
      n.type === "CallExpression" &&
      n.arguments.length === 0 &&
      n.callee.type === "MemberExpression" &&
      !n.callee.computed &&
      n.callee.property.type === "Identifier" &&
      TRIM_METHODS.has(n.callee.property.name)
    ) {
      n = unwrap(n.callee.object);
      continue;
    }
    break;
  }
  if (n.type === "MemberExpression" || n.type === "CallExpression") {
    if (isOutputPath(memberPath(n))) return true;
    // `(await generateText(...)).text`, `(await ai.models.generateContent(...)).text`
    if (n.type === "MemberExpression" && !n.computed && n.property.type === "Identifier" && TEXT_FIELDS.has(n.property.name)) {
      const obj = unwrap(n.object);
      if (isLlmCallResult(obj)) return true;
      if (obj.type === "Identifier" && depth < 3) {
        const v = findVariable(scope, obj.name);
        const def = v?.defs[0];
        if (v?.defs.length === 1 && def?.node.type === "VariableDeclarator" && def.node.init && isLlmCallResult(def.node.init)) return true;
      }
    }
    return false;
  }
  if (n.type === "Identifier" && depth < 3) {
    const v = findVariable(scope, n.name);
    if (!v || v.defs.length !== 1) return false;
    const def = v.defs[0]!;
    if (def.node.type !== "VariableDeclarator" || !def.node.init) return false;
    const decl = def.node;
    // const content = completion.choices[0].message.content
    if (decl.id.type === "Identifier") return isModelOutput(decl.init!, scope, depth + 1);
    // const { text } = await generateText(...)
    if (decl.id.type === "ObjectPattern" && isLlmCallResult(decl.init!)) {
      return decl.id.properties.some((p) => {
        if (p.type !== "Property") return false;
        const propName = keyName(p);
        if (!propName || !TEXT_FIELDS.has(propName)) return false;
        const target = p.value.type === "AssignmentPattern" ? p.value.left : p.value;
        return target.type === "Identifier" && target.name === n.name;
      });
    }
  }
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow JSON.parse on raw model output",
      recommended: true,
      url: docsUrl("no-json-parse-llm-output"),
    },
    schema: [],
    messages: {
      raw: "JSON.parse on raw model output throws when the model wraps the JSON in a ```json fence, adds a trailing comma or a comment, or stops mid-object. Use structured outputs, or a tolerant parser such as llm-json-mend: `parseJson(text)`.",
    },
  },
  create(context) {
    return {
      CallExpression(node: ESTree.CallExpression) {
        const path = memberPath(node.callee);
        if (path.join(".") !== "JSON.parse" || !node.arguments[0]) return;
        if (isModelOutput(node.arguments[0], context.sourceCode.getScope(node))) {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
};

export default rule;
