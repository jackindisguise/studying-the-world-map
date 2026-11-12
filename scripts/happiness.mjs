// Happiness index per ISO3 from data/raw/happiness/ladder.csv (Our World in Data export of the World Happiness Report's
// Cantril ladder, latest year). Exports happiness(iso) -> { score, rank, of, year, text } or null.
import fs from 'node:fs';
const rows = fs.readFileSync(new URL('../data/raw/happiness/ladder.csv', import.meta.url), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const year = Math.max(...rows.map((r) => +r[2]));
const latest = rows.filter((r) => +r[2] === year && r[1]).sort((a, b) => b[3] - a[3]);
const table = Object.fromEntries(latest.map((r, i) => [r[1], { score: +r[3], rank: i + 1, of: latest.length, year }]));
export const happiness = (iso) => {
  const h = table[iso];
  return h ? { ...h, text: `${h.score.toFixed(2)} / 10 · #${h.rank} of ${h.of}` } : null;
};
