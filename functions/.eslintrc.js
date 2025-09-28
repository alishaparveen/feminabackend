module.exports = {
    root: true,
    env: {
      es6: true,
      node: true,
    },
    extends: [
      "eslint:recommended"
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
      sourceType: "module",
    },
    ignorePatterns: [
      "/lib/**/*", // Ignore built files
      "/coverage/**/*", // Ignore coverage reports
    ],
    plugins: [
      "@typescript-eslint",
    ],
    rules: {
      "quotes": ["error", "single"],
      "indent": ["error", 2],
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  };