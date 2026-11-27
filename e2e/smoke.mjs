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
// The privacy policy promises the app contacts no server but its own.
const foreignRequests = new Set();
page.on('request', (r) => {
  const u = new URL(r.url());
  if (/^https?:$/.test(u.protocol) && u.origin !== new URL(BASE).origin) foreignRequests.add(u.origin + u.pathname);
});
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
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: /Show Python/ }).click();
  const text = await page.locator('.python-view').innerText();
  if (!text.includes('if robot.distance() < 15:') || !text.includes('robot.shutdown()')) throw new Error('unexpected python:\n' + text);
  await shot('05-python');
  await page.getByRole('button', { name: 'Close' }).click();
});

await step('simulator runs and stops the obstacle program', async () => {
  await page.getByRole('tab', { name: /Simulator/ }).click();
  await page.getByRole('button', { name: /^Run/ }).click();
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
  await page.getByRole('button', { name: /^Run/ }).click();
  await page.waitForTimeout(7000);
  const d = await page.locator('.sim-readout').innerText();
  const cm = parseFloat(d.replace(/[^\d.]/g, ''));
  await shot('07-sim-at-wall');
  await page.getByRole('button', { name: /Stop/ }).click();
  if (!(cm < 16)) throw new Error(`robot should have stopped near the wall, distance ${d}`);
});

await step('Run on Robot connects by itself, with kid-friendly setup wording', async () => {
  await page.getByRole('tab', { name: /My Robot/ }).click();
  await page.getByRole('button', { name: /Run on Robot/ }).click();
  await page.waitForSelector('.notice:has-text("Getting your robot ready")', { timeout: 5000 });
  if (await page.locator('.notice:has-text(".py")').count()) throw new Error('students should not see library file names');
  await page.waitForSelector('.status-running', { timeout: 15000 });
  await page.getByRole('button', { name: /Stop/ }).click();
  await page.waitForSelector('.status-ready', { timeout: 5000 });
  if (await page.locator('.console').count()) throw new Error('beginner console should stay hidden when the program printed nothing');
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.waitForSelector('.status-disconnected', { timeout: 5000 });
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
  if (!(await page.locator('.notice-hint').count())) throw new Error('a block mistake should be a gentle hint, not a red error');
  await shot('10-validation');
  await page.getByRole('button', { name: 'Undo' }).click();
});

await step('instructor settings + beginner toggle', async () => {
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Instructor settings' }).click();
  await page.waitForSelector('.settings-grid');
  await shot('11-settings');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByText('More', { exact: true }).click();
  await page.getByText('Beginner mode').click();
  await page.waitForTimeout(300);
});

await step('teacher debug mode: badge, panel with log, turns off from the badge', async () => {
  await page.locator('details.more').evaluate((d) => (d.open = false)); // the step before leaves it open
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'Instructor settings' }).click();
  await page.getByText('Teacher debug mode').click();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.waitForSelector('.debug-panel');
  if (!(await page.locator('.debug-badge').isVisible())) throw new Error('debug badge missing');
  const entries = await page.locator('.debug-log li').allInnerTexts();
  if (!entries.some((t) => /Connect: Run pressed while not connected/.test(t))) throw new Error('debug log is missing the earlier connect');
  if (!entries.some((t) => /Installing eaglets\.py/.test(t))) throw new Error('debug log should keep the technical install messages');
  await shot('11b-debug');
  await page.locator('.debug-badge').click();
  if (await page.locator('.debug-panel').count()) throw new Error('debug panel still showing after turning it off');
});

await step('code mode: edit Python by hand, run it on the mock robot, keep it after reload', async () => {
  await page.getByRole('tab', { name: 'Code' }).click();
  await page.waitForSelector('.cm-content');
  const generated = await page.locator('.cm-content').innerText();
  if (!/robot/.test(generated)) throw new Error('editor did not start from the block program');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.type('\n# edited by hand');
  await page.getByRole('tab', { name: /My Robot/ }).waitFor();
  if (!(await page.getByRole('tab', { name: /Simulator/ }).isDisabled())) throw new Error('simulator tab should be disabled in code mode');
  if (!(await page.getByRole('button', { name: /Connect Robot|Disconnect/ }).first().isVisible())) throw new Error('robot panel missing');
  const connectBtn = page.getByRole('button', { name: /Connect Robot/ });
  if (await connectBtn.count()) await connectBtn.click();
  await page.getByRole('button', { name: /Run on Robot/ }).click();
  // The loaded program loops forever, so it runs until Stop.
  await page.waitForSelector('.notice:has-text("is running")', { timeout: 15000 });
  const sent = await page.locator('.console pre').innerText();
  if (!/running/i.test(sent)) throw new Error('program did not start on the robot');
  await page.getByRole('button', { name: /Stop/ }).click();
  await page.waitForSelector('.notice-success:has-text("Program stopped")', { timeout: 15000 });
  await shot('13-code-mode');
  await page.reload();
  await page.waitForSelector('.injectionDiv');
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: 'Code' }).click();
  await page.waitForSelector('.cm-content');
  if (!/edited by hand/.test(await page.locator('.cm-content').innerText())) throw new Error('hand-written code was not restored');
  await page.getByRole('tab', { name: 'Blocks' }).click();
});

await step('Thonny replacement: shell, save to robot, files, plot', async () => {
  await page.getByRole('tab', { name: 'Code' }).click();
  await page.waitForSelector('.cm-content');
  const shell = page.getByLabel('Shell input');
  await shell.fill('2 + 2');
  await shell.press('Enter');
  await page.waitForSelector('.shell-out:has-text("4")', { timeout: 15000 });
  if (!(await page.getByRole('button', { name: /Stop/ }).isEnabled())) throw new Error('Stop should be available after a Shell command');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.type('import eaglets as robot\nprint(10)\nprint(25)\nprint(18)\n');
  await page.getByRole('button', { name: 'Save to robot…' }).click();
  await page.getByLabel('File name on the robot').fill('hello.py');
  await page.locator('.modal .btn-primary').click();
  await page.waitForSelector('.notice:has-text("Saved hello.py on the robot")');
  if (!/hello\.py on the robot/.test(await page.locator('.code-file').innerText())) throw new Error('code bar should name the robot file');
  await page.getByRole('button', { name: /Run on Robot/ }).click();
  await page.waitForSelector('.notice-success:has-text("Program finished")', { timeout: 20000 });
  await page.getByRole('button', { name: 'plot' }).click();
  await page.waitForSelector('.plot svg path');
  await shot('13b-code-shell-plot');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.waitForSelector('.files-name:has-text("hello.py")', { timeout: 10000 });
  const names = await page.locator('.files-name').allInnerTexts();
  if (!names.includes('eaglets.py')) throw new Error(`robot library missing from file list: ${names}`);
  await shot('13c-files');
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('tab', { name: 'Blocks' }).click();
});

await step('help dialog', async () => {
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'How to connect' }).click();
  await page.waitForSelector('.steps');
  await shot('12-help');
  await page.getByRole('button', { name: 'Close' }).click();
});

await step('about & privacy dialog shows licences', async () => {
  await page.getByText('More', { exact: true }).click();
  await page.getByRole('button', { name: 'About & privacy' }).click();
  await page.getByText('Open-source software used in Eaglets Code').click();
  await page.waitForFunction(() => document.querySelector('.notices-text')?.textContent.includes('Apache License'));
  await shot('12b-about');
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

await step('no requests to third-party servers', async () => {
  if (foreignRequests.size) throw new Error(`contacted ${[...foreignRequests].join(', ')}`);
});

await browser.close();
const real = errors.filter((e) => !/favicon/.test(e));
console.log(real.length ? `\n${real.length} problem(s):\n` + real.join('\n') : '\nAll end-to-end checks passed.');
process.exit(real.length ? 1 : 0);
