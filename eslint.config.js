/**
 * ESLint flat config（基础版）
 *
 * 覆盖：TS 语法与类型感知规则、React Hooks 规则（hooks 正确性最有价值）。
 * 故意未开 stylistic 类规则 —— 格式交给 Prettier，lint 只管正确性。
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'src-tauri/', 'src/vendor/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 项目约定：下划线开头的是"有意不使用"的参数/变量
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // any 在 vendor 边界（foliate-js 无类型）暂时放行，业务代码尽量避免
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
