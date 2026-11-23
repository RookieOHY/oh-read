/**
 * Vitest 配置
 * - environment: jsdom —— progress 测试需要 localStorage；
 *   纯函数测试（hash/TextProvider）在 jsdom 下同样可跑
 * - 与 vite.config.ts 共享 resolve 配置（如路径别名）
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
