export const WORD_LEN = 5;
export const MISS = 0;
export const MISPLACED = 1;
export const EXACT = 2;
export const PATTERN_COUNT = 3 ** WORD_LEN;

type Word = string & { readonly __brand: "word" };
export type WordList = readonly Word[];
export type WordCodes = Uint8Array;

export function isWord(value: unknown): value is Word {
  return typeof value === "string" && /^[a-z]{5}$/.test(value);
}

export function assertIsWord(value: unknown): asserts value is Word {
  if (!isWord(value)) throw new TypeError("not a word");
}

export function isWordList(value: unknown): value is WordList {
  return Array.isArray(value) && value.every((v) => isWord(v));
}

export function assertIsWordList(value: unknown): asserts value is WordList {
  if (!isWordList(value)) throw new TypeError("not a word list");
}

export function assertUint8ArrayOfLength(value: unknown, len = WORD_LEN): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array && value.length === len)) throw new TypeError("not a Uint8Array of required length");
}

export function assertDefined<T>(value: T | undefined | null, message?: string): asserts value is T {
  if (value === undefined || value === null) throw new TypeError(message ?? "value is undefined");
}
