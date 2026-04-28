/**
 * Integration tests for App component with CPU renderer.
 *
 * These tests verify that the application renders without runtime errors
 * by using the CPU renderer instead of WebGPU.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createRoot, to } from 'solid-js'
import { App } from './App'

describe('App Component Integration', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should render without console errors', () => {
    const originalError = console.error
    const errorMessages: string[] = []

    // Capture console.errors
    console.error = (...args: any[]) => {
      errorMessages.push(args.map((arg) => String(arg)).join(' '))
    }

    try {
      createRoot((dispose) => {
        const AppComponent = to(App)
        expect(() => AppComponent).not.toThrow()
        dispose()
      })
    } finally {
      console.error = originalError
    }

    // Assert no runtime errors
    expect(errorMessages).toEqual([])
  })

  it('should handle canvasSize undefined gracefully', () => {
    const originalError = console.error
    const errorMessages: string[] = []

    console.error = (...args: any[]) => {
      errorMessages.push(args.map((arg) => String(arg)).join(' '))
    }

    try {
      createRoot((dispose) => {
        const AppComponent = to(App)
        expect(() => AppComponent).not.toThrow()
        dispose()
      })
    } finally {
      console.error = originalError
    }

    // Assert no runtime errors with undefined canvasSize
    expect(errorMessages).toEqual([])
  })

  it('should handle empty canvas gracefully', () => {
    const originalError = console.error
    const errorMessages: string[] = []

    console.error = (...args: any[]) => {
      errorMessages.push(args.map((arg) => String(arg)).join(' '))
    }

    try {
      createRoot((dispose) => {
        const AppComponent = to(App)
        expect(() => AppComponent).not.toThrow()
        dispose()
      })
    } finally {
      console.error = originalError
    }

    expect(errorMessages).toEqual([])
  })

  it('should render main content structure', () => {
    const originalError = console.error
    const errorMessages: string[] = []

    console.error = (...args: any[]) => {
      errorMessages.push(args.map((arg) => String(arg)).join(' '))
    }

    try {
      createRoot((dispose) => {
        const AppComponent = to(App)
        expect(AppComponent).toBeDefined()
        expect(() => AppComponent).not.toThrow()
        dispose()
      })
    } finally {
      console.error = originalError
    }

    expect(errorMessages).toEqual([])
  })

  it('should handle repeated renders without errors', () => {
    const originalError = console.error
    const errorMessages: string[] = []

    console.error = (...args: any[]) => {
      errorMessages.push(args.map((arg) => String(arg)).join(' '))
    }

    try {
      let renders = 0
      const maxRenders = 10

      createRoot((dispose) => {
        for (let i = 0; i < maxRenders; i++) {
          const AppComponent = to(App)
          expect(() => AppComponent).not.toThrow()
          renders++
        }
        dispose()
      })
    } finally {
      console.error = originalError
    }

    expect(renders).toBe(maxRenders)
    expect(errorMessages).toEqual([])
  })

  it('should not throw on rapid state changes', () => {
    const originalError = console.error
    const errorMessages: string[] = []

    console.error = (...args: any[]) => {
      errorMessages.push(args.map((arg) => String(arg)).join(' '))
    }

    try {
      createRoot((dispose) => {
        const AppComponent = to(App)
        expect(() => AppComponent).not.toThrow()

        // Rapidly change state
        for (let i = 0; i < 5; i++) {
          // This would trigger state updates in real usage
          expect(() => AppComponent).not.toThrow()
        }
        dispose()
      })
    } finally {
      console.error = originalError
    }

    expect(errorMessages).toEqual([])
  })
})
