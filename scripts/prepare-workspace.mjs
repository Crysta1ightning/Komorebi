import { mkdir, writeFile } from 'node:fs/promises';

// Generated lessons stay local. A new clone starts with the flashcard app and
// no videos; importing a video later replaces these files through the pipeline.
await mkdir('src/data', { recursive: true });
const files = {
  'active-video.js': 'export const video = { id: null };\n',
  'active-video.json': JSON.stringify({ id: null }),
  'video-collection.js': 'export const videos = [];\n',
  'video-collection.json': '[]\n',
  'vocabulary.json': JSON.stringify({ cues: [], entries: {}, transcriptTexts: [] }),
};
for (const [name, text] of Object.entries(files)) {
  try { await writeFile(`src/data/${name}`, text, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
