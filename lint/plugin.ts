import type { ESLint, Rule, Scope } from "eslint";
import type { Expression } from "estree";

// `declare` is a TypeScript flag that the ESTree node types do not list. A
// definition's node is typed `any` and its parent may be missing.
function isAmbient(node: unknown): boolean {
  return (
    typeof node === "object" &&
    node !== null &&
    "declare" in node &&
    node.declare === true
  );
}

// The binding of `name` in the nearest scope that declares it, with that scope.
function findVariable(
  scope: Scope.Scope,
  name: string,
): { scope: Scope.Scope; variable: Scope.Variable } | undefined {
  for (
    let current: Scope.Scope | null = scope;
    current;
    current = current.upper
  ) {
    const variable = current.set.get(name);
    if (variable) return { scope: current, variable };
  }
  return undefined;
}

const preferTypeofSwitch: Rule.RuleModule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Prefer a switch over a chain of typeof comparisons on one value.",
    },
    schema: [],
    messages: {
      preferSwitch:
        "Use a switch on `typeof {{subject}}` instead of a chain of typeof comparisons.",
    },
  },
  create(context) {
    const { sourceCode } = context;

    // Unresolved, global and ambient identifiers can read host accessors, unlike lexical bindings.
    const isStableSubject = (subject: Expression): boolean => {
      if (subject.type === "ThisExpression") return true;
      if (subject.type !== "Identifier") return false;
      const found = findVariable(sourceCode.getScope(subject), subject.name);
      if (!found || found.scope.type === "global") return false;
      return found.variable.defs.some(
        (def) => !isAmbient(def.node) && !isAmbient(def.parent),
      );
    };

    const argumentOf = (node: Expression): Expression | undefined => {
      if (node.type !== "BinaryExpression" || node.operator !== "!==") {
        return undefined;
      }
      const { left, right } = node;
      if (
        left.type !== "UnaryExpression" ||
        left.operator !== "typeof" ||
        right.type !== "Literal" ||
        typeof right.value !== "string"
      ) {
        return undefined;
      }
      return left.argument;
    };

    const leavesOf = (node: Expression, leaves: Expression[] = []) => {
      if (node.type === "LogicalExpression" && node.operator === "&&") {
        leavesOf(node.left, leaves);
        leavesOf(node.right, leaves);
      } else {
        leaves.push(node);
      }
      return leaves;
    };

    return {
      LogicalExpression(node) {
        if (node.operator !== "&&") return;
        const { parent } = node;
        if (parent.type === "LogicalExpression" && parent.operator === "&&") {
          return;
        }
        const leaves = leavesOf(node);
        const [head] = leaves;
        const first = head && argumentOf(head);
        if (!first || !isStableSubject(first)) return;
        const subject = sourceCode.getText(first);
        const sameSubject = leaves.every((leaf) => {
          const argument = argumentOf(leaf);
          return argument && sourceCode.getText(argument) === subject;
        });
        if (!sameSubject) return;
        context.report({ node, messageId: "preferSwitch", data: { subject } });
      },
    };
  },
};

/**
 * Project lint rules, loaded through `jsPlugins` in oxlint.config.ts.
 */
const plugin: ESLint.Plugin = {
  meta: { name: "defjs" },
  rules: { "prefer-typeof-switch": preferTypeofSwitch },
};

export default plugin;
