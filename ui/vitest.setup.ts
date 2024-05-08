/// <reference types="vitest" />

import '@testing-library/jest-dom/vitest'
import { server } from '@/utils/tests/msw/server'

// Polyfill Buffer in JSDOM
if (!Object.prototype.isPrototypeOf.call(Buffer, Uint8Array)) {
  Object.setPrototypeOf(Buffer.prototype, Uint8Array.prototype)
}

// Mock Service Worker
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
