/**
  each position: MISS=0, MISPLACED=1, EXACT=2

  pos:      0   1   2   3   4
  digit:   d0  d1  d2  d3  d4
  code = d0*1 + d1*3 + d2*9 + d3*27 + d4*81
*/

import { readFileSync } from "fs";
import { mkdir, open, readFile, stat } from "fs/promises";
import { dirname } from "path";
import {
  WORD_LEN,
  PATTERN_COUNT,
  MISS,
  MISPLACED,
  EXACT,
  isWord,
  assertDefined,
  type WordList,
  type WordCodes
} from "./types.js";

/// POW3[i] = 3^i, used for base-3 conversion.
const POW3 = new Int32Array(WORD_LEN);
for (let i = 0, p = 1; i < WORD_LEN; i++, p *= 3) POW3[i] = p;

/// read a newline-separated word list from file.
export function readWordList(filePath: string): WordList {
  const txt = readFileSync(filePath, "utf8");
  const arr = txt.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(isWord);
  return arr;
}

/// convert pattern digits array -> base-3
export function patternArrayToInt(arr: readonly number[]): number {
  if (arr.length !== WORD_LEN) throw new RangeError(`pattern array must have length ${WORD_LEN}`);
  let v = 0;
  for (let i = 0; i < WORD_LEN; i++) {
    const d = arr[i];
    if (d === undefined || !Number.isInteger(d) || d < 0 || d > 2) throw new RangeError("pattern digits must be integers 0..2");
    v += d * POW3[i]!;
  }
  return v;
}

/// opposite of patternArrayToInt()
export function patternIntToArray(v: number): number[] {
  if (!Number.isInteger(v) || v < 0 || v >= PATTERN_COUNT) throw new RangeError("pattern int out of range");
  const res = new Array<number>(WORD_LEN);
  for (let i = 0; i < WORD_LEN; i++) {
    res[i] = v % 3;
    v = Math.floor(v / 3);
  }
  return res;
}

/// Map letters 'a' .. 'z' -> 0..25 as a fixed size code array
export function lettersToCodes(word: string): WordCodes {
  if (word.length !== WORD_LEN) throw new RangeError(`word length must be ${WORD_LEN}`);
  const out = new Uint8Array(WORD_LEN);
  for (let i = 0; i < WORD_LEN; i++) {
    const code = word.charCodeAt(i);
    const c = code - 97;
    if (c < 0 || c >= 26 || !Number.isInteger(c)) throw new TypeError("invalid character in word");
    out[i] = c;
  }
  return out;
}

/// compute pattern code for a pair of pre-encoded words (guessCodes, answerCodes)
/// first it mark EXACT for positions where guess == answer; mark those answer positions used.
/// after, for remaining guess positions, find unused answer positions with same letter;
/// mark MISPLACED and mark used, or MISS if none found.
export function getPatternCodeFromCodes(guessCodes: WordCodes, answerCodes: WordCodes): number {
  if (guessCodes.length !== WORD_LEN || answerCodes.length !== WORD_LEN) throw new RangeError("word codes must have length " + WORD_LEN);
  const pat = [MISS, MISS, MISS, MISS, MISS];
  let usedMask = 0;
  for (let i = 0; i < WORD_LEN; i++) {
    const gc = guessCodes[i]!;
    const ac = answerCodes[i]!;
    if (gc === ac) {
      pat[i] = EXACT;
      usedMask |= 1 << i;
    }
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (pat[i] === EXACT) continue;
    const g = guessCodes[i]!;
    for (let j = 0; j < WORD_LEN; j++) {
      if ((usedMask & (1 << j)) !== 0) continue;
      const a = answerCodes[j]!;
      if (a === g) {
        pat[i] = MISPLACED;
        usedMask |= 1 << j;
        break;
      }
    }
    if (pat[i] !== MISPLACED) pat[i] = MISS;
  }
  let v = 0;
  for (let i = 0; i < WORD_LEN; i++) v += pat[i]! * POW3[i]!;
  return v;
}

export function getPatternCode(guess: string, answer: string): number {
  return getPatternCodeFromCodes(lettersToCodes(guess.toLowerCase()), lettersToCodes(answer.toLowerCase()));
}

/// - allowedFile: file with allowed guesses (rows)
/// - answersFile: file with possible answers (cols)
/// - outBin: output path
/// - chunkSize: number of rows processed at once
export async function generatePatternMatrixBin(
  allowedFile: string,
  answersFile: string,
  outBin: string,
  chunkSize = 1200
): Promise<void> {
  const allowed = readWordList(allowedFile);
  const answers = readWordList(answersFile);
  const rows = allowed.length;
  const cols = answers.length;
  if (rows === 0 || cols === 0) throw new Error("empty word lists");
  const allowedCodes: WordCodes[] = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const w = allowed[i];
    assertDefined(w, `allowed[${i}]`);
    allowedCodes[i] = lettersToCodes(w);
  }
  const answersCodes: WordCodes[] = new Array(cols);
  for (let j = 0; j < cols; j++) {
    const w = answers[j];
    assertDefined(w, `answers[${j}]`);
    answersCodes[j] = lettersToCodes(w);
  }
  await mkdir(dirname(outBin), { recursive: true });
  const fh = await open(outBin, "w");
  const now = (): string => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  };
  const fmtTime = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);
  console.log(`[${now()}] generating... rows=${rows} cols=${cols}`);
  const t0 = process.hrtime.bigint();
  try {
    for (let r0 = 0; r0 < rows; r0 += chunkSize) {
      const r1 = Math.min(rows, r0 + chunkSize);
      const actualRows = r1 - r0;
      const buf = Buffer.allocUnsafe(actualRows * cols);
      for (let ri = 0, r = r0; r < r1; r++, ri++) {
        const guessCodes = allowedCodes[r]!;
        const base = ri * cols;
        for (let c = 0; c < cols; c++) {
          const answerCodes = answersCodes[c]!;
          buf[base + c] = getPatternCodeFromCodes(guessCodes, answerCodes);
        }
      }
      await fh.write(buf);
    }
  } finally {
    await fh.close();
  }
  const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const s = await stat(outBin);
  console.log(
    `[${now()}] done in ${fmtTime(durationMs)}: ${outBin} (rows=${rows} cols=${cols} size=${s.size} B)`
  );
}

// stores allowed/answer lists and the raw pattern
/// - data.length === rows * cols
/// - row-major: offset = row * cols + col
export class PatternMatrix {
  public readonly allowedWords: WordList;
  public readonly answerWords: WordList;
  public readonly rows: number;
  public readonly cols: number;
  public readonly data: Uint8Array;
  private readonly allowedIndex: Map<string, number>;
  private readonly answerIndex: Map<string, number>;

  constructor(allowedWords: WordList, answerWords: WordList, data: Uint8Array) {
    this.allowedWords = allowedWords;
    this.answerWords = answerWords;
    this.rows = allowedWords.length;
    this.cols = answerWords.length;
    if (data.length !== this.rows * this.cols) throw new Error("binary buffer size mismatch");
    this.data = data;
    this.allowedIndex = new Map<string, number>();
    this.answerIndex = new Map<string, number>();
    for (let i = 0; i < this.allowedWords.length; i++) {
      const word = this.allowedWords[i];
      assertDefined(word, `allowedWords[${i}]`);
      this.allowedIndex.set(word, i);
    }
    for (let i = 0; i < this.answerWords.length; i++) {
      const word = this.answerWords[i];
      assertDefined(word, `answerWords[${i}]`);
      this.answerIndex.set(word, i);
    }
  }

  /// load matrix from binary file and corresponding word lists.
  static async loadFromBin(binFile: string, allowedFile: string, answersFile: string): Promise<PatternMatrix> {
    const allowed = readWordList(allowedFile);
    const answers = readWordList(answersFile);
    const buf = await readFile(binFile);
    return new PatternMatrix(allowed, answers, buf as Uint8Array);
  }

  /// access to pattern code by indices
  getPatternByIndices(guessIndex: number, answerIndex: number): number {
    if (guessIndex < 0 || guessIndex >= this.rows) throw new RangeError("guessIndex out of range");
    if (answerIndex < 0 || answerIndex >= this.cols) throw new RangeError("answerIndex out of range");
    const idx = guessIndex * this.cols + answerIndex;
    if (idx < 0 || idx >= this.data.length) throw new RangeError("computed index out of range");
    const v = this.data[idx];
    if (v === undefined) throw new RangeError("pattern data undefined");
    return v;
  }

  /// get index of a guess word in allowedWords (or -1 if not present).
  getGuessIndex(word: string): number {
    return this.allowedIndex.get(word) ?? -1;
  }

  /// get index of a answer word in answerWords (or -1 if not present).
  getAnswerIndex(word: string): number {
    return this.answerIndex.get(word) ?? -1;
  }

  /// filter possible answers to those that would produce `pattern` for `guessIndex`.
  /// iterates given possibleAnswerIndices and checks stored byte per column
  filterPossibleAnswersByPattern(
    guessIndex: number,
    pattern: number,
    possibleAnswerIndices: readonly number[]
  ): number[] {
    const res: number[] = [];
    if (guessIndex < 0 || guessIndex >= this.rows) throw new RangeError("guessIndex out of range");
    const base = guessIndex * this.cols;
    for (let k = 0; k < possibleAnswerIndices.length; k++) {
      const colIdx = possibleAnswerIndices[k];
      if (colIdx === undefined) throw new RangeError(`possibleAnswerIndices[${k}] undefined`);
      if (colIdx < 0 || colIdx >= this.cols) throw new RangeError(`possibleAnswerIndices[${k}] out of range`);
      const idx = base + colIdx;
      const v = this.data[idx];
      if (v === undefined) throw new RangeError("pattern data undefined");
      if (v === pattern) res.push(colIdx);
    }
    return res;
  }

  /// compute distribution over codes for a single guess across possible answers.
  /// - weights array length match possibleAnswerIndices.length.
  getPatternDistributionForGuess(
    guessIndex: number,
    possibleAnswerIndices: readonly number[],
    weights: Float64Array
  ): Float64Array {
    if (weights.length !== possibleAnswerIndices.length) throw new RangeError("weights length must equal possibleAnswerIndices length");
    if (guessIndex < 0 || guessIndex >= this.rows) throw new RangeError("guessIndex out of range");
    const dist = new Float64Array(PATTERN_COUNT);
    const base = guessIndex * this.cols;
    for (let k = 0; k < possibleAnswerIndices.length; k++) {
      const col = possibleAnswerIndices[k];
      if (col === undefined) throw new RangeError(`possibleAnswerIndices[${k}] undefined`);
      if (col < 0 || col >= this.cols) throw new RangeError(`possibleAnswerIndices[${k}] out of range`);
      const idx = base + col;
      const pat = this.data[idx];
      if (pat === undefined) throw new RangeError("pattern data undefined");
      const w = weights[k] ?? 0;
      dist[pat] = (dist[pat] ?? 0) + w;
    }
    return dist;
  }
}

/// build weight array for possible answers from priorsMap (word -> weight).
/// - if total weight s == 0, returns uniform weights 1/k.
/// - else returns normalized weights summing to 1.
export function getWeightsFromPriors(
  pm: PatternMatrix,
  possibleAnswerIndices: readonly number[],
  priorsMap: ReadonlyMap<string, number>
): Float64Array {
  const w = new Float64Array(possibleAnswerIndices.length);
  let s = 0;
  for (let i = 0; i < possibleAnswerIndices.length; i++) {
    const idx = possibleAnswerIndices[i];
    if (idx === undefined) throw new RangeError(`possibleAnswerIndices[${i}] undefined`);
    if (idx < 0 || idx >= pm.answerWords.length) throw new RangeError(`possibleAnswerIndices[${i}] out of range`);
    const word = pm.answerWords[idx];
    if (word === undefined) throw new RangeError("answer word undefined");
    const val = priorsMap.get(word) ?? 0;
    w[i] = val;
    s += val;
  }
  if (s === 0) {
    const u = 1 / possibleAnswerIndices.length;
    for (let i = 0; i < w.length; i++) w[i] = u;
  } else {
    for (let i = 0; i < w.length; i++) w[i]! /= s;
  }
  return w;
}


export function entropyOfDistribution(dist: Float64Array): number {
  let H = 0;
  for (let i = 0; i < dist.length; i++) {
    const p = dist[i]!;
    if (p > 0) H -= p * Math.log2(p);
  }
  return H;
}

/// compute entropy for every allowed guess given current possible answers and priors.
export function getEntropiesAllAllowed(
  pm: PatternMatrix,
  possibleAnswerIndices: readonly number[],
  priorsMap: ReadonlyMap<string, number>
): Float64Array {
  const weights = getWeightsFromPriors(pm, possibleAnswerIndices, priorsMap);
  const allowedLen = pm.allowedWords.length;
  const ent = new Float64Array(allowedLen);
  for (let i = 0; i < allowedLen; i++) {
    const dist = pm.getPatternDistributionForGuess(i, possibleAnswerIndices, weights);
    ent[i] = entropyOfDistribution(dist);
  }
  return ent;
}

/// temu ahh heuristic: chose allowed word that covers most frequent letters in possible answers
/// freq counts across possible answers, each allowed word scores sum(freq(unique latters in word))
export function bestByLetterFrequency(pm: PatternMatrix, possibleAnswerIndices: readonly number[]): string {
  const freq = new Map<string, number>();
  for (let k = 0; k < possibleAnswerIndices.length; k++) {
    const idx = possibleAnswerIndices[k];
    if (idx === undefined) throw new RangeError(`possibleAnswerIndices[${k}] undefined`);
    if (idx < 0 || idx >= pm.answerWords.length) throw new RangeError(`possibleAnswerIndices[${k}] out of range`);
    const w = pm.answerWords[idx];
    assertDefined(w, "answer word undefined");
    for (const ch of w) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  const first = pm.allowedWords[0];
  if (first === undefined) throw new Error("allowed words empty");
  let best = first;
  let bestScore = -1;
  for (let i = 0; i < pm.allowedWords.length; i++) {
    const w = pm.allowedWords[i];
    assertDefined(w, `allowedWords[${i}]`);
    const seen = new Set<string>();
    let s = 0;
    for (const ch of w) {
      if (!seen.has(ch)) {
        s += freq.get(ch) ?? 0;
        seen.add(ch);
      }
    }
    if (s > bestScore) {
      bestScore = s;
      best = w;
    }
  }
  return best;
}

/// choose allowed word with maximum pattern-entropy
export function bestByEntropy(pm: PatternMatrix, possibleAnswerIndices: readonly number[], priorsMap: ReadonlyMap<string, number>): string {
  const ent = getEntropiesAllAllowed(pm, possibleAnswerIndices, priorsMap);
  if (ent.length === 0) throw new Error("no allowed words");
  let bestIdx = 0;
  for (let i = 1; i < ent.length; i++) {
    const currentEnt = ent[i]!;
    const bestEnt = ent[bestIdx]!;
    if (currentEnt > bestEnt) bestIdx = i;
  }
  const result = pm.allowedWords[bestIdx];
  assertDefined(result, `allowedWords[${bestIdx}]`);
  return result;
}

/// map from bits-of-info -> expected extra steps
export function entropyToExpectedScore(ent: number): number {
  const minScore = Math.pow(2, -ent) + 2 * (1 - Math.pow(2, -ent));
  return minScore + (1.5 * ent) / 11.5;
}

export function getExpectedScores(
  pm: PatternMatrix,
  possibleAnswerIndices: readonly number[],
  priorsMap: ReadonlyMap<string, number>
): Float64Array {
  const weights = getWeightsFromPriors(pm, possibleAnswerIndices, priorsMap);
  const H0 = entropyOfDistribution(weights);
  const H1s = getEntropiesAllAllowed(pm, possibleAnswerIndices, priorsMap);
  const wordToWeight = new Map<string, number>();
  for (let j = 0; j < possibleAnswerIndices.length; j++) {
    const idx = possibleAnswerIndices[j];
    if (idx === undefined) throw new RangeError(`possibleAnswerIndices[${j}] undefined`);
    if (idx < 0 || idx >= pm.answerWords.length) throw new RangeError(`possibleAnswerIndices[${j}] out of range`);
    const w = pm.answerWords[idx];
    if (w === undefined) throw new RangeError("answer word undefined");
    const weight = weights[j]!;
    wordToWeight.set(w, weight);
  }
  const allowedLen = pm.allowedWords.length;
  const expected = new Float64Array(allowedLen);
  for (let i = 0; i < allowedLen; i++) {
    const aw = pm.allowedWords[i];
    assertDefined(aw, `allowedWords[${i}]`);
    const prob = wordToWeight.get(aw) ?? 0;
    const infoLeft = Math.max(0, H0 - H1s[i]!);
    expected[i] = prob + (1 - prob) * (1 + entropyToExpectedScore(infoLeft));
  }
  return expected;
}

export function optimalByExpectedScore(pm: PatternMatrix, possibleAnswerIndices: readonly number[], priorsMap: ReadonlyMap<string, number>): string {
  const expected = getExpectedScores(pm, possibleAnswerIndices, priorsMap);
  if (expected.length === 0) throw new Error("no allowed words");
  let bestIdx = 0;
  for (let i = 1; i < expected.length; i++) {
    if (expected[i]! < expected[bestIdx]!) bestIdx = i;
  }
  const result = pm.allowedWords[bestIdx];
  assertDefined(result, `allowedWords[${bestIdx}]`);
  return result;
}
