import { join } from "node:path";
import { existsSync } from "node:fs";
import { PatternMatrix, readWordList } from "../index.js";

export let pm: PatternMatrix | null = null;
export let allowedWords: string[] = [];
export let answerWords: string[] = [];
let inited = false;

export async function ensureInited(): Promise<void> {
  if (inited) return;
  const dataDir = join(process.cwd(), "data");
  const ALLOWED_FILE = join(dataDir, "allowed_words.txt");
  const ANSWERS_FILE = join(dataDir, "possible_words.txt");
  const PATTERN_BIN = join(dataDir, "pattern_allowed_answers.bin");

  // @ts-ignore
  allowedWords = readWordList(ALLOWED_FILE);
  // @ts-ignore
  answerWords = readWordList(ANSWERS_FILE);

  if (existsSync(PATTERN_BIN)) {
    try {
      pm = await PatternMatrix.loadFromBin(PATTERN_BIN, ALLOWED_FILE, ANSWERS_FILE);
      console.log("pattern matrix loaded");
    } catch (err) {
      console.warn("failed to load pattern matrix:", err);
      pm = null;
    }
  }
  inited = true;
}

export function readBody(req: any, maxSize = 1e6): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: any) => {
      body += chunk;
      if (body.length > maxSize) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", (err: any) => reject(err));
  });
}
