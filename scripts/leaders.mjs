// Picks the leader and head of state per country and looks up their party. Primary source is Wikipedia's current-leaders
// list (data/heads-wikipedia.json, from parse-heads.mjs); Wikidata (data/facts-all.json) fills gaps; OVERRIDES covers
// cases both get wrong. Party comes from each person's Wikidata P102 (current, most recent start). Writes data/leaders.json.
import fs from 'node:fs';
const UA = { 'User-Agent': 'StudyDeckBuilder/1.0 (personal flashcard project)' };
const wp = JSON.parse(fs.readFileSync('data/heads-wikipedia.json', 'utf8'));
const wd = JSON.parse(fs.readFileSync('data/facts-all.json', 'utf8'));
const COUNTRIES = JSON.parse(fs.readFileSync('data/countries.json', 'utf8'));

// Hand-checked fixes (flagged in the log for review): leader, leaderTitle (enwiki), head, headTitle.
const OVERRIDES = {
  VEN: { leader: 'Delcy Rodríguez', leaderTitle: 'Delcy Rodríguez', head: '', headTitle: '' },
  SDN: { leader: 'Abdel Fattah al-Burhan', leaderTitle: 'Abdel Fattah al-Burhan', head: 'Kamil Idris', headTitle: 'Kamil Idris' },
  CHE: { leader: 'Guy Parmelin', leaderTitle: 'Guy Parmelin', head: '', headTitle: '' },
  BRN: { leader: 'Hassanal Bolkiah', leaderTitle: 'Hassanal Bolkiah', head: '', headTitle: '' },
  VAT: { leader: 'Leo XIV', leaderTitle: 'Pope Leo XIV', head: '', headTitle: '' },
};
const pick = {};
for (const c of COUNTRIES) {
  const o = OVERRIDES[c.iso], w = wp[c.iso], f = wd[c.iso];
  if (o) pick[c.iso] = { ...o, source: 'override' };
  else if (w) pick[c.iso] = { leader: w.leader, leaderTitle: w.leaderTitle, head: w.head, headTitle: w.headTitle, source: 'wikipedia' };
  else pick[c.iso] = { leader: f.leader, leaderTitle: f.leader, head: (f.head || '').replace(/ \(.*/, ''), headTitle: (f.head || '').replace(/ \(.*/, ''), source: 'wikidata' };
}

// One polite GET: 2.5 s apart, and on 429 wait for retry-after plus a margin.
let lastCall = 0;
const get = async (url) => {
  for (let i = 0; i < 8; i++) {
    const wait = Math.max(0, lastCall + 2500 - Date.now());
    await new Promise((res) => setTimeout(res, wait));
    const r = await fetch(url, { headers: UA });
    lastCall = Date.now();
    if (r.status === 429) { await new Promise((res) => setTimeout(res, (+r.headers.get('retry-after') || 7) * 1000 + 3000)); continue; }
    try { if (r.ok) return JSON.parse(await r.text()); } catch { /* retry */ }
  }
  throw new Error('request failed: ' + url.slice(0, 80));
};
const api = (params) => get('https://www.wikidata.org/w/api.php?format=json&' + new URLSearchParams(params));

const titles = [...new Set(Object.values(pick).flatMap((p) => [p.leaderTitle, p.headTitle]).filter(Boolean))];
const partyOf = {}; // requested title -> party qid
const partyIds = new Set();
const wiki = async (batch) => (await get('https://en.wikipedia.org/w/api.php?format=json&action=query&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=' + encodeURIComponent(batch.join('|')))).query;
const qidOf = {}; // requested title -> person qid
for (let i = 0; i < titles.length; i += 40) {
  const batch = titles.slice(i, i + 40);
  const q = await wiki(batch);
  const hop = {};
  for (const n of q.normalized || []) hop[n.from] = n.to;
  const red = {};
  for (const n of q.redirects || []) red[n.from] = n.to;
  const page = {};
  for (const pg of Object.values(q.pages || {})) page[pg.title] = pg.pageprops?.wikibase_item;
  for (const t of batch) {
    let x = hop[t] || t;
    x = red[x] || x;
    if (page[x]) qidOf[t] = page[x];
  }
}
const people = [...new Set(Object.values(qidOf))];
const partyByPerson = {};
for (let i = 0; i < people.length; i += 40) {
  const j = await api({ action: 'wbgetentities', ids: people.slice(i, i + 40).join('|'), props: 'claims' });
  for (const [id, e] of Object.entries(j.entities || {})) {
    const cur = (e.claims?.P102 || []).filter((c) => c.mainsnak?.datavalue && !c.qualifiers?.P582);
    const score = (c) => (c.rank === 'preferred' ? 'z' : '') + (c.qualifiers?.P580?.[0]?.datavalue?.value?.time || '');
    cur.sort((x, y) => score(y).localeCompare(score(x)));
    if (cur[0]) { partyByPerson[id] = cur[0].mainsnak.datavalue.value.id; partyIds.add(partyByPerson[id]); }
  }
}
for (const t of titles) if (qidOf[t] && partyByPerson[qidOf[t]]) partyOf[t] = partyByPerson[qidOf[t]];
console.log('titles', titles.length, 'resolved', Object.keys(qidOf).length, 'with party', Object.keys(partyOf).length);
const label = {};
const ids = [...partyIds];
for (let i = 0; i < ids.length; i += 40) {
  const j = await api({ action: 'wbgetentities', ids: ids.slice(i, i + 40).join('|'), props: 'labels', languages: 'en' });
  for (const [id, e] of Object.entries(j.entities || {})) label[id] = e.labels?.en?.value || '';
}
const normTitle = (t) => t.replace(/_/g, ' ');
const party = (title) => {
  const q = partyOf[title] || partyOf[normTitle(title)];
  const l = q && label[q];
  return !l ? '' : /^independent/i.test(l) ? 'Independent' : l;
};
// A title may be redirected or disambiguated on Wikipedia, so also try the Wikidata-derived party for the same person.
const wdParty = (iso, name) => (wd[iso].leader === name ? wd[iso].party : '');
const out = {};
for (const c of COUNTRIES) {
  const p = pick[c.iso];
  out[c.iso] = {
    leader: p.leader, party: party(p.leaderTitle) || wdParty(c.iso, p.leader) || '',
    head: p.head, headParty: p.head ? party(p.headTitle) : '', source: p.source,
  };
}
fs.writeFileSync('data/leaders.json', JSON.stringify(out, null, 1));
const noParty = Object.entries(out).filter(([, v]) => !v.party).map(([k]) => k);
console.log('leaders', Object.keys(out).length, '| no party:', noParty.length, noParty.join(' '));
console.log('sources:', JSON.stringify(Object.values(out).reduce((m, v) => ((m[v.source] = (m[v.source] || 0) + 1), m), {})));
