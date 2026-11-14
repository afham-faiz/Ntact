/**
 * Copies the MediaPipe WebAssembly runtime out of node_modules into public/, so the
 * app serves it itself instead of depending on a third-party CDN during a demo.
 *
 * Runs automatically before `npm run dev` and `npm run build`. The copies are
 * build output and are not committed (see .gitignore).
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(from)) {
  console.error('copy-mediapipe: @mediapipe/tasks-vision is not installed. Run `npm install` first.');
  process.exit(1);
}

mkdirSync(to, { recursive: true });
let copied = 0;
for (const name of readdirSync(from)) {
  const source = join(from, name);
  const target = join(to, name);
  // Skip files that are already there and the same size: these are 14 MB each.
  if (existsSync(target) && statSync(target).size === statSync(source).size) continue;
  cpSync(source, target);
  copied += 1;
}
console.log(copied > 0 ? `copy-mediapipe: copied ${copied} file(s) to public/mediapipe/wasm` : 'copy-mediapipe: up to date');
