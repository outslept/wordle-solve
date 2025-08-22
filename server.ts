import http from "http";
import { createReadStream, existsSync, statSync } from "fs";
import {
  PatternMatrix,
  readWordList,
  getPatternCode,
  bestByEntropy,
  optimalByExpectedScore,
} from "./index.js";
import { extname, join, normalize } from "path";
import type { WordList } from "./types.js";

const DATA_DIR = join(__dirname, "data");
const ALLOWED_FILE = join(DATA_DIR, "allowed_words.txt");
const ANSWERS_FILE = join(DATA_DIR, "possible_words.txt");
const PATTERN_BIN = join(DATA_DIR, "pattern_allowed_answers.bin");
const STATIC_ROOT = join(__dirname, "static");

let pm: PatternMatrix | null = null;
let allowedWords: string[] = [];
let answerWords: string[] = [];
let patternBinLoaded = false;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

export async function init() {
  // @ts-ignore
  allowedWords = readWordList(ALLOWED_FILE);
  // @ts-ignore
  answerWords = readWordList(ANSWERS_FILE);

  console.log(`loaded ${allowedWords.length} allowed words, ${answerWords.length} answer words`);

  if (existsSync(PATTERN_BIN)) {
    pm = await PatternMatrix.loadFromBin(PATTERN_BIN, ALLOWED_FILE, ANSWERS_FILE);
    patternBinLoaded = true;
    console.log("loaded precomputed pattern matrix");
  } else {
    console.log("no pattern matrix found - only fast method available");
  }
}

function sendJSON(res: http.ServerResponse, obj: any, status = 200) {
  const json = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function send404(res: http.ServerResponse) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function send500(res: http.ServerResponse) {
  res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Internal server error");
}

function safeJoin(base: string, requestedPath: string) {
  const p = normalize(join(base, requestedPath));
  if (!p.startsWith(base)) return null;
  return p;
}

function tryServeStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  let rel = pathname;
  if (rel === "/") rel = "/index.html";
  const filePath = safeJoin(STATIC_ROOT, rel);
  if (!filePath) return false;

  if (!existsSync(filePath)) return false;
  const st = statSync(filePath);
  if (st.isDirectory()) {
    const indexPath = join(filePath, "index.html");
    if (!existsSync(indexPath)) return false;
    return streamFile(res, indexPath);
  }
  return streamFile(res, filePath);
}

function streamFile(res: http.ServerResponse, filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const stream = createReadStream(filePath);
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-cache",
  });
  stream.pipe(res);
  stream.on("error", () => {
    try { res.destroy(); } catch {}
  });
  return true;
}

function readBody(req: http.IncomingMessage, maxSize = 1e6): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxSize) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", (err) => reject(err));
  });
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  if (req.method === "GET" && pathname === "/api/words") {
    sendJSON(res, { allowed: allowedWords, answers: answerWords, hasMatrix: patternBinLoaded });
    return;
  }

  if (req.method === "POST" && pathname === "/api/next-guess") {
    try {
      const bodyStr = await readBody(req);
      const body = JSON.parse(bodyStr || "{}");
      const { guesses, patterns, method } = body as { guesses: string[]; patterns: number[]; method?: string };

      if (!Array.isArray(guesses) || !Array.isArray(patterns) || guesses.length !== patterns.length) {
        sendJSON(res, { error: "invalid body, require guesses[] and patterns[] of equal length" }, 400);
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
        sendJSON(res, { error: "no possibilities left (check patterns/guesses)", possibleCount: 0, sample: [] });
        return;
      }
      if (possibleIndices.length === 1) {
        const answerWord = answerWords[possibleIndices[0]!];
        sendJSON(res, { nextGuess: answerWord, possibleCount: 1, sample: answerWord ? [answerWord] : [] });
        return;
      }

      const m = method;
      let nextGuess = "";

      if (m === "fast") {
        const freq = new Map<string, number>();
        for (const ai of possibleIndices) {
          const w = answerWords[ai];
          if (w) {
            for (const ch of w) freq.set(ch, (freq.get(ch) ?? 0) + 1);
          }
        }
        let best = allowedWords[0] || "";
        let bestScore = -1;
        for (const w of allowedWords) {
          if (w) {
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
        }
        nextGuess = best;
      } else {
        if (!pm) {
          sendJSON(res, { error: "method requires precomputed pattern matrix. Generate pattern_allowed_answers.bin first." }, 400);
          return;
        }
        const priors = new Map<string, number>();
        for (const w of answerWords) {
          if (w) {
            priors.set(w, 1);
          }
        }

        if (m === "entropy") {
          nextGuess = bestByEntropy(pm, possibleIndices, priors) || "";
        } else if (m === "expected") {
          nextGuess = optimalByExpectedScore(pm, possibleIndices, priors) || "";
        } else {
          sendJSON(res, { error: "unknown method" }, 400);
          return;
        }
      }

      const sample = possibleIndices.slice(0, 20).map((i) => answerWords[i]).filter(Boolean);
      sendJSON(res, { nextGuess, possibleCount: possibleIndices.length, sample });
    } catch (error) {
      console.error("api error:", error);
      sendJSON(res, { error: "internal server error" }, 500);
    }
    return;
  }

  send404(res);
}

const PORT = Number(process.env.PORT || 3000);

init().then(() => {
  console.log(`server initialized with ${allowedWords.length} allowed words, ${answerWords.length} answer words`);

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "/", `http://${host}`);
      const pathname = decodeURIComponent(url.pathname);

      if (pathname.startsWith("/api/")) {
        await handleApi(req, res, pathname);
        return;
      }

      const served = tryServeStatic(req, res, pathname);
      if (!served) send404(res);
    } catch (error) {
      console.error("server error:", error);
      send500(res);
    }
  });

  server.listen(PORT, () => {
    console.log(`listening on http://localhost:${PORT}`);
  });
}).catch(error => {
  console.error("failed to initialize server:", error);
  process.exit(1);
});
