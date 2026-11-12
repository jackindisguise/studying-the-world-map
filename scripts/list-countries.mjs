// Builds data/countries.json: the deck's country list from Wikidata (current sovereign states) plus Kosovo, Taiwan,
// Palestine and Vatican City, then prints anything unexpected for review.
import fs from 'node:fs';
const UA = { 'User-Agent': 'StudyDeckBuilder/1.0 (personal flashcard project)' };
const q = `SELECT ?c ?iso ?cLabel WHERE {
  { ?c wdt:P31 wd:Q3624078 . FILTER NOT EXISTS { ?c wdt:P576 ?d } ?c wdt:P298 ?iso . }
  UNION { VALUES (?c ?iso) { (wd:Q1246 "XKX") (wd:Q865 "TWN") (wd:Q219060 "PSE") (wd:Q237 "VAT") } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
let r;
for (let i = 0; i < 4; i++) {
  r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: UA });
  if (r.ok) break;
  await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
}
if (!r.ok) throw new Error('Wikidata ' + r.status);
const m = new Map();
for (const b of (await r.json()).results.bindings) m.set(b.iso.value, { iso: b.iso.value, qid: b.c.value.split('/').pop(), name: b.cLabel.value });
const list = [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync('data/countries-raw.json', JSON.stringify(list, null, 1));
console.log(list.length);
console.log(list.map((c) => `${c.iso}:${c.name}`).join(' | '));
