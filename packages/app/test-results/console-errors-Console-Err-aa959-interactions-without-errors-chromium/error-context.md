# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: console-errors.spec.ts >> Console Error Detection >> should handle timeline interactions without errors
- Location: e2e/console-errors.spec.ts:188:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
Call log:
  - navigating to "http://localhost:5173/", waiting until "load"

```

# Test source

```ts
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
  188 |   test('should handle timeline interactions without errors', async ({ page }) => {
  189 |     const errors: string[] = []
  190 | 
  191 |     page.on('console', (msg) => {
  192 |       if (msg.type() === 'error') {
  193 |         errors.push(msg.text())
  194 |       }
  195 |     })
  196 | 
> 197 |     await page.goto('/')
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/
  198 | 
  199 |     await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {})
  200 | 
  201 |     // Toggle timeline visibility
  202 |     const timelineToggle = page.locator('button:has-text("Timeline")')
  203 |     if (await timelineToggle.isVisible()) {
  204 |       await timelineToggle.click()
  205 |       await page.waitForTimeout(500)
  206 |       await timelineToggle.click()
  207 |       await page.waitForTimeout(500)
  208 |     }
  209 | 
  210 |     const pageErrors: string[] = []
  211 |     page.on('pageerror', (error) => {
  212 |       pageErrors.push(error.message)
  213 |     })
  214 | 
  215 |     await page.waitForTimeout(1000)
  216 | 
  217 |     expect(errors).toEqual([])
  218 |     expect(pageErrors).toEqual([])
  219 |   })
  220 | 
  221 |   test('should handle multiple rapid renders without errors', async ({ page }) => {
  222 |     const errors: string[] = []
  223 | 
  224 |     page.on('console', (msg) => {
  225 |       if (msg.type() === 'error') {
  226 |         errors.push(msg.text())
  227 |       }
  228 |     })
  229 | 
  230 |     await page.goto('/')
  231 | 
  232 |     // Rapidly refresh page multiple times
  233 |     for (let i = 0; i < 3; i++) {
  234 |       await page.reload()
  235 |       await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
  236 |       await page.waitForSelector('canvas', { timeout: 10000 }).catch(() => {})
  237 |       await page.waitForTimeout(500)
  238 |     }
  239 | 
  240 |     const pageErrors: string[] = []
  241 |     page.on('pageerror', (error) => {
  242 |       pageErrors.push(error.message)
  243 |     })
  244 | 
  245 |     await page.waitForTimeout(1000)
  246 | 
  247 |     expect(errors).toEqual([])
  248 |     expect(pageErrors).toEqual([])
  249 |   })
  250 | })
  251 | 
```