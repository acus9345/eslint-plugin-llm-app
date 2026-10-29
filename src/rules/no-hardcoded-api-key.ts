import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { docsUrl, keyName } from "../utils.js";

/** Key formats that identify the provider on their own, wherever they appear. */
const KEY_PATTERNS: [string, RegExp][] = [
  ["Anthropic", /\bsk-ant-[A-Za-z0-9]{2,8}-[A-Za-z0-9_-]{20,}/],
  ["OpenRouter", /\bsk-or-v1-[a-f0-9]{32,}/],
  ["OpenAI", /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/],
  ["Google", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["Groq", /\bgsk_[A-Za-z0-9]{40,}/],
  ["xAI", /\bxai-[A-Za-z0-9]{40,}/],
  ["Hugging Face", /\bhf_[A-Za-z0-9]{30,}/],
  ["Replicate", /\br8_[A-Za-z0-9]{30,}/],
  ["Perplexity", /\bpplx-[A-Za-z0-9]{40,}/],
];

/** Property or variable names that hold a credential. */
const KEY_NAME = /^(?:x-)?(?:[a-z]+[-_]?)?(?:api[-_]?key|auth[-_]?token|access[-_]?token|secret[-_]?key|bearer[-_]?token)$/i;

const PLACEHOLDER = /x{4,}|\.{3}|your|<|>|\{\{|example|placeholder|dummy|fake|redacted|changeme|replace|insert|\*{3,}|^(?:test|sk-)?$|^sk-[a-z-]*$/i;

function looksSecret(value: string): boolean {
  const v = value.trim();
  if (v.length < 16 || /\s/.test(v) || PLACEHOLDER.test(v)) return false;
  return /[0-9]/.test(v) && /[A-Za-z]/.test(v);
}

function stringValue(node: ESTree.Node): string | undefined {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow API keys written into code, prompts or config",
      recommended: true,
      url: docsUrl("no-hardcoded-api-key"),
    },
    schema: [],
    messages: {
      provider:
        "This looks like a {{provider}} API key. Anyone who can read this file, or the prompt or log it ends up in, can use it. Load it from an environment variable or a secret manager, and rotate this one.",
      named:
        "`{{name}}` is set to a hardcoded secret. Load it from an environment variable or a secret manager instead, and rotate this one.",
    },
  },
  create(context) {
    const reported = new Set<ESTree.Node>();

    function checkText(node: ESTree.Node, text: string) {
      for (const [provider, re] of KEY_PATTERNS) {
        const m = re.exec(text);
        if (m && !PLACEHOLDER.test(m[0])) {
          reported.add(node);
          context.report({ node, messageId: "provider", data: { provider } });
          return;
        }
      }
    }

    function checkNamed(name: string | undefined, value: ESTree.Node | null | undefined) {
      if (!name || !value || reported.has(value)) return;
      let text = stringValue(value);
      if (text === undefined) return;
      if (/^authorization$/i.test(name)) {
        const m = /^(?:Bearer|Basic|Token)\s+(.+)$/i.exec(text);
        if (!m) return;
        text = m[1]!;
      } else if (!KEY_NAME.test(name)) return;
      if (!looksSecret(text)) return;
      reported.add(value);
      context.report({ node: value, messageId: "named", data: { name } });
    }

    return {
      Literal(node: ESTree.Literal) {
        if (typeof node.value === "string") checkText(node, node.value);
      },
      TemplateLiteral(node: ESTree.TemplateLiteral) {
        for (const quasi of node.quasis) {
          if (reported.has(node)) return;
          checkText(node, quasi.value.cooked ?? quasi.value.raw);
        }
      },
      "Property:exit"(node: ESTree.Property) {
        checkNamed(keyName(node), node.value);
      },
      "VariableDeclarator:exit"(node: ESTree.VariableDeclarator) {
        if (node.id.type === "Identifier") checkNamed(node.id.name, node.init);
      },
      "AssignmentExpression:exit"(node: ESTree.AssignmentExpression) {
        const left = node.left;
        const name =
          left.type === "Identifier"
            ? left.name
            : left.type === "MemberExpression" && !left.computed && left.property.type === "Identifier"
              ? left.property.name
              : undefined;
        checkNamed(name, node.right);
      },
    };
  },
};

export default rule;
