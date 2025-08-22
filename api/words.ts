import type { IncomingMessage, ServerResponse } from "http";
import { ensureInited, pm, allowedWords, answerWords } from "./_shared.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureInited();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.statusCode = 200;
    res.end(JSON.stringify({ allowed: allowedWords, answers: answerWords, hasMatrix: !!pm }));
  } catch (err) {
    console.error("api/words error:", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "internal server error" }));
  }
}
