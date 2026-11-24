// End-to-end check in real Chrome against the dev server (uses ?mock=1, no robot needed).
// Usage: npm run dev (in another terminal), then: node e2e/smoke.mjs [outDir]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.EAGLETS_URL ?? 'http://localhost:5173';
const out = process.argv[2] ?? 'e2e/screens';
mkdirSync(out, { recursive: true });
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    errors.push(`${name}: ${e.message.split('\n')[0]}`);
  }
};
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });

await page.goto(`${BASE}/?mock=1`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.injectionDiv');
await page.waitForTimeout(600);
await shot('01-start');

await step('first program is loaded', async () => {
  const n = await page.locator('.blocklyMainBackground ~ g .blocklyDraggable, g.blocklyBlockCanvas > g.blocklyDraggable').count();
  if (n < 1) throw new Error('no blocks on workspace');
});

await step('toolbox categories present', async () => {
  for (const c of ['Start', 'Movement', 'Lights', 'Sensors', 'Logic', 'Loops', 'Variables', 'Functions']) {
    await page.getByRole('treeitem', { name: c }).first().waitFor({ timeout: 2000 }).catch(async () => {
      if (!(await page.getByText(c, { exact: true }).first().isVisible())) throw new Error(`missing category ${c}`);
    });
  }
  if (await page.getByText('Sound', { exact: true }).count()) throw new Error('Sound category should be hidden without a buzzer');
});

await step('open Movement flyout', async () => {
  await page.getByRole('treeitem', { name: 'Movement' }).click();
  await page.waitForSelector('.blocklyFlyout g.blocklyDraggable', { timeout: 3000 });
  await page.waitForTimeout(300);
  await shot('02-movement-flyout');
  await page.keyboard.press('Escape');
});

await step('starter gallery loads Obstacle Detection', async () => {
  await page.getByRole('button', { name: /Starters/ }).click();
  await page.waitForSelector('.starter-card');
  await shot('03-starters');
  await page.locator('.starter-card', { hasText: 'Obstacle Detection' }).click();
  await page.waitForTimeout(400);
  const name = await page.locator('.project-name').inputValue();
  if (name !== 'Obstacle Detection') throw new Error(`project name is ${name}`);
  await shot('04-obstacle-loaded');
});

await step('Python view shows generated code', async () => {
  await page.getByRole('button', { name: /Python/ }).click();
  const text = await page.locator('.python-view').innerText();
  if (!text.includes('if robot.distance() < 15:') || !text.includes('robot.shutdown()')) throw new Error('unexpected python:\n' + text);
  await shot('05-python');
  await page.getByRole('button', { name: 'Close' }).click();
});

await step('simulator runs and stops the obstacle program', async () => {
  await page.getByRole('tab', { name: /Simulator/ }).click();
  await page.getByRole('button', { name: /^▶ Run/ }).click();
  await page.waitForTimeout(2500);
  await shot('06-sim-running');
  const ledColor = await page.locator('.sim-led').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  if (ledColor === 'rgb(0, 0, 0)') throw new Error('LEDs never lit in the simulator');
  await page.getByRole('button', { name: /Stop/ }).click();
  await page.waitForSelector('.notice-success');
  const notice = await page.locator('.notice').innerText();
  if (!/stopped/i.test(notice)) throw new Error(`notice: ${notice}`);
});

await step('sim drives to the wall and stops (distance < 15)', async () => {
  await page.getByRole('button', { name: /^▶ Run/ }).click();
  await page.waitForTimeout(7000);
  const d = await page.locator('.sim-readout').innerText();
  const cm = parseFloat(d.replace(/[^\d.]/g, ''));
  await shot('07-sim-at-wall');
  await page.getByRole('button', { name: /Stop/ }).click();
  if (!(cm < 16)) throw new Error(`robot should have stopped near the wall, distance ${d}`);
});

await step('mock robot: connect, run, stop', async () => {
  await page.getByRole('tab', { name: /My Robot/ }).click();
  await page.getByRole('button', { name: /Connect Robot/ }).click();
  await page.waitForSelector('.status-ready', { timeout: 5000 });
  await shot('08-connected');
  await page.getByRole('button', { name: /Run on Robot/ }).click();
  await page.waitForSelector('.status-running', { timeout: 15000 });
  await page.waitForTimeout(800);
  await shot('09-running');
  await page.getByRole('button', { name: /Stop/ }).click();
  await page.waitForSelector('.status-ready', { timeout: 5000 });
  const notice = await page.locator('.notice').innerText();
  if (!/stopped/i.test(notice)) throw new Error(`notice: ${notice}`);
});

await step('validation: empty program gives a friendly error', async () => {
  await page.getByRole('button', { name: 'Clear workspace' }).click();
  await page.getByRole('button', { name: 'Clear blocks' }).click();
  await page.getByRole('button', { name: /Run on Robot/ }).click();
  const notice = await page.locator('.notice').innerText();
  if (!/when program starts/.test(notice)) throw new Error(`notice: ${notice}`);
  await shot('10-validation');
  await page.getByRole('button', { name: 'Undo' }).click();
});

await step('instructor settings + beginner toggle', async () => {
  await page.getByRole('button', { name: 'Instructor settings' }).click();
  await page.waitForSelector('.settings-grid');
  await shot('11-settings');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('.toggle').click();
  await page.waitForTimeout(300);
});

await step('help dialog', async () => {
  await page.getByRole('button', { name: 'Help' }).click();
  await page.waitForSelector('.steps');
  await shot('12-help');
  await page.getByRole('button', { name: 'Close' }).click();
});

await step('autosave restores the project after reload', async () => {
  await page.waitForTimeout(800);
  await page.reload();
  await page.waitForSelector('.injectionDiv');
  await page.waitForTimeout(500);
  const name = await page.locator('.project-name').inputValue();
  if (name !== 'Obstacle Detection') throw new Error(`after reload project is ${name}`);
});

await page.setViewportSize({ width: 1024, height: 768 });
await page.waitForTimeout(300);
await shot('13-1024');

await browser.close();
const real = errors.filter((e) => !/favicon/.test(e));
console.log(real.length ? `\n${real.length} problem(s):\n` + real.join('\n') : '\nAll end-to-end checks passed.');
process.exit(real.length ? 1 : 0);
