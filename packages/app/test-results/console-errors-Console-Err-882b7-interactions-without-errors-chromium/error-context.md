# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: console-errors.spec.ts >> Console Error Detection >> should handle rapid interactions without errors
- Location: e2e/console-errors.spec.ts:78:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
Call log:
  - navigating to "http://localhost:5173/", waiting until "load"

```

# Test source

```ts
  1   | /**
  2   |  * Playwright end-to-end tests for console error detection.
  3   |  *
  4   |  * These tests help catch runtime errors like:
  5   |  * - "Cannot read properties of undefined (reading 'x')"
  6   |  * - "Cannot destructure property 'width' of 'n(...)' as it is undefined"
  7   |  * - All other canvasSize() or worldToClip() undefined errors
  8   |  */
  9   | import { test, expect } from '@playwright/test'
  10  | 
  11  | test.describe('Console Error Detection', () => {
  12  |   test('should render app without console errors', async ({ page }) => {
  13  |     const errors: string[] = []
  14  | 
  15  |     // Capture all console errors
  16  |     page.on('console', (msg) => {
  17  |       if (msg.type() === 'error') {
  18  |         errors.push(msg.text())
  19  |       }
  20  |     })
  21  | 
  22  |     // Navigate to app
  23  |     await page.goto('/')
  24  | 
  25  |     // Wait for app to load (up to 10 seconds)
  26  |     await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
  27  | 
  28  |     // Capture errors
  29  |     const pageErrors: string[] = []
  30  |     page.on('pageerror', (error) => {
  31  |       pageErrors.push(error.message)
  32  |     })
  33  | 
  34  |     // Wait a bit for any delayed errors
  35  |     await page.waitForTimeout(1000)
  36  | 
  37  |     // Assert no console errors
  38  |     if (errors.length > 0) {
  39  |       console.error('Console errors found:', errors)
  40  |     }
  41  |     expect(errors).toEqual([])
  42  | 
  43  |     // Assert no page errors
  44  |     if (pageErrors.length > 0) {
  45  |       console.error('Page errors found:', pageErrors)
  46  |     }
  47  |     expect(pageErrors).toEqual([])
  48  |   })
  49  | 
  50  |   test('should render canvas without errors', async ({ page }) => {
  51  |     const errors: string[] = []
  52  | 
  53  |     page.on('console', (msg) => {
  54  |       if (msg.type() === 'error') {
  55  |         errors.push(msg.text())
  56  |       }
  57  |     })
  58  | 
  59  |     await page.goto('/')
  60  | 
  61  |     // Wait for canvas to render
  62  |     await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {})
  63  | 
  64  |     // Give rendering time to settle
  65  |     await page.waitForTimeout(2000)
  66  | 
  67  |     const pageErrors: string[] = []
  68  |     page.on('pageerror', (error) => {
  69  |       pageErrors.push(error.message)
  70  |     })
  71  | 
  72  |     await page.waitForTimeout(1000)
  73  | 
  74  |     expect(errors).toEqual([])
  75  |     expect(pageErrors).toEqual([])
  76  |   })
  77  | 
  78  |   test('should handle rapid interactions without errors', async ({ page }) => {
  79  |     const errors: string[] = []
  80  | 
  81  |     page.on('console', (msg) => {
  82  |       if (msg.type() === 'error') {
  83  |         errors.push(msg.text())
  84  |       }
  85  |     })
  86  | 
> 87  |     await page.goto('/')
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
  88  | 
  89  |     // Wait for initial render
  90  |     await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {})
  91  | 
  92  |     // Rapid interactions that might trigger re-renders
  93  |     for (let i = 0; i < 10; i++) {
  94  |       await page.mouse.wheel(100, 0)
  95  |       await page.waitForTimeout(100)
  96  |     }
  97  | 
  98  |     // Toggle sidebar
  99  |     await page.click('button:has-text("Load")')
  100 |     await page.waitForTimeout(500)
  101 |     await page.click('button:has-text("Load")')
  102 |     await page.waitForTimeout(500)
  103 | 
  104 |     const pageErrors: string[] = []
  105 |     page.on('pageerror', (error) => {
  106 |       pageErrors.push(error.message)
  107 |     })
  108 | 
  109 |     await page.waitForTimeout(1000)
  110 | 
  111 |     expect(errors).toEqual([])
  112 |     expect(pageErrors).toEqual([])
  113 |   })
  114 | 
  115 |   test('should handle quality preset changes without errors', async ({ page }) => {
  116 |     const errors: string[] = []
  117 | 
  118 |     page.on('console', (msg) => {
  119 |       if (msg.type() === 'error') {
  120 |         errors.push(msg.text())
  121 |       }
  122 |     })
  123 | 
  124 |     await page.goto('/')
  125 | 
  126 |     await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {})
  127 | 
  128 |     // Change quality presets
  129 |     for (let i = 0; i < 5; i++) {
  130 |       const qualityButtons = await page.locator('button:has-text("Quality")')
  131 |       if (await qualityButtons.count() > 0) {
  132 |         await qualityButtons.click()
  133 |         await page.waitForTimeout(200)
  134 | 
  135 |         // Click a random quality pill
  136 |         const pills = await page.locator('.quality-pills-container button').all()
  137 |         if (pills.length > 0) {
  138 |           await pills[0].click()
  139 |           await page.waitForTimeout(300)
  140 |         }
  141 |       }
  142 |     }
  143 | 
  144 |     const pageErrors: string[] = []
  145 |     page.on('pageerror', (error) => {
  146 |       pageErrors.push(error.message)
  147 |     })
  148 | 
  149 |     await page.waitForTimeout(1000)
  150 | 
  151 |     expect(errors).toEqual([])
  152 |     expect(pageErrors).toEqual([])
  153 |   })
  154 | 
  155 |   test('should handle slider interactions without errors', async ({ page }) => {
  156 |     const errors: string[] = []
  157 | 
  158 |     page.on('console', (msg) => {
  159 |       if (msg.type() === 'error') {
  160 |         errors.push(msg.text())
  161 |       }
  162 |     })
  163 | 
  164 |     await page.goto('/')
  165 | 
  166 |     await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {})
  167 | 
  168 |     // Try to interact with sliders
  169 |     const sliders = await page.locator('input[type="range"]').all()
  170 |     for (let i = 0; i < Math.min(sliders.length, 3); i++) {
  171 |       await sliders[i].click()
  172 |       await page.mouse.move(0, 0)
  173 |       await page.mouse.wheel(0, 100)
  174 |       await page.waitForTimeout(100)
  175 |     }
  176 | 
  177 |     const pageErrors: string[] = []
  178 |     page.on('pageerror', (error) => {
  179 |       pageErrors.push(error.message)
  180 |     })
  181 | 
  182 |     await page.waitForTimeout(1000)
  183 | 
  184 |     expect(errors).toEqual([])
  185 |     expect(pageErrors).toEqual([])
  186 |   })
  187 | 
```