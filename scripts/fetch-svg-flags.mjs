// Downloads the original Commons flag file (SVG where one exists) to data/flags-svg/<Key>.<ext>.
import fs from 'node:fs';
const UA = { 'User-Agent': 'StudyDeckBuilder/1.0 (personal flashcard project)' };
const records = JSON.parse(fs.readFileSync('data/records.json', 'utf8'));
fs.mkdirSync('data/flags-svg', { recursive: true });
const kinds = {}, failed = [];
for (const r of records.filter((x) => x._flag)) {
  const url = r._flag.replace('http://', 'https://');
  let ok = false;
  for (let i = 0; i < 6 && !ok; i++) {
    const res = await fetch(url, { headers: UA, redirect: 'follow' });
    if (res.status === 429) { await new Promise((x) => setTimeout(x, ((+res.headers.get('retry-after') || 5) + 2) * 1000)); continue; }
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('image')) { await new Promise((x) => setTimeout(x, 1500)); continue; }
    const ext = ct.includes('svg') ? 'svg' : ct.split('/')[1].split(';')[0];
    fs.writeFileSync(`data/flags-svg/${r.ISO}.${ext}`, Buffer.from(await res.arrayBuffer()));
    kinds[ext] = (kinds[ext] || 0) + 1; ok = true;
  }
  if (!ok) failed.push(r.ISO);
  await new Promise((x) => setTimeout(x, 300));
}
console.log(kinds, 'failed', failed.join(' ') || 'none');
