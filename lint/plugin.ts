import type { ESLint, Rule } from "eslint";
import type { Expression } from "estree";

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

    // Unresolved and global identifiers can read host accessors, unlike lexical bindings.
    const isStableSubject = (node: Expression): boolean => {
      if (node.type === "ThisExpression") return true;
      if (node.type !== "Identifier") return false;
      let scope = sourceCode.getScope(node);
      for (;;) {
        const variable = scope.set.get(node.name);
        if (variable) {
          return (
            scope.type !== "global" &&
            variable.defs.some(({ node, parent }) => {
              const declared: unknown = Object.getOwnPropertyDescriptor(
                node,
                "declare",
              )?.value;
              const parentDeclared: unknown =
                parent &&
                Object.getOwnPropertyDescriptor(parent, "declare")?.value;
              return declared !== true && parentDeclared !== true;
            })
          );
        }
        if (!scope.upper) return false;
        scope = scope.upper;
      }
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
