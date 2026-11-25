// English pronunciation of each country's name.
//  1. IPA: from the English entry on Wiktionary (the "Pronunciation" lines, US reading preferred). The raw lines are cached in
//     data/raw/wiktionary/pronunciation.json so the deck can be rebuilt offline.
//  2. Respelling ("kroh-AY-shuh"): generated from the IPA by scripts/respell.js, so every country follows the same key.
// Writes data/pronunciation.json: { ISO3: { ipa: "/kroʊˈeɪʃə/", respell: "kroh-AY-shuh" } }.
// Usage: node scripts/pronunciation.js            use the cache, fetch only what is missing
//        node scripts/pronunciation.js --refresh  fetch everything again (needs internet access)
import fs from 'node:fs';
import { respell } from './respell.js';

const UA = { 'User-Agent': 'StudyDeckBuilder/1.0 (personal flashcard project)' };
const RAW = 'data/raw/wiktionary/pronunciation.json';
const COUNTRIES = JSON.parse(fs.readFileSync('data/countries.json', 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wiktionary title when it differs from the country name in data/countries.json.
const TITLE = {};
// Hand-checked IPA for countries Wiktionary has no usable entry for.
const IPA_OVERRIDES = {
  ARE: '/juˈnaɪtɪd ˈɛɹəb ˈɛmɪɹɪts/', // the entry's own transcription uses non-standard symbols
  IRL: '/ˈaɪɚlənd/', // the entry brackets the r
  COD: '/dɛməˈkɹætɪk ɹɪˈpʌblɪk əv ðə ˈkɑŋɡoʊ/', // the entry is a UK reading
  COG: '/ɹɪˈpʌblɪk əv ðə ˈkɑŋɡoʊ/', // no entry under this title
};

const raw = fs.existsSync(RAW) && !process.argv.includes('--refresh') ? JSON.parse(fs.readFileSync(RAW, 'utf8')) : {};
const save = () => { fs.mkdirSync('data/raw/wiktionary', { recursive: true }); fs.writeFileSync(RAW, JSON.stringify(raw, null, 1)); };

async function wikitext(title) {
  const url = `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2`;
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: UA });
    if (r.status === 404) return null;
    if (r.ok) { const j = await r.json(); return j.parse?.wikitext ?? null; }
    await sleep(Number(r.headers.get('retry-after')) * 1000 || 5000 * (i + 1));
  }
  throw new Error('failed: ' + url);
}

// The English section's pronunciation lines, one per accent: [{ labels: ['US'], ipa: ['/…/', …] }].
function englishLines(wt) {
  const m = wt.match(/(?:^|\n)==English==\n([\s\S]*?)(?=\n==[^=]|$)/);
  if (!m) return [];
  const out = [];
  for (const line of m[1].split('\n')) {
    // {{IPA|en|/…/|/…/|a=US}}: positional parameters are transcriptions, a= is the accent the line is for.
    for (const m of line.matchAll(/\{\{IPA\|en\|([^}]*)\}\}/g)) {
      const parts = m[1].split('|');
      const labels = (parts.find((p) => p.startsWith('a=')) || '').slice(2).split(',').map((x) => x.trim()).filter(Boolean);
      out.push({ labels, ipa: parts.filter((p) => /^\/.+\/$|^\[.+\]$/.test(p)) });
    }
  }
  return out.filter((l) => l.ipa.length);
}

for (const c of COUNTRIES) {
  if (raw[c.iso]) continue;
  const title = TITLE[c.iso] || c.name;
  const wt = await wikitext(title);
  raw[c.iso] = { title, lines: wt ? englishLines(wt) : [] };
  console.log(c.iso.padEnd(4), title.padEnd(28), raw[c.iso].lines.map((l) => `${l.labels.join(',')}: ${l.ipa.join(' ')}`).join('  |  '));
  save();
  await sleep(400);
}

// The entry lists one line per accent (UK, US, regional ones) with several transcriptions each: take the first US one, else the first
// UK one, else the first line with no regional label. Syllable dots are kept; respell.js uses them as boundaries.
const out = {};
for (const c of COUNTRIES) {
  const lines = raw[c.iso]?.lines || [];
  // Phonemic (/…/) transcriptions only, not phonetic ([…]) ones. Order of preference: a US line, a line with no accent label,
  // a UK line, any line. Labels like "pin-pen" or "rare" mark a variant, so they never count as a plain US or UK line.
  const phonemic = lines.map((l) => ({ ...l, ipa: l.ipa.filter((p) => p.startsWith('/')) })).filter((l) => l.ipa.length);
  const accent = (l, re) => l.labels.some((x) => re.test(x)) && l.labels.every((x) => /^(US|GenAm|General American|GA|CA|UK|RP|Received Pronunciation)$/i.test(x));
  const line = phonemic.find((l) => accent(l, /^(US|GenAm|General American|GA)$/i)) || phonemic.find((l) => !l.labels.length)
    || phonemic.find((l) => accent(l, /^(UK|RP|Received Pronunciation)$/i)) || phonemic[0];
  const ipa = IPA_OVERRIDES[c.iso] || line?.ipa[0];
  if (ipa) { try { out[c.iso] = { ipa, respell: respell(ipa) }; } catch (e) { console.log(c.iso, e.message); } }
}
fs.writeFileSync('data/pronunciation.json', JSON.stringify(out, null, 1));
console.log('pronunciations:', Object.keys(out).length, '/', COUNTRIES.length, 'missing:', COUNTRIES.filter((c) => !out[c.iso]).map((c) => c.iso).join(' '));
