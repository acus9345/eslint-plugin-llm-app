import type { Rule } from "eslint";
import type * as ESTree from "estree";
import { docsUrl, FUNCTION_TYPES, memberPath, walk } from "../utils.js";

type Loop = ESTree.WhileStatement | ESTree.DoWhileStatement | ESTree.ForStatement;

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

const LOOP_TYPES = new Set(["WhileStatement", "DoWhileStatement", "ForStatement", "ForInStatement", "ForOfStatement"]);

/** Whether `root` has a `throw`, `return`, `break` out of the loop, or `process.exit()`, outside `skip`. */
function hasExit(root: ESTree.Node, skip: Set<ESTree.Node>, loopLabel?: string): boolean {
  let found = false;
  const visit = (node: ESTree.Node, depth: number) => {
    walk(node, (n) => {
      if (found || skip.has(n) || FUNCTION_TYPES.has(n.type)) return false;
      if (n.type === "ThrowStatement" || n.type === "ReturnStatement") found = true;
      else if (n.type === "BreakStatement") {
        if (n.label ? n.label.name === loopLabel : depth === 0) found = true;
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
      const parent = (loop as Rule.Node).parent as ESTree.Node | undefined;
      const label = parent?.type === "LabeledStatement" ? parent.label.name : undefined;
      if (hasExit(loop.body, new Set(retrying.map((t) => t.block)), label)) return;
      context.report({ node: loop, loc: loop.loc ? { start: loop.loc.start, end: loop.body.loc!.start } : undefined, messageId: "unbounded" } as Rule.ReportDescriptor);
    }
    return { WhileStatement: check, DoWhileStatement: check, ForStatement: check };
  },
};

export default rule;
