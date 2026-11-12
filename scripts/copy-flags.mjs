// Copies data/flags-svg/<ISO>.svg to build/media/flag-<ISO>.svg so build/media holds every image the notes use.
import fs from 'node:fs';

fs.mkdirSync('build/media', { recursive: true });
let n = 0;
for (const f of fs.readdirSync('data/flags-svg')) {
  if (!f.endsWith('.svg')) continue;
  fs.copyFileSync(`data/flags-svg/${f}`, `build/media/flag-${f}`);
  n++;
}
console.log('copied', n, 'flags to build/media/');
