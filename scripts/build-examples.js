// Renders example card screenshots (docs/images/*.png) from templates/ and data/records.json, using headless Edge/Chrome.
// Needs the maps in build/media (npm run render, or node scripts/render-all.js KEN JPN) and the flags (npm run flags:copy).
// Usage: node scripts/build-examples.js
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) throw new Error('No Edge or Chrome found');

// [file name, card folder, side, ISO, width, height]
const SHOTS = [
  ['locate-front', 'locate', 'front', 'KEN', 1280, 720],
  ['locate-back', 'locate', 'back', 'KEN', 1280, 720],
  ['flag-front', 'flag-to-country', 'front', 'BRA', 1280, 720],
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

fs.mkdirSync('build/examples', { recursive: true });
fs.mkdirSync('docs/images', { recursive: true });
for (const [name, card, side, iso, w, h] of SHOTS) {
  const tpl = fs.readFileSync(`templates/${card}/${side}.html`, 'utf8');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="card"><div id="qa">${render(tpl, fieldsOf(iso))}</div>`;
  const page = path.resolve(`build/examples/${name}.html`);
  fs.writeFileSync(page, html);
  const out = path.resolve(`docs/images/${name}.png`);
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--screenshot=${out}`, `--window-size=${w},${h}`, '--virtual-time-budget=4000', pathToFileURL(page).href], { stdio: 'ignore' });
  console.log('wrote', path.relative('.', out));
}
