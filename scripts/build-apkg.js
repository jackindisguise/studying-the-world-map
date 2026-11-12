// Builds the Anki package (.apkg) from build/notes.csv, build/media/ and templates/.
// Run `npm run build` first: it writes build/notes.csv and the map and flag images.
// Usage: node scripts/build-apkg.js [output.apkg]
// Default output: build/studying-the-world-map-<version from package.json>.apkg
import fs from 'node:fs';
import path from 'node:path';
import AnkiExport from 'anki-apkg-export';

const ROOT_DECK = 'Studying the World Map';
const MODEL = 'Country Map';
const MODEL_ID = 1607392319; // fixed so a newer package updates the same note type on import
const CARDS = [
  { name: 'Locate', folder: 'locate', requiredFields: ['Map'] },
  { name: 'Flag to Country', folder: 'flag-to-country', requiredFields: ['Flag'] },
];

// Parses build/notes.csv: skips the "#" header lines (keeping #columns) and handles quoted fields.
const parseNotes = (text) => {
  let columns = null;
  const body = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) {
      if (line.startsWith('#columns:')) columns = line.slice('#columns:'.length).split(',');
    } else body.push(line);
  }
  const rows = [];
  let row = [], field = '', quoted = false;
  const csv = body.join('\n');
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted) {
      if (c === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; if (row.length > 1) rows.push(row); row = []; }
    else field += c;
  }
  if (field || row.length) { row.push(field); if (row.length > 1) rows.push(row); }
  return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? '']))) };
};

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const out = process.argv[2] || `build/studying-the-world-map-${version}.apkg`;
const { columns, rows } = parseNotes(fs.readFileSync('build/notes.csv', 'utf8'));
const fields = columns.filter((c) => c !== 'Deck' && c !== 'Tags');

// The custom model is passed as the exporter's default, so the package holds no unused Basic note type.
const model = {
  id: MODEL_ID,
  name: MODEL,
  fields,
  sortField: 'Name',
  css: fs.readFileSync('templates/locate/style.css', 'utf8'),
  templates: CARDS.map((c) => ({
    name: c.name,
    questionFormat: fs.readFileSync(`templates/${c.folder}/front.html`, 'utf8'),
    answerFormat: fs.readFileSync(`templates/${c.folder}/back.html`, 'utf8'),
    requiredFields: c.requiredFields,
  })),
};

const apkg = await AnkiExport.create(ROOT_DECK, { model });
try {
  const media = new Set();
  for (const r of rows) {
    apkg.addNote(Object.fromEntries(fields.map((f) => [f, r[f]])), { noteId: r.ISO, tags: r.Tags.split(' ').filter(Boolean), deck: r.Deck });
    for (const m of (r.Map + r.Flag).matchAll(/src="([^"]+)"/g)) media.add(m[1]);
  }
  const missing = [...media].filter((m) => !fs.existsSync(`build/media/${m}`));
  if (missing.length) throw new Error(`Missing ${missing.length} media files in build/media (run npm run build): ${missing.slice(0, 5).join(', ')}`);
  for (const m of [...media].sort()) apkg.addMedia(m, fs.readFileSync(`build/media/${m}`));

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const data = await apkg.save({ type: 'nodebuffer' });
  fs.writeFileSync(out, data);
  console.log(`wrote ${out}: ${rows.length} notes, ${new Set(rows.map((r) => r.Deck)).size} decks, ${media.size} media files, ${(data.length / 1e6).toFixed(1)} MB`);
} finally {
  apkg.close();
}
