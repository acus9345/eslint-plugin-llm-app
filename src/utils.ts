import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";

export type CallKind =
  | "anthropic"
  | "openai-chat"
  | "openai-responses"
  | "openai-completions"
  | "google"
  | "ai-sdk";

export interface LlmCall {
  kind: CallKind;
  /** The request object, the first argument. */
  request: ESTree.ObjectExpression;
  /** The second argument when it's an object literal (per-request SDK options). */
  options?: ESTree.ObjectExpression;
  /** The SDK method, e.g. `"create"` or `"stream"`. */
  method: string;
}

/** Strips `await`, parentheses-free wrappers such as TS `as` / `!` / `satisfies`. */
export function unwrap(node: ESTree.Node): ESTree.Node {
  let n: any = node;
  while (n) {
    if (n.type === "AwaitExpression" || n.type === "ChainExpression") n = n.argument ?? n.expression;
    else if (n.type === "TSAsExpression" || n.type === "TSNonNullExpression" || n.type === "TSSatisfiesExpression") n = n.expression;
    else break;
  }
  return n;
}

/**
 * The names along a member/call chain: `completion.choices[0].message.content` gives
 * `["completion", "choices", "[]", "message", "content"]`, and `r.response.text()`
 * gives `["r", "response", "text", "()"]`.
 */
export function memberPath(node: ESTree.Node): string[] {
  const out: string[] = [];
  let n: any = unwrap(node);
  while (n) {
    if (n.type === "MemberExpression") {
      if (!n.computed && n.property.type === "Identifier") out.unshift(n.property.name);
      else if (n.computed && n.property.type === "Literal" && typeof n.property.value === "string") out.unshift(n.property.value);
      else out.unshift("[]");
      n = unwrap(n.object);
    } else if (n.type === "CallExpression") {
      out.unshift("()");
      n = unwrap(n.callee);
    } else {
      if (n.type === "Identifier") out.unshift(n.name);
      else if (n.type === "ThisExpression") out.unshift("this");
      break;
    }
  }
  return out;
}

const AI_SDK_FUNCTIONS = new Set(["generateText", "streamText", "generateObject", "streamObject"]);

/** Recognizes calls to the Anthropic, OpenAI, Google GenAI and Vercel AI SDKs. */
export function getLlmCall(node: ESTree.CallExpression): LlmCall | undefined {
  const [first, second] = node.arguments;
  if (!first || first.type !== "ObjectExpression") return undefined;
  // `client.messages.create` is also Twilio's API; a `model` key tells them apart.
  if (!hasKey(first, "model")) return undefined;
  const options = second?.type === "ObjectExpression" ? second : undefined;

  const callee = unwrap(node.callee);
  if (callee.type === "Identifier") {
    return AI_SDK_FUNCTIONS.has(callee.name) ? { kind: "ai-sdk", request: first, options, method: callee.name } : undefined;
  }
  const path = memberPath(callee);
  const method = path[path.length - 1] ?? "";
  const parent = path[path.length - 2];
  const grandparent = path[path.length - 3];
  let kind: CallKind | undefined;
  if (parent === "messages" && ["create", "stream", "parse", "countTokens"].includes(method)) {
    if (method === "countTokens") return undefined;
    kind = "anthropic";
  } else if (parent === "completions" && grandparent === "chat" && ["create", "stream", "parse"].includes(method)) {
    kind = "openai-chat";
  } else if (parent === "responses" && ["create", "stream", "parse"].includes(method)) {
    kind = "openai-responses";
  } else if (parent === "completions" && method === "create") {
    kind = "openai-completions";
  } else if (method === "generateContent" || method === "generateContentStream") {
    kind = "google";
  } else if (AI_SDK_FUNCTIONS.has(method)) {
    kind = "ai-sdk";
  }
  return kind ? { kind, request: first, options, method } : undefined;
}

export function keyName(prop: ESTree.Property): string | undefined {
  if (prop.computed) return prop.key.type === "Literal" && typeof prop.key.value === "string" ? prop.key.value : undefined;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal") return String(prop.key.value);
  return undefined;
}

export function getProp(obj: ESTree.ObjectExpression, name: string): ESTree.Property | undefined {
  for (const p of obj.properties) if (p.type === "Property" && keyName(p) === name) return p;
  return undefined;
}

export function hasKey(obj: ESTree.ObjectExpression, name: string): boolean {
  return getProp(obj, name) !== undefined;
}

export function hasSpread(obj: ESTree.ObjectExpression): boolean {
  return obj.properties.some((p) => p.type === "SpreadElement");
}

/**
 * Whether `obj` (or a nested object under one of `nestedIn`) has one of `keys`.
 * Returns `undefined` when a spread makes it impossible to tell.
 */
export function findKey(obj: ESTree.ObjectExpression, keys: string[], nestedIn: string[] = []): boolean | undefined {
  if (keys.some((k) => hasKey(obj, k))) return true;
  let unknown = hasSpread(obj);
  for (const name of nestedIn) {
    const p = getProp(obj, name);
    if (!p) continue;
    if (p.value.type !== "ObjectExpression") {
      unknown = true;
      continue;
    }
    const inner = findKey(p.value, keys, nestedIn);
    if (inner) return true;
    if (inner === undefined) unknown = true;
  }
  return unknown ? undefined : false;
}

export function findVariable(scope: Scope.Scope | null, name: string): Scope.Variable | undefined {
  for (let s = scope; s; s = s.upper) {
    const v = s.set.get(name);
    if (v) return v;
  }
  return undefined;
}

export function parentOf(node: ESTree.Node): ESTree.Node | undefined {
  return (node as Rule.Node).parent as ESTree.Node | undefined;
}

/** Visits every node under `root`. Return `false` from `visit` to skip a node's children. */
export function walk(root: ESTree.Node, visit: (node: ESTree.Node) => boolean | void): void {
  const stack: ESTree.Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (visit(node) === false) continue;
    for (const key of Object.keys(node)) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      const value = (node as any)[key];
      if (Array.isArray(value)) {
        for (const v of value) if (v && typeof v.type === "string") stack.push(v);
      } else if (value && typeof value.type === "string") {
        stack.push(value);
      }
    }
  }
}

export const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

export function docsUrl(rule: string): string {
  return `https://github.com/acus9345/eslint-plugin-llm-app/blob/main/docs/rules/${rule}.md`;
}
