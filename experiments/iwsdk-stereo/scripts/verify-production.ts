// Production UI proof with real desktop clicks and mobile touch input, without IWER.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const base = process.env.VERIFY_BASE_URL ?? 'https://127.0.0.1:5188/'
const out = path.resolve(process.env.VERIFY_OUT_DIR ?? 'artifacts')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  headless: false,
  args: [
    '--class=agent-browser',
    '--enable-features=Vulkan',
    '--ignore-gpu-blocklist',
  ],
})
const errors: string[] = []
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      ignoreHTTPSErrors: true,
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 850 },
      hasTouch: mobile,
      isMobile: mobile,
    })
    page.on('pageerror', (error) => errors.push(String(error)))
    page.on('console', (message) => {
      if (
        message.type() === 'error' ||
        /computations created outside/.test(message.text())
      )
        errors.push(message.text())
    })
    assert.equal(
      (await page.goto(base, { waitUntil: 'networkidle' }))?.status(),
      200,
    )
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>('.actions button')?.disabled,
    )
    assert.equal(
      await page.evaluate(() => !!window.IWER_DEVICE || !!window.__lumenStereo),
      false,
      'Production must omit emulator and debug hooks',
    )
    const hold = page.getByRole('button', { name: 'Hold motion' })
    if (mobile) await hold.tap()
    else await hold.click()
    await page.getByRole('button', { name: 'Resume motion' }).waitFor()
    if (mobile) await page.touchscreen.tap(195, 380)
    else await page.mouse.click(640, 400)
    await page.getByText('Verdant selected · amber resonance').waitFor()
    const resume = page.getByRole('button', { name: 'Resume motion' })
    if (mobile) await resume.tap()
    else {
      await resume.focus()
      await page.keyboard.press('Enter')
    }
    await page.getByRole('button', { name: 'Hold motion' }).waitFor()
    const layout = await page.evaluate(() => ({
      width: window.innerWidth,
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      captionBottom: document.querySelector('.caption')!.getBoundingClientRect()
        .bottom,
      controlsTop: document.querySelector('.controls')!.getBoundingClientRect()
        .top,
      controls: [...document.querySelectorAll('.actions button')].map(
        (button) => ({
          rect: button.getBoundingClientRect().toJSON(),
          border: window.getComputedStyle(button).borderTopStyle,
          font: window.getComputedStyle(button).fontSize,
        }),
      ),
    }))
    assert.equal(layout.overflow, false)
    if (mobile)
      assert.ok(
        layout.captionBottom < layout.controlsTop,
        'Phone title must stay above the controls',
      )
    assert.ok(
      layout.controls.every(
        (control) =>
          control.rect.height >= 44 &&
          control.rect.x >= 0 &&
          control.rect.right <= layout.width &&
          control.border === 'solid',
      ),
    )
    await page.screenshot({
      path: path.join(
        out,
        mobile ? 'production-touch.png' : 'production-desktop.png',
      ),
    })
    await page.close()
  }
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(
    path.join(out, 'production.json'),
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        base,
        passed: true,
        errors,
        checks: [
          'production desktop selection',
          'keyboard motion control',
          '390px real touch selection and motion controls',
          '44px styled controls within viewport',
          'phone title stays above unsupported-VR feedback',
          'no IWER or debug hooks',
        ],
      },
      null,
      2,
    ),
  )
  console.info(
    'PASS: production desktop, keyboard and mobile touch controls; no emulator or debug hooks',
  )
} finally {
  await browser.close()
}
