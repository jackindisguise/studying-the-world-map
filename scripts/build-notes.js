// Writes one Anki-importable CSV note file with a row per country to build/notes.csv.
// Fields follow the Country Map note type; Map and Flag hold <img> tags that use the real file names.
// Usage: node scripts/build-notes.js
import fs from 'node:fs';

const DECK = 'Studying the World Map', MODEL = 'Country Map', TAG = 'world-map';
const ORDER = ['North America', 'South America', 'Europe', 'Africa', 'Central America', 'Caribbean', 'Asia', 'Oceania'];
const FIELDS = ['Name', 'Map', 'Flag', 'Capital', 'Region', 'Population', 'GDP', 'GDP per Capita', 'Land Area', 'Density', 'Happiness', 'Leader', 'Party', 'As Of', 'ISO', 'Languages', 'Currency', 'Government', 'Religion', 'Borders', 'Head of State'];

// Most populous first (Population is formatted text like '43,844,111'); Anki shows new cards in this order.
const pop = (r) => Number((r.Population || '').split(' (')[0].replace(/\D/g, '')) || 0;
const records = JSON.parse(fs.readFileSync('data/records.json', 'utf8')).sort((a, b) => pop(b) - pop(a) || a.Name.localeCompare(b.Name));
const boxes = fs.existsSync('build/fit/boxes.json') ? JSON.parse(fs.readFileSync('build/fit/boxes.json', 'utf8')) : {};
const csv = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const header = [
  '#separator:Comma', '#html:true', `#notetype:${MODEL}`,
  `#columns:${[...FIELDS, 'Deck', 'Tags'].join(',')}`,
  `#deck column:${FIELDS.length + 1}`, `#tags column:${FIELDS.length + 2}`,
];
const rows = [];
for (const r of records) {
  const box = boxes[r.ISO];
  const f = {
    ...r,
    // The img names are the real files: maps in build/media/map-ISO.svg, flags in build/media/flag-ISO.svg (copied by copy-flags.js).
    Map: box ? `<img src="map-${r.ISO}.svg" data-box="${box.join(',')}">` : `<img src="map-${r.ISO}.svg">`,
    Flag: `<img src="flag-${r.ISO}.svg">`,
  };
  const deck = `${DECK}::${String(ORDER.indexOf(r.Region) + 1).padStart(2, '0')}. ${r.Region}`;
  const row = [...FIELDS.map((k) => f[k] || ''), deck, TAG];
  rows.push(row.map(csv).join(','));
}
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/notes.csv', [...header, ...rows].join('\n') + '\n');
console.log('wrote', rows.length, 'notes to build/notes.csv');
