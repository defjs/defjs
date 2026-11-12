import { join } from "node:path";
import { runUnitNode } from "./run-unit-node.ts";
import { nodePackages } from "./runtime-matrix.ts";

const root = join(import.meta.dirname, "..");

process.exit(runUnitNode(nodePackages.map((cwd) => join(root, cwd))));
