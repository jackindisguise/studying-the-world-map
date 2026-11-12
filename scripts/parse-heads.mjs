// Parses Wikipedia's "List of current heads of state and government" (data/raw/wikipedia/heads.json) into
// data/heads-wikipedia.json: { ISO3: { leader, head } } where leader = the highlighted chief executive.
import fs from 'node:fs';
const t = JSON.parse(fs.readFileSync('data/raw/wikipedia/heads.json', 'utf8')).parse.wikitext;
const COUNTRIES = JSON.parse(fs.readFileSync('data/countries.json', 'utf8'));
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
const ALIAS = { czechrepublic: 'CZE', ivorycoast: 'CIV', cotedivoire: 'CIV', drcongo: 'COD', democraticrepublicofthecongo: 'COD', republicofthecongo: 'COG', congo: 'COG', thegambia: 'GMB', gambia: 'GMB', thebahamas: 'BHS', bahamas: 'BHS', capeverde: 'CPV', caboverde: 'CPV', eswatini: 'SWZ', swaziland: 'SWZ', eastimor: 'TLS', timorleste: 'TLS', burma: 'MMR', myanmar: 'MMR', turkey: 'TUR', turkiye: 'TUR', micronesia: 'FSM', federatedstatesofmicronesia: 'FSM', vaticancity: 'VAT', holysee: 'VAT', palestine: 'PSE', stateofpalestine: 'PSE', unitedstates: 'USA', unitedkingdom: 'GBR', netherlands: 'NLD', northmacedonia: 'MKD', china: 'CHN', peoplesrepublicofchina: 'CHN', southkorea: 'KOR', northkorea: 'PRK', saintkittsandnevis: 'KNA', saintlucia: 'LCA', saintvincentandthegrenadines: 'VCT', saotomeandprincipe: 'STP' };
const byName = new Map(COUNTRIES.map((c) => [norm(c.name), c.iso]));
const isoOf = (name) => ALIAS[norm(name)] || byName.get(norm(name));

const link = (s) => s.replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1');
const blocks = t.split(/\n\|-[^\n]*\n(?=!scope="row")/).slice(1);
const out = {}, unmatched = [];
for (const b of blocks) {
  const m = b.match(/\{\{flag\|([^}|]+)/i);
  if (!m) continue;
  const iso = isoOf(m[1].trim());
  if (!iso) { unmatched.push(m[1]); continue; }
  const items = [];
  const re = /(\{\{success[^\n]*?)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*[–-]\s*\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let mm;
  while ((mm = re.exec(b))) {
    const before = b.slice(Math.max(0, mm.index - 80), mm.index);
    const isSuccess = !!mm[1] || /\{\{success[^\n]*$/.test(before);
    if (/Governor|Regent|Representative|Co-Prince|Lord|Viceroy/i.test(mm[2] + (mm[3] || '')) && !/President|Prime/.test(mm[2] + (mm[3] || ''))) continue;
    items.push({ role: (mm[3] || mm[2]).trim(), person: (mm[5] || mm[4]).trim(), title: mm[4].trim(), success: isSuccess });
  }
  if (!items.length) continue;
  const lead = items.find((i) => i.success) || items.find((i) => /Prime Minister|Chancellor|Premier|Taoiseach|Chairman of the Council/i.test(i.role)) || items[0];
  const other = items.find((i) => i.person !== lead.person);
  (out[iso] ||= []).push({ leader: lead.person, leaderTitle: lead.title, leaderRole: lead.role, head: other ? other.person : '', headTitle: other ? other.title : '', headRole: other ? other.role : '' });
}
const final = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v[0]]));
fs.writeFileSync('data/heads-wikipedia.json', JSON.stringify(final, null, 1));
console.log('parsed', Object.keys(final).length, 'of', COUNTRIES.length);
console.log('unmatched names:', unmatched.join(', '));
console.log('missing ISO:', COUNTRIES.filter((c) => !final[c.iso]).map((c) => c.iso).join(' '));
for (const i of ['GHA', 'GUY', 'MEX', 'ZMB', 'SDN', 'PSE', 'SWZ', 'CHE', 'GBR', 'USA', 'CHN', 'RUS', 'JPN', 'AUS', 'SLE']) console.log(i, JSON.stringify(final[i]));
