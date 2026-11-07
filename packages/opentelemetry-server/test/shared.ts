import "../../../test/loopback-proxy-bypass.ts";

export const packageRoot = `${import.meta.dirname}/..`;
export const globalSetupPath = `${import.meta.dirname}/setup.ts`;
export const coverageConfig = {
  enabled: true,
  provider: "istanbul" as const,
  reporter: ["lcov", "json", "html", "text"],
  reportsDirectory: `${packageRoot}/coverage`,
  include: ["src/**/*.ts"],
  exclude: [
    "**/node_modules/**",
    "**/test/**",
    "src/**/*.spec.ts",
    "src/**/*.type.test.ts",
    "src/test-utils.ts",
  ],
  thresholds: {
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  },
};
