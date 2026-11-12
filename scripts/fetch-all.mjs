// Fetches facts for every country into data/facts-all.json. Wikidata (capital, flag, languages, currency, government,
// leaders and parties), World Bank (population, GDP, land area, density), happiness CSV. Raw answers are cached in
// data/raw/wikidata/ so a rerun only asks for what is missing. Usage: node fetch-all.mjs [--refresh]
import fs from 'node:fs';
import { happiness } from './happiness.mjs';

const UA = { 'User-Agent': 'StudyDeckBuilder/1.0 (personal flashcard project)' };
const COUNTRIES = JSON.parse(fs.readFileSync('data/countries.json', 'utf8'));
const CACHE = 'data/raw/wikidata';
fs.mkdirSync(CACHE, { recursive: true });
const refresh = process.argv.includes('--refresh');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(name, body, chunk) {
  const file = `${CACHE}/${name}-${chunk.map((c) => c.iso)[0]}.json`;
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const values = chunk.map((c) => `(wd:${c.qid} "${c.iso}")`).join(' ');
  const q = `SELECT * WHERE { VALUES (?c ?iso) { ${values} } ${body} }`;
  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: UA });
    if (r.ok) {
      const rows = (await r.json()).results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
      fs.writeFileSync(file, JSON.stringify(rows));
      await sleep(500);
      return rows;
    }
    await sleep(3000 * (i + 1));
  }
  throw new Error(`Wikidata failed for ${name} ${chunk[0].iso}`);
}

const L = (v) => `SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?${v} rdfs:label ?${v}Label . }`;
const QUERIES = {
  capital: `?c p:P36 ?s . ?s ps:P36 ?v . FILTER NOT EXISTS { ?s pq:P582 ?e } ${L('v')}`,
  flag: `?c wdt:P41 ?v .`,
  languages: `?c wdt:P37 ?v . ${L('v')}`,
  currency: `?c p:P38 ?s . ?s ps:P38 ?v . FILTER NOT EXISTS { ?s pq:P582 ?e } ${L('v')}`,
  government: `?c wdt:P122 ?v . ${L('v')}`,
  hog: `?c p:P6 ?s . ?s ps:P6 ?p . FILTER NOT EXISTS { ?s pq:P582 ?e } OPTIONAL { ?s pq:P580 ?start } OPTIONAL { ?p p:P102 ?ps . ?ps ps:P102 ?party . FILTER NOT EXISTS { ?ps pq:P582 ?pe } } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?p rdfs:label ?pLabel . ?party rdfs:label ?partyLabel . }`,
  hos: `?c p:P35 ?s . ?s ps:P35 ?p . FILTER NOT EXISTS { ?s pq:P582 ?e } OPTIONAL { ?s pq:P580 ?start } OPTIONAL { ?p p:P102 ?ps . ?ps ps:P102 ?party . FILTER NOT EXISTS { ?ps pq:P582 ?pe } } SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?p rdfs:label ?pLabel . ?party rdfs:label ?partyLabel . }`,
  pop: `?c wdt:P1082 ?v .`, area: `?c wdt:P2046 ?v .`, gdp: `?c wdt:P2131 ?v .`,
};

const raw = {};
const chunks = [];
for (let i = 0; i < COUNTRIES.length; i += 30) chunks.push(COUNTRIES.slice(i, i + 30));
for (const [name, body] of Object.entries(QUERIES)) {
  raw[name] = [];
  for (const ch of chunks) raw[name].push(...(await sparql(name, body, ch)));
  console.log('wikidata', name, raw[name].length);
}

// --- World Bank
async function wb(id) {
  const r = await fetch(`https://api.worldbank.org/v2/country/all/indicator/${id}?format=json&mrnev=1&per_page=1000`, { headers: UA });
  const out = {};
  for (const d of (await r.json())[1] || []) if (d.value != null) out[d.countryiso3code] = { value: d.value, year: +d.date };
  return out;
}
const WB = { pop: await wb('SP.POP.TOTL'), gdp: await wb('NY.GDP.MKTP.CD'), land: await wb('AG.LND.TOTL.K2'), density: await wb('EN.POP.DNST') };

// --- helpers
const by = (rows) => { const m = {}; for (const r of rows) (m[r.iso] ||= []).push(r); return m; };
const labels = (rows, f = 'vLabel') => { const m = {}; for (const r of rows) { const v = r[f]; if (v && !/^Q\d+$/.test(v)) { m[r.iso] ||= []; if (!m[r.iso].includes(v)) m[r.iso].push(v); } } return m; };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (rows) => { const m = {}; for (const r of rows) m[r.iso] = Math.max(m[r.iso] || 0, +r.v); return m; };
const capital = labels(raw.capital), languages = labels(raw.languages), currency = labels(raw.currency), government = labels(raw.government);
const flag = {}; for (const r of raw.flag) flag[r.iso] ||= r.v;
const wdPop = num(raw.pop), wdArea = num(raw.area), wdGdp = num(raw.gdp);

// latest-started current holder; parties joined (independent shown as "Independent")
function holder(rows) {
  const m = {};
  for (const [iso, rs] of Object.entries(by(rows))) {
    const people = {};
    for (const r of rs) {
      const p = (people[r.p] ||= { name: r.pLabel, start: r.start || '', parties: [] });
      if (r.start && r.start > p.start) p.start = r.start;
      if (r.partyLabel && !/^Q\d+$/.test(r.partyLabel) && !p.parties.includes(r.partyLabel)) p.parties.push(r.partyLabel);
    }
    const best = Object.values(people).sort((a, b) => b.start.localeCompare(a.start))[0];
    m[iso] = { name: best.name, start: best.start.slice(0, 10), parties: best.parties.map((x) => (/^independent/i.test(x) ? 'Independent' : x)).slice(0, 2), candidates: Object.keys(people).length };
  }
  return m;
}
const hog = holder(raw.hog), hos = holder(raw.hos);

// government: keep recognisable terms in a fixed order
const GOV = ['absolute monarchy', 'constitutional monarchy', 'federal republic', 'parliamentary republic', 'semi-presidential system', 'presidential system', 'parliamentary system', 'one-party state', 'theocracy', 'military dictatorship', 'unitary state', 'republic', 'monarchy'];
const govText = (list = []) => {
  const low = list.map((x) => x.toLowerCase());
  const got = GOV.filter((g) => low.includes(g)).slice(0, 2).map((g) => cap(g.replace('presidential system', 'presidential republic').replace('parliamentary system', 'parliamentary republic')));
  return [...new Set(got)].join(', ');
};

const n = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d });
const usd = (v) => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)} trillion` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)} billion` : `$${(v / 1e6).toFixed(0)} million`);
const sameName = (a, b) => a.toLowerCase().replace(/[^a-z]/g, '') === b.toLowerCase().replace(/[^a-z]/g, '');

const facts = {};
for (const c of COUNTRIES) {
  const w = (k) => WB[k][c.iso] || null;
  let pop = w('pop'), gdp = w('gdp'), land = w('land');
  const src = [];
  if (!pop && wdPop[c.iso]) { pop = { value: wdPop[c.iso], year: null }; src.push('pop:wikidata'); }
  if (!gdp && wdGdp[c.iso]) { gdp = { value: wdGdp[c.iso], year: null }; src.push('gdp:wikidata'); }
  if (!land && wdArea[c.iso]) { land = { value: wdArea[c.iso], year: null }; src.push('area:wikidata'); }
  let density = w('density')?.value ?? (pop && land ? pop.value / land.value : null);
  const h = happiness(c.iso === 'XKX' ? 'OWID_KOS' : c.iso);
  const leader = c.iso === 'VAT' ? { name: 'Leo XIV', parties: [] } : hog[c.iso] || hos[c.iso] || null;
  const head = hos[c.iso] || null;
  const showHead = head && (!leader || head.name !== leader.name) ? head : null;
  facts[c.iso] = {
    iso: c.iso, name: c.name,
    capital: (capital[c.iso] || []).slice(0, 3),
    flag: flag[c.iso] || null,
    population: pop ? n(pop.value) : '', gdp: gdp ? usd(gdp.value) : '', gdpPerCapita: gdp && pop ? '$' + n(Math.round(gdp.value / pop.value)) : '', landArea: land ? `${n(land.value, land.value < 10 ? 2 : 0)} km²` : '',
    density: density != null ? `${n(density, density < 10 ? 1 : 0)} per km²` : '',
    happiness: h ? h.text : '', languages: (languages[c.iso] || []).join(', '), currency: (currency[c.iso] || []).map(cap).join(' / '),
    government: govText(government[c.iso]), religion: '',
    leader: leader?.name || '', party: leader ? leader.parties.join(' / ') : '', leaderSince: leader?.start || '',
    head: showHead ? `${showHead.name}${showHead.parties.length ? ` (${showHead.parties.join(' / ')})` : ''}` : '',
    asOf: String(pop?.year || new Date().getFullYear()),
    _src: src, _leaderCandidates: hog[c.iso]?.candidates ?? hos[c.iso]?.candidates ?? 0,
  };
}
fs.writeFileSync('data/facts-all.json', JSON.stringify(facts, null, 1));
const miss = (k) => Object.values(facts).filter((f) => !(Array.isArray(f[k]) ? f[k].length : f[k])).map((f) => f.iso);
for (const k of ['capital', 'flag', 'population', 'gdp', 'landArea', 'density', 'happiness', 'languages', 'currency', 'government', 'leader', 'party']) console.log(k.padEnd(11), 'missing', miss(k).length, miss(k).length < 30 ? miss(k).join(' ') : '');
