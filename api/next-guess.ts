import type { IncomingMessage, ServerResponse } from "http";
import { ensureInited, pm, allowedWords, answerWords, readBody } from "./_shared.js";
import { getPatternCode, bestByEntropy, optimalByExpectedScore } from "../index.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureInited();

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.end("Method Not Allowed");
      return;
    }

    const bodyStr = await readBody(req);
    const body = JSON.parse(bodyStr || "{}");
    const { guesses, patterns, method } = body as { guesses?: string[]; patterns?: number[]; method?: string };

    if (!Array.isArray(guesses) || !Array.isArray(patterns) || guesses.length !== patterns.length) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "invalid body, require guesses[] and patterns[] of equal length" }));
      return;
    }

    let possibleIndices: number[] = answerWords.map((_, i) => i);

    if (pm) {
      for (let i = 0; i < guesses.length; i++) {
        const guess = (guesses[i] || "").toLowerCase();
        const pat = Number(patterns[i]);
        const gi = pm.getGuessIndex(guess);
        if (gi >= 0) {
          possibleIndices = pm.filterPossibleAnswersByPattern(gi, pat, possibleIndices);
        } else {
          possibleIndices = possibleIndices.filter((ai) => {
            const answerWord = answerWords[ai];
            return answerWord ? getPatternCode(guess, answerWord) === pat : false;
          });
        }
      }
    } else {
      for (let i = 0; i < guesses.length; i++) {
        const guess = (guesses[i] || "").toLowerCase();
        const pat = Number(patterns[i]);
        possibleIndices = possibleIndices.filter((ai) => {
          const answerWord = answerWords[ai];
          return answerWord ? getPatternCode(guess, answerWord) === pat : false;
        });
      }
    }

    if (possibleIndices.length === 0) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "no possibilities left (check patterns/guesses)", possibleCount: 0, sample: [] }));
      return;
    }

    if (possibleIndices.length === 1) {
      const answerWord = answerWords[possibleIndices[0]!];
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ nextGuess: answerWord, possibleCount: 1, sample: answerWord ? [answerWord] : [] }));
      return;
    }

    const m = method;
    let nextGuess = "";

    if (m === "fast" || !pm) {
      const freq = new Map<string, number>();
      for (const ai of possibleIndices) {
        const w = answerWords[ai];
        if (w) for (const ch of w) freq.set(ch, (freq.get(ch) ?? 0) + 1);
      }
      let best = allowedWords[0] || "";
      let bestScore = -1;
      for (const w of allowedWords) {
        if (!w) continue;
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
      nextGuess = best;
    } else {
      if (!pm) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "method requires precomputed pattern matrix. Generate pattern_allowed_answers.bin first." }));
        return;
      }
      const priors = new Map<string, number>();
      for (const w of answerWords) if (w) priors.set(w, 1);

      if (m === "entropy") {
        nextGuess = bestByEntropy(pm, possibleIndices, priors) || "";
      } else if (m === "expected") {
        nextGuess = optimalByExpectedScore(pm, possibleIndices, priors) || "";
      } else {
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: "unknown method" }));
        return;
      }
    }

    const sample = possibleIndices.slice(0, 20).map((i) => answerWords[i]).filter(Boolean);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ nextGuess, possibleCount: possibleIndices.length, sample }));
  } catch (error) {
    console.error("api/next-guess error:", error);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "internal server error" }));
  }
}
