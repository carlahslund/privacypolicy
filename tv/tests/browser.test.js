/* Interaction tests for the browser build, run against a real Chromium.
 *
 *   npm install --no-save playwright && npx playwright install chromium
 *   node tv/tests/browser.test.js
 *
 * Two faults on a real Samsung TV are the reason this file exists, and neither
 * could be caught by testing the engine:
 *
 *   1. The page assumed a D-pad. A smart TV's own browser hands the page an
 *      on-screen pointer instead and never sends a key, so with the on-screen
 *      controls hidden there was nothing to press — the timer loaded and could
 *      not be started.
 *   2. AudioContext.resume() keeps its promise even when the browser leaves the
 *      context suspended for want of a gesture. Believing the promise hid the one
 *      button that could turn the buzzer on, leaving a silent round timer.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'timer');
const PORT = 8847;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png' };

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) return;
  failures += 1;
  console.error('FAIL  ' + label + '\n      expected ' + b + '\n      actual   ' + a);
}

/* A TV browser that keeps the promise but not the audio: resume() resolves while
   the context stays suspended until something is actually pressed. */
function gatedAudio() {
  window.__gesture = false;
  document.addEventListener('click', () => { window.__gesture = true; }, true);
  const node = () => ({
    connect() {}, start() {}, stop() {}, type: '',
    frequency: { value: 0, setValueAtTime() {} },
    gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }
  });
  class GatedContext {
    constructor() { this._state = 'suspended'; this.destination = {}; this.currentTime = 0; }
    get state() { return this._state; }
    resume() { if (window.__gesture) this._state = 'running'; return Promise.resolve(); }
    createOscillator() { return node(); }
    createGain() { return node(); }
  }
  window.AudioContext = GatedContext;
  window.webkitAudioContext = GatedContext;
}

function serve() {
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent(request.url.split('?')[0]);
    const file = path.join(ROOT, name === '/' ? 'index.html' : name);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404);
      return response.end();
    }
    response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    response.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

const text = async (page, selector) => (await page.textContent(selector)).replace(/\s+/g, ' ').trim();
const shown = (page, selector) => page.evaluate(
  sel => { const el = document.querySelector(sel); return !!el && !el.hidden && getComputedStyle(el).display !== 'none'; },
  selector
);

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    console.error('No build at /timer — run tv/tools/build-web.sh first.');
    process.exit(1);
  }
  const { chromium } = require('playwright');
  const server = await serve();
  const browser = await chromium.launch();
  const problems = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await context.addInitScript(gatedAudio);
    const page = await context.newPage();
    page.on('pageerror', error => problems.push('page error: ' + error.message));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(800);

    /* --- a TV that only has a pointer ------------------------------------- */
    check('the control bar is offered', await shown(page, '#display-actions'), true);
    check('and it opens the menu', await text(page, '#menu-button'), '☷ CONTROLS');

    await page.click('#menu-button');
    await page.waitForTimeout(200);
    check('the menu opens by pointer alone', await shown(page, '#tv-overlay'), true);

    await page.click('.tv-row:has-text("START / PAUSE")');
    await page.waitForTimeout(1300);
    check('a tap starts the round', await text(page, '#display-status'), 'ROLL');
    check('and the clock is moving', (await text(page, '#display-time')) !== '03:00', true);

    await page.click('.tv-tab:has-text("SESSION SETUP")');
    await page.waitForTimeout(200);
    check('tabs answer to a tap', await text(page, '.tv-tab.current'), 'SESSION SETUP');

    const rounds = page.locator('.tv-row', { hasText: 'ROUNDS' }).first();
    await rounds.locator('[data-step="-1"]').click();
    await page.waitForTimeout(150);
    check('the steppers are reachable', (await rounds.textContent()).replace(/\s+/g, ' '), 'ROUNDS◀5▶');

    await page.click('.tv-row:has-text("APPLY & START")');
    await page.waitForTimeout(800);
    check('settings apply from a tap', await text(page, '#round-pill'), 'ROUND 1 / 5');
    check('and the menu gets out of the way', await shown(page, '#tv-overlay'), false);

    await page.click('#menu-button');
    await page.waitForTimeout(200);
    await page.mouse.click(120, 120);
    await page.waitForTimeout(200);
    check('aiming past the panel closes it', await shown(page, '#tv-overlay'), false);

    /* --- the buzzer must stay reachable ----------------------------------- */
    check('the sound button waits for its gesture', await shown(page, '#sound-button'), true);
    check('and says what it wants', await text(page, '#sound-button'), '🔊 ENABLE SOUND');
    await page.click('#sound-button');
    await page.waitForTimeout(400);
    check('a press turns the buzzer on', await text(page, '#sound-button'), '🔊 SOUND ON');
    check('and the round buzzer can now sound', await page.evaluate(() => {
      let voices = 0;
      const real = window.AudioContext.prototype.createOscillator;
      window.AudioContext.prototype.createOscillator = function () { voices += 1; return real.call(this); };
      window.GBApp.sound('end_round', 'classic', 0.8);
      window.AudioContext.prototype.createOscillator = real;
      return voices > 0;
    }), true);

    /* --- a TV that does send keys still works exactly as before ------------ */
    const remote = await context.newPage();
    remote.on('pageerror', error => problems.push('page error: ' + error.message));
    await remote.goto(`http://localhost:${PORT}/`);
    await remote.waitForTimeout(800);
    await remote.keyboard.press('ArrowUp');
    await remote.waitForTimeout(200);
    check('the D-pad still opens the menu', await shown(remote, '#tv-overlay'), true);
    await remote.keyboard.press('Enter');
    await remote.waitForTimeout(1300);
    check('and OK still starts the round', await text(remote, '#display-status'), 'ROLL');
    await remote.keyboard.press('Escape');
    await remote.waitForTimeout(200);
    check('and BACK still closes the menu', await shown(remote, '#tv-overlay'), false);
  } finally {
    await browser.close();
    server.close();
  }

  for (const problem of problems) {
    failures += 1;
    console.error('FAIL  ' + problem);
  }
  console.log((failures ? 'FAILED' : 'ok') + ' — ' + (checks - failures) + '/' + checks + ' checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(error => { console.error(error); process.exit(1); });
