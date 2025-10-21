module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { project: ["./tsconfig.json"], tsconfigRootDir: __dirname },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  env: { node: true, es2023: true },
  ignorePatterns: ["dist/**", "node_modules/**"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/consistent-type-imports": "warn"
  }
};
