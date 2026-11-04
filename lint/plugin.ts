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

    // A switch reads its subject once. Only report subjects whose repeated reads
    // cannot differ: a call, getter, or update in the chain would change behaviour.
    const isStableSubject = (node: Expression): boolean =>
      node.type === "Identifier" || node.type === "ThisExpression";

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
 * Project lint rules, loaded through `[lint] plugins` in bunfig.toml.
 */
const plugin: ESLint.Plugin = {
  meta: { name: "defjs" },
  rules: { "prefer-typeof-switch": preferTypeofSwitch },
};

export default plugin;
