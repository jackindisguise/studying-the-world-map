// Turns an IPA transcription of a (US) English name into a plain-English respelling, e.g. /kroʊˈeɪʃə/ -> "kroh-AY-shuh".
// One fixed key is used for every country (below), syllables are separated by hyphens, and the syllable with the primary
// stress is in capitals (in a one-syllable name only when it is one word of several).
//
// Key (what each respelling letter group stands for):
//   a cat   ah father   air care   ar start   aw thought   ay face   e bed   ee see   eer near   er nurse   eye price
//   i kit   oh goat     oo goose   oor poor   or north     ow mouth   oy choice  uh strut/the   uu foot
//   ch j sh zh th (thin) dh (this) ng y (yes) kh (loch); every other letter is itself.
import fs from 'node:fs';

const VOWELS = [
  ['ɛəɹ', 'air'], ['ɛə', 'air'], ['ɑːɹ', 'ar'], ['ɑɹ', 'ar'], ['ɛɹ', 'air'], ['eəɹ', 'air'], ['ɪɹ', 'eer'], ['ɪəɹ', 'eer'], ['iːɹ', 'eer'], ['ɔːɹ', 'or'], ['ɔɹ', 'or'], ['oʊɹ', 'or'], ['ʊɹ', 'oor'], ['ʊəɹ', 'oor'], ['ɜːɹ', 'er'], ['ɜɹ', 'er'],
  ['eɪ', 'ay'], ['aɪ', 'eye'], ['ɔɪ', 'oy'], ['aʊ', 'ow'], ['oʊ', 'oh'], ['əʊ', 'oh'],
  ['iː', 'ee'], ['uː', 'oo'], ['ɑː', 'ah'], ['ɔː', 'aw'], ['ɜː', 'er'], ['ɝ', 'er'], ['ɚ', 'er'],
  ['i', 'ee'], ['u', 'oo'], ['ɪ', 'i'], ['ʊ', 'uu'], ['ɛ', 'e'], ['e', 'e'], ['æ', 'a'], ['ɑ', 'ah'], ['ɒ', 'ah'], ['ɔ', 'aw'], ['ʌ', 'uh'], ['ə', 'uh'], ['ɐ', 'uh'], ['ɨ', 'i'], ['ʉ', 'oo'], ['ɵ', 'uh'], ['o', 'oh'], ['a', 'ah'],
];
const CONSONANTS = [
  ['tʃ', 'ch'], ['dʒ', 'j'], ['ʃ', 'sh'], ['ʒ', 'zh'], ['θ', 'th'], ['ð', 'dh'], ['ŋ', 'ng'], ['j', 'y'], ['ɹ', 'r'], ['r', 'r'], ['ɡ', 'g'], ['g', 'g'], ['x', 'kh'], ['ɾ', 'd'], ['ɫ', 'l'], ['ʔ', ''], ['ʍ', 'w'], ['ɲ', 'ny'],
  ...[...'pbtdkfvszmnlwh'].map((c) => [c, c]),
];
const LAX = new Set(['ɪ', 'ʊ', 'ɛ', 'e', 'æ', 'ʌ', 'ɒ', 'ə']);
const SYL_ONSET_FIRST = new Set(['p', 'b', 't', 'd', 'k', 'ɡ', 'g', 'f', 'θ', 'ʃ', 'v']);
const onsetOk = (c) => {
  if (c.length === 1) return c[0] !== 'ŋ';
  if (c.length === 2) {
    const [a, b] = c;
    if (SYL_ONSET_FIRST.has(a) && ['l', 'ɹ', 'r', 'w'].includes(b)) return !(['t', 'd', 'θ', 'ʃ'].includes(a) && b === 'l');
    if (a === 's' && ['p', 't', 'k', 'm', 'n', 'f', 'l', 'w'].includes(b)) return true;
    return b === 'j' && ['p', 'b', 't', 'd', 'k', 'ɡ', 'g', 'f', 'v', 'm', 'h'].includes(a);
  }
  return c.length === 3 && c[0] === 's' && ['p', 't', 'k'].includes(c[1]) && ['l', 'ɹ', 'r', 'w'].includes(c[2]);
};

// IPA word -> tokens { v: bool, ipa, out } plus stress and boundary markers.
function tokenize(word) {
  // Optional sounds in brackets are left out, except an optional "j" (Uganda, Kuwait), which is kept.
  const s = word.replace(/\(j\)/g, 'j').replace(/\((?!ˈ)[^)]*\)/g, '').replace(/[/\[\]()]/g, '').replace(/͡/g, '').replace(/ː{2,}/g, 'ː');
  const toks = [];
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === 'ˈ' || ch === 'ˌ' || ch === '.') { toks.push({ mark: ch }); i++; continue; }
    if (/[̀-ͯʰʲʷˠ]/.test(ch)) { i++; continue; } // diacritics and modifier letters
    let hit = null;
    for (const [ipa, out] of VOWELS) if (s.startsWith(ipa, i) && (!ipa.endsWith('ɹ') || ipa === 'ɛəɹ' || !/[aeiouəɪʊɛæɑɔʌɒ]/.test(s[i + ipa.length] || ''))) { hit = { v: true, ipa, out }; break; }
    if (!hit) for (const [ipa, out] of CONSONANTS) if (s.startsWith(ipa, i)) { hit = { v: false, ipa, out }; break; }
    if (!hit) throw new Error(`respell: unknown IPA symbol "${ch}" in ${word}`);
    i += hit.ipa.length;
    // A syllabic consonant (n̩, l̩) is a schwa plus the consonant.
    if (s[i] === '̩') { toks.push({ v: true, ipa: 'ə', out: 'uh' }); }
    toks.push(hit);
  }
  return toks;
}

function respellWord(word, multiWord) {
  const toks = tokenize(word);
  // Group into syllables: split at marks, then at vowels using the maximal-onset rule.
  const syl = []; // { onset: [], nucleus, coda: [], stress }
  let pending = [], stress = '', cur = null, forced = false;
  for (const t of toks) {
    if (t.mark) { if (t.mark === '.') forced = true; else { stress = t.mark; forced = true; } continue; }
    if (!t.v) { pending.push(t); continue; }
    // pending consonants sit between the previous nucleus and this one
    if (!cur) { cur = { onset: pending, nucleus: t, coda: [], stress }; }
    else {
      let coda = [], onset = pending;
      if (!forced || stress === '') {
        // split pending: the longest valid onset goes to this syllable, the rest ends the previous one
        let k = 0;
        while (k < pending.length && !onsetOk(pending.slice(k).map((x) => x.ipa))) k++;
        // a single consonant after a stressed lax vowel stays with it ("KEN-yuh", "SEN-uh-gawl")
        if (pending.length >= 1 && LAX.has(cur.nucleus.ipa) && cur.stress === 'ˈ' && stress === '') k = Math.max(k, 1);
        coda = pending.slice(0, k); onset = pending.slice(k);
      } else {
        // explicit boundary or stress mark: consonants before the mark close the previous syllable only if they cannot start this one
        let k = 0;
        while (k < pending.length && !onsetOk(pending.slice(k).map((x) => x.ipa))) k++;
        if (pending.length >= 1 && LAX.has(cur.nucleus.ipa) && cur.stress === 'ˈ' && stress === '') k = Math.max(k, 1);
        coda = pending.slice(0, k); onset = pending.slice(k);
      }
      cur.coda = coda;
      syl.push(cur);
      cur = { onset, nucleus: t, coda: [], stress };
    }
    pending = []; stress = ''; forced = false;
  }
  if (!cur) return toks.map((t) => t.out || '').join('');
  cur.coda = pending;
  syl.push(cur);
  const caps = syl.length > 1 || multiWord;
  return syl.map((s, idx) => {
    // An r closing a syllable before a vowel is doubled ("ERR-uhb", not "ER-uhb", which would read as the vowel in "nurse").
    const coda = s.coda.map((t, k) => (k === s.coda.length - 1 && t.out === 'r' && syl[idx + 1] && !syl[idx + 1].onset.length ? { out: 'rr' } : t));
    const text = [...s.onset, s.nucleus, ...coda].map((t) => t.out).join('');
    return s.stress === 'ˈ' && caps ? text.toUpperCase() : text;
  }).join('-');
}

export function respell(ipa) {
  const words = ipa.replace(/^\/|\/$/g, '').trim().split(/\s+/);
  // The little words in names ("Antigua and Barbuda", "Republic of the Congo") are written as the plain English words.
  const PLAIN = { ænd: 'and', ənd: 'and', ən: 'and', əv: 'of', ʌv: 'of', ɒv: 'of', ðə: 'the', ði: 'the' };
  return words.map((w) => PLAIN[w.replace(/[ˈˌ.()]/g, '')] || respellWord(w, words.length > 1)).join(' ');
}

if (process.argv[1] && process.argv[1].endsWith('respell.js')) {
  for (const ipa of process.argv.slice(2).length ? process.argv.slice(2) : ['/kroʊˈeɪʃə/', '/ˈkɛnjə/', '/ɑːɹdʒənˈtiːnə/', '/æfˈɡænɪstæn/', '/ˌsɛnt ˈkɪts ənd ˈniːvɪs/', '/ˈtʃæd/', '/ˌbɑːstəˈniə/']) console.log(ipa.padEnd(30), respell(ipa));
}
