import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const context = { window: {} };
vm.runInNewContext(readFileSync(join(root, 'data.js'), 'utf8'), context);
let count = 0;
for (const deck of context.window.QA_DATA.decks.filter(d => d.videoDir)) {
  const directory = resolve(root, deck.videoDir);
  if (!directory.startsWith(root + '\\') && !directory.startsWith(root + '/')) throw new Error('Invalid video directory');
  mkdirSync(join(directory, 'audio'), { recursive: true });
  for (const q of deck.categories.flatMap(c => c.questions)) {
    const no = String(q.no).padStart(3, '0');
    if (!/^\d+$/.test(no)) throw new Error('Invalid question number');
    const result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', join(directory, `${no}.mp4`), '-vn', '-c:a', 'copy', '-movflags', '+faststart', join(directory, 'audio', `${no}.m4a`)], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.error?.message || result.stderr);
    count++;
  }
}
console.log(`Extracted ${count} listening audio files`);
