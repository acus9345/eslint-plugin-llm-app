import type { Rule, Scope } from "eslint";
import type * as ESTree from "estree";
import { docsUrl, findVariable, FUNCTION_TYPES, memberPath, parentOf, unwrap, walk } from "../utils.js";

type Loop = ESTree.WhileStatement | ESTree.DoWhileStatement | ESTree.ForStatement;

type MemberKey =
  | { kind: "prop"; name: string }
  | { kind: "computedId"; name: string; variable: Scope.Variable | undefined };

interface FlagTarget {
  root: { kind: "this" } | { kind: "id"; name: string; variable: Scope.Variable | undefined };
  keys: MemberKey[];
  /** True when the loop exits if the flag becomes truthy (e.g. `while (!done)`). */
  exitsWhenTruthy: boolean;
}

/** `true`, `1`, `!0`, a missing `for` test, or a bare flag such as `!done`. */
function isUnbounded(test: ESTree.Expression | null | undefined): boolean {
  if (!test) return true;
  switch (test.type) {
    case "Literal":
      return Boolean(test.value);
    case "Identifier":
    case "MemberExpression":
      return true;
    case "UnaryExpression":
      return test.operator === "!" && (test.argument.type === "Literal" ? !test.argument.value : isUnbounded(test.argument));
    default:
      return false;
  }
}

function parseReference(
  node: ESTree.Node,
  scope: Scope.Scope,
): { root: FlagTarget["root"]; keys: MemberKey[] } | undefined {
  const keys: MemberKey[] = [];
  let cur: ESTree.Node = unwrap(node);
  while (cur.type === "MemberExpression") {
    if (!cur.computed && cur.property.type === "Identifier") {
      keys.unshift({ kind: "prop", name: cur.property.name });
    } else if (
      cur.computed &&
      cur.property.type === "Literal" &&
      (typeof cur.property.value === "string" || typeof cur.property.value === "number" || typeof cur.property.value === "boolean")
    ) {
      keys.unshift({ kind: "prop", name: String(cur.property.value) });
    } else if (cur.computed && cur.property.type === "Identifier") {
      keys.unshift({
        kind: "computedId",
        name: cur.property.name,
        variable: findVariable(scope, cur.property.name),
      });
    } else {
      return undefined;
    }
    cur = unwrap(cur.object);
  }
  if (cur.type === "Identifier") {
    return {
      root: { kind: "id", name: cur.name, variable: findVariable(scope, cur.name) },
      keys,
    };
  }
  if (cur.type === "ThisExpression") {
    return { root: { kind: "this" }, keys };
  }
  return undefined;
}

function extractFlagTarget(test: ESTree.Expression | null | undefined, scope: Scope.Scope): FlagTarget | undefined {
  if (!test) return undefined;
  let n: ESTree.Node = unwrap(test);
  let negations = 0;
  while (n.type === "UnaryExpression" && n.operator === "!") {
    negations++;
    n = unwrap(n.argument);
  }
  if (n.type !== "Identifier" && n.type !== "MemberExpression") return undefined;
  const ref = parseReference(n, scope);
  if (!ref) return undefined;
  return { ...ref, exitsWhenTruthy: negations % 2 === 1 };
}

function sameReference(node: ESTree.Node, target: FlagTarget, scope: Scope.Scope): boolean {
  const ref = parseReference(node, scope);
  if (!ref || ref.keys.length !== target.keys.length) return false;
  if (ref.root.kind !== target.root.kind) return false;
  if (ref.root.kind === "id" && target.root.kind === "id") {
    if (ref.root.name !== target.root.name || ref.root.variable !== target.root.variable) return false;
  }
  for (let i = 0; i < ref.keys.length; i++) {
    const a = ref.keys[i]!;
    const b = target.keys[i]!;
    if (a.kind !== b.kind || a.name !== b.name) return false;
    if (a.kind === "computedId" && b.kind === "computedId" && a.variable !== b.variable) return false;
  }
  return true;
}

function staticNullishness(node: ESTree.Node): boolean | undefined {
  const n = unwrap(node);
  if (n.type === "Literal") return n.value === null;
  if (n.type === "Identifier" && n.name === "undefined") return true;
  if (n.type === "UnaryExpression") return n.operator === "void";
  if (
    n.type === "ObjectExpression" ||
    n.type === "ArrayExpression" ||
    n.type === "FunctionExpression" ||
    n.type === "ArrowFunctionExpression" ||
    n.type === "ClassExpression" ||
    n.type === "TemplateLiteral"
  ) {
    return false;
  }
  return undefined;
}

function staticTruthiness(node: ESTree.Node): boolean | undefined {
  const n = unwrap(node);
  if (n.type === "Literal") return Boolean(n.value);
  if (n.type === "Identifier") {
    if (n.name === "undefined" || n.name === "NaN") return false;
    if (n.name === "Infinity") return true;
    return undefined;
  }
  if (n.type === "TemplateLiteral") {
    if (n.quasis.some((q) => (q.value.cooked ?? q.value.raw).length > 0)) return true;
    if (n.expressions.length === 0) return false;
    return undefined;
  }
  if (n.type === "UnaryExpression") {
    if (n.operator === "void") return false;
    if (n.operator === "typeof") return true;
    if (n.operator === "!") {
      const inner = staticTruthiness(n.argument);
      return inner === undefined ? undefined : !inner;
    }
  }
  if (n.type === "LogicalExpression") {
    if (n.operator === "||") {
      const left = staticTruthiness(n.left);
      const right = staticTruthiness(n.right);
      if (left === true || right === true) return true;
      if (left === false && right === false) return false;
      return undefined;
    }
    if (n.operator === "&&") {
      const left = staticTruthiness(n.left);
      const right = staticTruthiness(n.right);
      if (left === false || right === false) return false;
      if (left === true && right === true) return true;
      return undefined;
    }
    if (n.operator === "??") {
      const leftNullish = staticNullishness(n.left);
      if (leftNullish === true) return staticTruthiness(n.right);
      if (leftNullish === false) return staticTruthiness(n.left);
      const left = staticTruthiness(n.left);
      if (left === true) return true;
      const right = staticTruthiness(n.right);
      if (left === false && right === false) return false;
      return undefined;
    }
  }
  if (n.type === "ConditionalExpression") {
    const test = staticTruthiness(n.test);
    if (test === true) return staticTruthiness(n.consequent);
    if (test === false) return staticTruthiness(n.alternate);
    const cons = staticTruthiness(n.consequent);
    const alt = staticTruthiness(n.alternate);
    return cons !== undefined && cons === alt ? cons : undefined;
  }
  if (n.type === "SequenceExpression") {
    const last = n.expressions[n.expressions.length - 1];
    return last ? staticTruthiness(last) : undefined;
  }
  if (
    n.type === "ObjectExpression" ||
    n.type === "ArrayExpression" ||
    n.type === "FunctionExpression" ||
    n.type === "ArrowFunctionExpression" ||
    n.type === "ClassExpression"
  ) {
    return true;
  }
  return undefined;
}

function assignmentCanExit(node: ESTree.AssignmentExpression, target: FlagTarget, scope: Scope.Scope): boolean {
  if (!sameReference(node.left, target, scope)) return false;
  const rhs = staticTruthiness(node.right);
  const { exitsWhenTruthy } = target;
  switch (node.operator) {
    case "=":
      if (sameReference(node.right, target, scope)) return false;
      return exitsWhenTruthy ? rhs !== false : rhs !== true;
    case "||=":
      return exitsWhenTruthy && rhs !== false;
    case "&&=":
      return !exitsWhenTruthy && rhs !== true;
    default:
      return false;
  }
}

const LOOP_TYPES = new Set(["WhileStatement", "DoWhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"]);

/** Whether `root` has a `throw`, `return`, `break` out of the loop, flag update, or `process.exit()`, outside `skip`. */
function hasExit(
  root: ESTree.Node,
  skip: Set<ESTree.Node>,
  enclosingLabels: Set<string>,
  getScope: (node: ESTree.Node) => Scope.Scope,
  flag?: FlagTarget,
): boolean {
  let found = false;
  const visit = (node: ESTree.Node, depth: number) => {
    walk(node, (n) => {
      if (found || skip.has(n) || FUNCTION_TYPES.has(n.type)) return false;
      if (n.type === "ThrowStatement" || n.type === "ReturnStatement") found = true;
      else if (n.type === "BreakStatement") {
        if (n.label ? enclosingLabels.has(n.label.name) : depth === 0) found = true;
      } else if (flag && n.type === "AssignmentExpression" && assignmentCanExit(n, flag, getScope(n))) {
        found = true;
      } else if (n.type === "CallExpression" && memberPath(n.callee).join(".") === "process.exit") found = true;
      else if (n !== node && (LOOP_TYPES.has(n.type) || n.type === "SwitchStatement")) {
        visit(n, depth + 1);
        return false;
      }
      return !found;
    });
  };
  visit(root, 0);
  return found;
}

function containsCall(node: ESTree.Node): boolean {
  let found = false;
  walk(node, (n) => {
    if (found || FUNCTION_TYPES.has(n.type)) return false;
    if (n.type === "CallExpression" || n.type === "AwaitExpression" || n.type === "NewExpression") found = true;
    return !found;
  });
  return found;
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow retry loops that never give up",
      recommended: true,
      url: docsUrl("no-unbounded-retry"),
    },
    schema: [],
    messages: {
      unbounded:
        "This retry loop has no limit: if the call keeps failing (rate limit, outage, invalid request) it retries forever. Cap the attempts and back off between them.",
    },
  },
  create(context) {
    function check(loop: Loop) {
      if (!isUnbounded(loop.test)) return;
      // Find the try statements directly in this loop (not in nested loops or functions).
      const tries: ESTree.TryStatement[] = [];
      walk(loop.body, (n) => {
        if (FUNCTION_TYPES.has(n.type) || (n !== loop.body && LOOP_TYPES.has(n.type))) return false;
        if (n.type === "TryStatement" && n.handler) tries.push(n);
      });
      const retrying = tries.filter((t) => containsCall(t.block));
      if (!retrying.length) return;
      // Exits inside the try block are the success path. Anywhere else is a limit.
      const enclosingLabels = new Set<string>();
      for (let p = parentOf(loop); p && !FUNCTION_TYPES.has(p.type); p = parentOf(p)) {
        if (p.type === "LabeledStatement") enclosingLabels.add(p.label.name);
      }
      const getScope = (node: ESTree.Node) => context.sourceCode.getScope(node);
      const flag = loop.test ? extractFlagTarget(loop.test, getScope(loop.test)) : undefined;
      if (hasExit(loop.body, new Set(retrying.map((t) => t.block)), enclosingLabels, getScope, flag)) return;
      context.report({ node: loop, loc: loop.loc ? { start: loop.loc.start, end: loop.body.loc!.start } : undefined, messageId: "unbounded" } as Rule.ReportDescriptor);
    }
    return { WhileStatement: check, DoWhileStatement: check, ForStatement: check };
  },
};

export default rule;
