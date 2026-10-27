// ESLint 扁平配置（ESLint 9）。
//
// 目标不是把风格统一到某个流派，而是挡住「tsc 看不出来」的那类问题：
// 未使用的变量/导入、hooks 依赖写漏、Promise 忘了 await、误用 any。
// 格式化（缩进、引号）故意不管 —— 仓库里没有 formatter，也不打算为此改一遍全部文件。
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"

export default tseslint.config(
  {
    // 构建产物与依赖不参与检查
    ignores: ["dist/**", "node_modules/**", "../static/**", "public/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // tsc 已经管住了类型，这两条在 TS 里常误报
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // 后端 JSON 的字段类型是逐步补的，`any` 在这里是刻意的逃生口
      "@typescript-eslint/no-explicit-any": "off",
      // 空 catch 是有意为之（"忘了就忘了" 的注释比报错更清楚）
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
)
