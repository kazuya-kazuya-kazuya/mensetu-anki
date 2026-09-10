import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import vm from 'node:vm';

const ROOT = resolve(import.meta.dirname, '..');
const DECK_ID = process.argv[2] || 'accenture-2ji';
if (!/^[a-zA-Z0-9_-]+$/.test(DECK_ID)) throw new Error('Invalid deck ID');
const SPEAKER_ID = 13; // 青山龍星・ノーマル
const VOICEVOX = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
const THINK_SECONDS = 3;

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'data.js'), 'utf8'), sandbox);
const deck = sandbox.window.QA_DATA.decks.find((item) => item.id === DECK_ID);
if (!deck) throw new Error(`Deck not found: ${DECK_ID}`);

const questions = deck.categories.flatMap((category) => category.questions);
const requestedNumbers = process.argv.slice(3);
if (requestedNumbers.some(no => !questions.some(q => String(q.no) === no))) throw new Error('Unknown question number');
const outputDir = join(ROOT, 'videos', DECK_ID);
const workDir = join(ROOT, '.voicevox-build', DECK_ID);
mkdirSync(outputDir, { recursive: true });
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
}

async function speak(text, destination) {
  const params = new URLSearchParams({ text, speaker: String(SPEAKER_ID) });
  const queryResponse = await fetch(`${VOICEVOX}/audio_query?${params}`, { method: 'POST' });
  if (!queryResponse.ok) throw new Error(`audio_query failed: ${queryResponse.status}`);
  const query = await queryResponse.json();
  query.speedScale = 0.96;
  query.prePhonemeLength = 0.18;
  query.postPhonemeLength = 0.25;
  const audioResponse = await fetch(`${VOICEVOX}/synthesis?speaker=${SPEAKER_ID}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query)
  });
  if (!audioResponse.ok) throw new Error(`synthesis failed: ${audioResponse.status}`);
  writeFileSync(destination, Buffer.from(await audioResponse.arrayBuffer()));
}

function duration(path) {
  return Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]).trim());
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

function wrapJapanese(value, width) {
  const clean = value.replace(/\r/g, '').replace(/^・/gm, '').trim();
  const result = [];
  for (const paragraph of clean.split(/\n+/)) {
    for (let i = 0; i < paragraph.length; i += width) result.push(paragraph.slice(i, i + width));
  }
  return result.join('\\N').replace(/[{}]/g, '');
}

function assDocument(question, answer, number, questionEnd, totalEnd) {
  const answerSize = answer.length > 300 ? 30 : answer.length > 190 ? 35 : 42;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Header,Yu Gothic UI,24,&H00A9C3FF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,7,58,58,38,1
Style: Question,Yu Gothic UI,48,&H00FFFFFF,&H000000FF,&H00101622,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,5,74,74,85,1
Style: Answer,Yu Gothic UI,${answerSize},&H00F5F7FA,&H000000FF,&H00101622,&H00000000,0,0,0,0,100,100,0,0,1,2,0,5,74,74,82,1
Style: Prompt,Yu Gothic UI,22,&H00899AAC,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,1,0,1,0,0,2,50,50,35,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${assTime(totalEnd)},Header,,0,0,0,,ACCENTURE / SECOND INTERVIEW     Q${number} / ${questions.length}
Dialogue: 0,0:00:00.00,${assTime(questionEnd)},Question,,0,0,0,,${wrapJapanese(question, 28)}
Dialogue: 0,${assTime(Math.max(0, questionEnd - THINK_SECONDS))},${assTime(questionEnd)},Prompt,,0,0,0,,考えてから、回答例を聞きます
Dialogue: 0,${assTime(questionEnd)},${assTime(totalEnd)},Answer,,0,0,0,,${wrapJapanese(answer, answerSize <= 30 ? 40 : 34)}
Dialogue: 0,${assTime(questionEnd)},${assTime(totalEnd)},Prompt,,0,0,0,,回答例 · 声に出して繰り返しましょう
`;
}

try {
  const health = await fetch(`${VOICEVOX}/version`);
  if (!health.ok) throw new Error('VOICEVOX Engine is not available');

  for (let index = 0; index < questions.length; index += 1) {
    const item = questions[index];
    if (requestedNumbers.length && !requestedNumbers.includes(String(item.no))) continue;
    const answerText = item.point ? `${item.answer}\n\n補足：\n${item.point}` : item.answer;
    const no = String(item.no || index + 1).padStart(3, '0');
    const questionWav = join(workDir, `${no}-question.wav`);
    const answerWav = join(workDir, `${no}-answer.wav`);
    const assPath = join(workDir, `${no}.ass`);
    const outputPath = join(outputDir, `${no}.mp4`);
    process.stdout.write(`[${index + 1}/${questions.length}] Q${item.no} 音声生成... `);
    await speak(`質問です。${item.question}`, questionWav);
    await speak(`回答例です。${answerText}`, answerWav);
    const questionDuration = duration(questionWav);
    const answerDuration = duration(answerWav);
    const answerStart = questionDuration + THINK_SECONDS;
    const total = answerStart + answerDuration;
    writeFileSync(assPath, assDocument(item.question, answerText, item.no, answerStart, total), 'utf8');

    run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0x0d1422:s=1280x720:r=25',
      '-i', questionWav,
      '-f', 'lavfi', '-t', String(THINK_SECONDS), '-i', 'anullsrc=r=24000:cl=mono',
      '-i', answerWav,
      '-filter_complex', '[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]',
      '-vf', `ass=.voicevox-build/${DECK_ID}/${no}.ass`,
      '-map', '0:v', '-map', '[a]', '-shortest',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outputPath
    ]);
    console.log(`${(existsSync(outputPath) ? '完了' : '失敗')} (${total.toFixed(1)}秒)`);
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`Generated ${requestedNumbers.length || questions.length} videos with VOICEVOX speaker ${SPEAKER_ID}: ${outputDir}`);
