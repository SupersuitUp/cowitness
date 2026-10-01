import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    exclude: ['test/consumer/**', 'node_modules/**'],
  },
  resolve: {
    alias: { 'server-only': fileURLToPath(new URL('./test/support/empty.ts', import.meta.url)) },
  },
})
