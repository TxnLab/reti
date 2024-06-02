/// <reference types="vitest" />
import replace from '@rollup/plugin-replace'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { version } from './package.json'

export default defineConfig({
  plugins: [
    replace({
      __APP_VERSION__: JSON.stringify(version),
      preventAssignment: true,
      include: ['public/version.json'],
    }),
    react(),
    TanStackRouterVite(),
    nodePolyfills({
      include: ['path', 'stream', 'util'],
      exclude: ['http'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      overrides: {
        fs: 'memfs',
      },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    name: 'reti-ui',
    dir: './src',
    watch: false,
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          algorand: ['algosdk', '@algorandfoundation/algokit-utils'],
          icons: ['lucide-react', '@radix-ui/react-icons'],
          tremor: ['@tremor/react'],
          useWallet: ['@txnlab/use-wallet-react'],
        },
      },
    },
  },
})
