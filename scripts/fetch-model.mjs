/**
 * Puts the hand-tracking model file in public/, so the app serves it itself and
 * needs no connection to start tracking.
 *
 * The file is MediaPipe's Hand Landmarker model (about 8 MB), downloaded once from
 * Google's public model storage: the same address the app would otherwise fetch it
 * from in the browser. It is build output and is not committed (see .gitignore).
 *
 * Runs before `npm run dev` and `npm run build`. It never fails the command it
 * runs before: without the file the app falls back to the browser's cache and
 * then to the network, exactly as before. Set NTACT_SKIP_MODEL=1 to skip it.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(root, 'public', 'mediapipe', 'models');
const target = join(folder, 'hand_landmarker.task');
const strict = process.argv.includes('--strict');

async function main() {
  if (process.env.NTACT_SKIP_MODEL === '1') {
    console.log('fetch-model: skipped (NTACT_SKIP_MODEL=1)');
    return;
  }
  if (existsSync(target) && statSync(target).size > 1_000_000) {
    console.log('fetch-model: up to date');
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1_000_000) throw new Error(`unexpectedly small file (${bytes.length} bytes)`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(target, bytes);
    console.log(`fetch-model: saved ${(bytes.length / 1_048_576).toFixed(1)} MB to public/mediapipe/models`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`fetch-model: could not download the model (${reason}). The app will load it in the browser instead, which needs a connection the first time.`);
    if (strict) process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
}

await main();
