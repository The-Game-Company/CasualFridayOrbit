// One-shot UI verification: launch Orbit, screenshot, click the collapse
// chevrons on both dividers, screenshot each state, expand back, quit.
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = path.join(os.tmpdir(), 'orbit-shots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const app = await electron.launch({
  executablePath: path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [path.join(APP_DIR, 'scripts', 'drive-wrapper.cjs')],
  timeout: 30_000
})
const page = await app.firstWindow()
await page.waitForSelector('.columns', { timeout: 20_000 })
await page.waitForTimeout(1500) // config load + first paint

const shot = async (name) => {
  const f = path.join(SHOT_DIR, name + '.png')
  await page.screenshot({ path: f })
  console.log('screenshot:', f)
}

const count = await page.evaluate(() => document.querySelectorAll('.col-collapse').length)
console.log('collapse buttons found:', count)
await shot('01-initial')

// collapse left, then right (DOM click — no coordinate math)
await page.evaluate(() => document.querySelectorAll('.col-collapse')[0]?.click())
await page.waitForTimeout(400)
console.log('left strip present:', await page.evaluate(() => !!document.querySelector('.col-strip.left')))
await shot('02-left-collapsed')

await page.evaluate(() => document.querySelector('.col-collapse')?.click()) // remaining = right
await page.waitForTimeout(400)
console.log('right strip present:', await page.evaluate(() => !!document.querySelector('.col-strip.right')))
await shot('03-both-collapsed')

// expand both via the strips
await page.evaluate(() => document.querySelector('.col-strip.left')?.click())
await page.evaluate(() => document.querySelector('.col-strip.right')?.click())
await page.waitForTimeout(400)
console.log(
  'strips after expand:',
  await page.evaluate(() => document.querySelectorAll('.col-strip').length),
  '| buttons:',
  await page.evaluate(() => document.querySelectorAll('.col-collapse').length)
)
await shot('04-expanded')

await app.close()
