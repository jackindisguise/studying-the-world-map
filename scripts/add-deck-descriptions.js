// Sets deck descriptions inside an existing .apkg, so it can be tested without rebuilding the deck.
// anki-apkg-export always writes empty descriptions, so this opens the package (a zip holding a SQLite
// collection), fills in each deck's `desc` from data/deck-descriptions.json plus the version tag (v<version>
// from package.json), turns on the decks' "Markdown" description option (md: true) and writes it back.
// Descriptions are Markdown.
// Usage: node scripts/add-deck-descriptions.js [input.apkg] [output.apkg]
// Defaults: input build/studying-the-world-map-<version>.apkg, output = the input (updated in place).
import fs from 'node:fs';
import JSZip from 'jszip';
import initSqlJs from 'sql.js';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const input = process.argv[2] || `build/studying-the-world-map-${version}.apkg`;
const output = process.argv[3] || input;
const descriptions = JSON.parse(fs.readFileSync('data/deck-descriptions.json', 'utf8'));

const zip = await JSZip.loadAsync(fs.readFileSync(input));
const SQL = await initSqlJs();
const db = new SQL.Database(await zip.file('collection.anki2').async('uint8array'));
try {
  const decks = JSON.parse(db.exec('select decks from col')[0].values[0][0]);
  const byName = Object.values(decks).filter((d) => d.name in descriptions);
  // The description is rebuilt each run, so running this twice does not stack the version line.
  for (const d of byName) {
    d.desc = `${descriptions[d.name]}\n\nv${version}`;
    d.md = true;
  }
  const unmatched = Object.keys(descriptions).filter((n) => !byName.some((d) => d.name === n));
  if (unmatched.length) console.warn('No deck named:', unmatched.join(' | '));
  db.run('update col set decks = ?', [JSON.stringify(decks)]);
  zip.file('collection.anki2', db.export());
} finally {
  db.close();
}
fs.writeFileSync(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`wrote ${output}: described ${Object.keys(descriptions).length} decks`);
