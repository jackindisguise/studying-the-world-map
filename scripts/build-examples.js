// Renders example card screenshots (docs/images/*.png) from templates/ and data/records.json, using headless Edge/Chrome.
// Desktop shots use the browser's screenshot flag. Phone shots drive the browser over the DevTools protocol so they
// get mobile and touch emulation (no hover, coarse pointer), which is what makes the cards use their phone layout.
// Needs the maps in build/media (npm run render, or node scripts/render-all.js KEN BRA) and the flags (npm run flags:copy).
// Usage: node scripts/build-examples.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) throw new Error('No Edge or Chrome found');

// [file name, card folder, side, ISO, width, height, phone?]
const SHOTS = [
  ['locate-front', 'locate', 'front', 'KEN', 1280, 720],
  ['locate-back', 'locate', 'back', 'KEN', 1280, 720],
  ['flag-front', 'flag-to-country', 'front', 'BRA', 1280, 720],
  ['phone-locate-front', 'locate', 'front', 'KEN', 390, 844, true],
  ['phone-locate-back', 'locate', 'back', 'KEN', 390, 844, true],
  ['phone-flag-front', 'flag-to-country', 'front', 'BRA', 390, 844, true],
  ['phone-flag-back', 'flag-to-country', 'back', 'BRA', 390, 844, true],
];

const records = Object.fromEntries(JSON.parse(fs.readFileSync('data/records.json', 'utf8')).map((r) => [r.ISO, r]));
const boxes = JSON.parse(fs.readFileSync('build/fit/boxes.json', 'utf8'));
const css = fs.readFileSync('templates/locate/style.css', 'utf8');

// Minimal Anki template engine: {{#Field}}...{{/Field}} sections and {{Field}} substitutions.
const render = (tpl, f) => {
  let out = tpl;
  for (let prev; prev !== out; ) {
    prev = out;
    out = out.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k, body) => (f[k] ? body : ''));
  }
  return out.replace(/\{\{([^}#/]+)\}\}/g, (_, k) => f[k] ?? '');
};

const fieldsOf = (iso) => {
  const r = records[iso];
  const box = boxes[iso];
  return {
    ...r,
    Map: `<img src="../media/map-${iso}.svg"${box ? ` data-box="${box.join(',')}"` : ''}>`,
    Flag: `<img src="../media/flag-${iso}.svg">`,
  };
};

// Minimal DevTools protocol client over Node's built-in WebSocket.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startBrowser = async () => {
  const port = 9333;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'worldmap-shots-'));
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(200); }
  }
  const page = targets?.find((t) => t.type === 'page');
  if (!page) { proc.kill(); throw new Error('Could not connect to the browser'); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { pending.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { send, close: () => { ws.close(); proc.kill(); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } };
};

fs.mkdirSync('build/examples', { recursive: true });
fs.mkdirSync('docs/images', { recursive: true });
let cdp;
try {
  for (const [name, card, side, iso, w, h, phone] of SHOTS) {
    const tpl = fs.readFileSync(`templates/${card}/${side}.html`, 'utf8');
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="card"><div id="qa">${render(tpl, fieldsOf(iso))}</div>`;
    const page = path.resolve(`build/examples/${name}.html`);
    fs.writeFileSync(page, html);
    const out = path.resolve(`docs/images/${name}.png`);
    if (phone) {
      cdp ??= await startBrowser();
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Page.enable');
      await cdp.send('Page.navigate', { url: pathToFileURL(page).href });
      await sleep(2500); // the card script re-fits at load and again after 150 and 600 ms
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
    } else {
      execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${out}`, `--window-size=${w},${h}`, '--virtual-time-budget=4000', pathToFileURL(page).href], { stdio: 'ignore' });
    }
    console.log('wrote', path.relative('.', out));
  }
} finally {
  cdp?.close();
}
