// Largest religious groups per country from the Pew 2020 table on Wikipedia's "Religions by country"
// (data/raw/wikipedia/religions.json). Writes data/religion.json: { ISO3: "Islam (97%)" }; a second group is added when it has 25%+.
import fs from 'node:fs';
const t = JSON.parse(fs.readFileSync('data/raw/wikipedia/religions.json', 'utf8')).parse.wikitext;
const COUNTRIES = JSON.parse(fs.readFileSync('data/countries.json', 'utf8'));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const byName = new Map(COUNTRIES.map((c) => [norm(c.name), c.iso]));
const ALIAS = { czechrepublic: 'CZE', ivorycoast: 'CIV', cotedivoire: 'CIV', drcongo: 'COD', democraticrepublicofthecongo: 'COD', republicofthecongo: 'COG', congo: 'COG', gambia: 'GMB', bahamas: 'BHS', capeverde: 'CPV', caboverde: 'CPV', eswatini: 'SWZ', eastimor: 'TLS', timorleste: 'TLS', burma: 'MMR', turkey: 'TUR', turkiye: 'TUR', micronesia: 'FSM', palestinianterritories: 'PSE', palestine: 'PSE', stateofpalestine: 'PSE', unitedstates: 'USA', unitedkingdom: 'GBR', netherlands: 'NLD', northmacedonia: 'MKD', china: 'CHN', southkorea: 'KOR', northkorea: 'PRK', saintkittsandnevis: 'KNA', saintlucia: 'LCA', saintvincentandthegrenadines: 'VCT', saotomeandprincipe: 'STP', kosovo: 'XKX', taiwan: 'TWN' };
const GROUPS = ['Christianity', 'Islam', 'No religion', 'Hinduism', 'Buddhism', 'Folk and other religions', 'Judaism'];
const start = t.indexOf('!Country');
const rows = t.slice(start).split(/\n\|-\n/).slice(1);
const out = {}, unmatched = [];
for (const r of rows) {
  const cells = r.split('\n').filter((l) => l.startsWith('|')).map((l) => l.slice(1).trim());
  if (cells.length < 9) continue;
  const m = cells[0].match(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/);
  const name = m ? m[1] : cells[0];
  const iso = ALIAS[norm(name)] || byName.get(norm(name));
  if (!iso) { unmatched.push(name); continue; }
  const v = cells.slice(1, 8).map((x) => (x.startsWith('<') ? 5000 : +x.replace(/,/g, '') || 0));
  const total = +cells[8].replace(/,/g, '') || v.reduce((a, b) => a + b, 0);
  const ranked = v.map((n, i) => ({ g: GROUPS[i], p: (n / total) * 100 })).sort((a, b) => b.p - a.p);
  const parts = [ranked[0], ...(ranked[1].p >= 25 ? [ranked[1]] : [])].map((x) => `${x.g} (${Math.round(x.p)}%)`);
  out[iso] = parts.join(', ');
}
out.VAT = 'Christianity (Catholic)';
fs.writeFileSync('data/religion.json', JSON.stringify(out, null, 1));
console.log('matched', Object.keys(out).length, 'missing:', COUNTRIES.filter((c) => !out[c.iso]).map((c) => c.iso).join(' '));
for (const i of ['NGA', 'IND', 'CHN', 'USA', 'SAU', 'THA', 'DEU']) console.log(i, out[i]);
