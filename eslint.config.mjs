// Focused, type-aware lint: correctness rules that tsc does not cover.
// Promise handling first — a floating promise here is how lazy shader
// import()s stalled silently and how an XR-frame error could end a loop.
// Formatting/style is deliberately not enforced.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", ".yalc/**", "out/**", "src/**/generated/**", "third_party/**"] },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      eqeqeq: ["error", "smart"],
      "no-fallthrough": "error",
      "no-self-compare": "error",
      "no-unreachable": "error",
    },
  },
);
