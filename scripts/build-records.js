// Merges everything into data/records.json: one object per country with the exact note field values (except images).
import fs from 'node:fs';
import { COUNTRIES, borders, regionLabel } from './geo.js';
const facts = JSON.parse(fs.readFileSync('data/facts-all.json', 'utf8'));
const leaders = JSON.parse(fs.readFileSync('data/leaders.json', 'utf8'));
const religion = JSON.parse(fs.readFileSync('data/religion.json', 'utf8'));

// Gaps neither source filled (checked by hand).
const FIX = { ATG: { capital: ["St. John's"] }, URY: { languages: 'Spanish' } };
// Anki sub-decks and the Region label: the continent, with North America split into three.
const CENTRAL = ['BLZ', 'CRI', 'SLV', 'GTM', 'HND', 'NIC', 'PAN'];
const CARIBBEAN = ['ATG', 'BHS', 'BRB', 'CUB', 'DMA', 'DOM', 'GRD', 'HTI', 'JAM', 'KNA', 'LCA', 'VCT', 'TTO'];
const subRegion = (iso) => (CENTRAL.includes(iso) ? 'Central America' : CARIBBEAN.includes(iso) ? 'Caribbean' : regionLabel(iso));
const name = Object.fromEntries(COUNTRIES.map((c) => [c.iso, c.name]));
const records = [];
for (const c of COUNTRIES) {
  const f = { ...facts[c.iso], ...(FIX[c.iso] || {}) }, l = leaders[c.iso];
  const capital = f.capital.join(', ');
  const b = borders(c.iso).map((i) => name[i]).sort((a, z) => a.localeCompare(z));
  records.push({
    ISO: c.iso, Name: c.name, Region: subRegion(c.iso), Capital: capital,
    Population: f.population, GDP: f.gdp, 'GDP per Capita': f.gdpPerCapita, 'Land Area': f.landArea, Density: f.density, Happiness: f.happiness,
    Languages: f.languages, Currency: f.currency, Government: f.government, Religion: religion[c.iso] || '',
    Leader: l.leader, Party: l.party, 'Head of State': l.head ? `${l.head}${l.headParty ? ` (${l.headParty})` : ''}` : '',
    Borders: b.join(', '), 'As Of': f.asOf,
    _flag: f.flag, _iso: c.iso,
  });
}
// Rank every numeric field among the countries that have a value: "43,844,111 (#36/197)". Ties share a rank; 1 = highest.
const UNITS = { million: 1e6, billion: 1e9, trillion: 1e12 };
const NUMERIC = {
  Population: (t) => Number(t.replace(/,/g, '')),
  GDP: (t) => parseFloat(t.replace(/[$,]/g, '')) * UNITS[t.split(' ')[1]],
  'GDP per Capita': (t) => Number(t.replace(/[$,]/g, '')),
  'Land Area': (t) => parseFloat(t.replace(/,/g, '')),
  Density: (t) => parseFloat(t.replace(/,/g, '')),
  Happiness: (t) => parseFloat(t),
};
for (const [k, num] of Object.entries(NUMERIC)) {
  if (k === 'Happiness') for (const r of records) if (r[k]) r[k] = r[k].split(' · ')[0]; // drop the old "· #rank of N" suffix
  const vals = records.filter((r) => r[k]).map((r) => num(r[k]));
  for (const r of records) {
    if (!r[k]) continue;
    const v = num(r[k]);
    r[k] = `${r[k]} (#${1 + vals.filter((x) => x > v).length}/${vals.length})`;
  }
}
fs.writeFileSync('data/records.json', JSON.stringify(records, null, 1));
const empty = (k) => records.filter((r) => !r[k]).length;
console.log(records.length, 'records');
for (const k of ['Capital', 'Population', 'GDP', 'GDP per Capita', 'Land Area', 'Density', 'Happiness', 'Languages', 'Currency', 'Government', 'Religion', 'Leader', 'Party', 'Head of State', 'Borders']) console.log(k.padEnd(14), 'empty', empty(k));
