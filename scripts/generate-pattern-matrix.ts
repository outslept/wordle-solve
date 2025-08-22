import { stat } from "fs/promises";
import { styleText } from "node:util";
import { fileURLToPath } from "url";
import { generatePatternMatrixBin } from "../index.js";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = join(__dirname, "..", "data");
const allowedFile = join(base, "allowed_words.txt");
const answersFile = join(base, "possible_words.txt");
const out = join(base, "pattern_allowed_answers.bin");
const chunkSize = 1200;

const now = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
};

const fmtTime = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);
const fmtBytes = (b: number) =>
  b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(2)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;

try {
  console.log(`${styleText("gray", `[${now()}]`, { stream: process.stdout })} starting`);
  const t0 = process.hrtime.bigint();
  console.log(`${styleText("gray", `[${now()}]`, { stream: process.stdout })} generating...`);
  await generatePatternMatrixBin(allowedFile, answersFile, out, chunkSize);
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const s = await stat(out);
  console.log(
    `${styleText("gray", `[${now()}]`, { stream: process.stdout })} done in ${fmtTime(durationMs)}: ${out} (${fmtBytes(
      s.size
    )})`
  );
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${styleText("gray", `[${now()}]`, { stream: process.stderr })} ${msg}`);
  process.exit(1);
}
