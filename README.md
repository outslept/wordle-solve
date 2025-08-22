# wordle-solve

Server with a web UI to help solve Wordle. Supports 3 suggestion methods: letter frequency, no prep, entropy (information gain, requires precomputed pattern matrix), and expected (expected-score minimization, requires precomputed pattern matrix).

## Prerequisites

Bun is recommended for running the included TS scripts directly. Alternatively compile TypeScript with tsc and run with Node. The `data` folder must contain `data/allowed_words.txt` and `data/possible_words.txt`. The precomputed matrix file is `data/pattern_allowed_answers.bin`.

## Quick start

To generate the pattern matrix (optional, enables entropy/expected methods) run:

```sh
bun run generate
```

To start the server run:

```sh
bun run serve
```

Open `http://localhost:3000` in your browser.

If you do not generate the matrix the server still works but only the fast method is available.

## API

```sh
GET /api/words returns JSON { allowed: string[], answers: string[], hasMatrix: boolean }.
```

```sh
POST /api/next-guess expects JSON { "guesses": string[], "patterns": number[], "method": "fast"|"entropy"|"expected" } and returns { nextGuess: string, possibleCount: number, sample: string[] } or { error: string }. Example:
```

```sh
curl -s -X POST http://localhost:3000/api/next-guess \
  -H "Content-Type: application/json" \
  -d '{"guesses":["raise"],"patterns":[0],"method":"fast"}'
```

## Pattern encoding

Each position uses `MISS = 0`, `MISPLACED = 1`, `EXACT = 2`. A 5-element pattern `[d0,d1,d2,d3,d4]` is encoded as a base-3 integer with position 0 as the least significant digit. All-miss => `0`. All-green => `242` `(2*(1+3+9+27+81))`.
