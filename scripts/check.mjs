import { readFileSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);

const requiredFiles = ['index.html', 'style.css', 'app.js', 'data.js'];
const missingFiles = requiredFiles.filter((name) => !existsSync(new URL(name, root)));
if (missingFiles.length) {
  console.error(`Missing required file(s): ${missingFiles.join(', ')}`);
  process.exit(1);
}

const html = readFileSync(new URL('index.html', root), 'utf8');
const requiredMarkup = ['<!doctype html>', 'lang="ja"', 'id="deckSelect"', 'id="studyStage"', 'noindex, nofollow'];
const missingMarkup = requiredMarkup.filter((value) => !html.toLowerCase().includes(value.toLowerCase()));
if (missingMarkup.length) {
  console.error(`Missing required markup: ${missingMarkup.join(', ')}`);
  process.exit(1);
}

try {
  new Function(readFileSync(new URL('app.js', root), 'utf8'));
} catch (error) {
  console.error(`app.js syntax error: ${error.message}`);
  process.exit(1);
}

const dataRaw = readFileSync(new URL('data.js', root), 'utf8');
let data;
try {
  const jsonText = dataRaw
    .replace(/^\/\/.*$/gm, '')
    .trim()
    .replace(/^window\.QA_DATA\s*=\s*/, '')
    .replace(/;\s*$/, '');
  data = JSON.parse(jsonText);
} catch (error) {
  console.error(`data.js is not valid: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(data.decks) || data.decks.length === 0) {
  console.error('data.js must contain at least one deck');
  process.exit(1);
}

let totalQuestions = 0;
for (const deck of data.decks) {
  for (const category of deck.categories) {
    totalQuestions += category.questions.length;
  }

  if (deck.videoDir) {
    const questions = deck.categories.flatMap((category) => category.questions);
    const missingVideos = questions
      .map((question) => `${String(question.no).padStart(3, '0')}.mp4`)
      .filter((name) => !existsSync(new URL(`${deck.videoDir}/${name}`, root)));
    if (missingVideos.length) {
      console.error(`${deck.id} is missing video(s): ${missingVideos.join(', ')}`);
      process.exit(1);
    }
  }
}

console.log(`OK: ${data.decks.length} deck(s), ${totalQuestions} question(s) total`);
for (const deck of data.decks) {
  const count = deck.categories.reduce((sum, cat) => sum + cat.questions.length, 0);
  console.log(`  - ${deck.id}: ${deck.label} (${count} questions)`);
}
