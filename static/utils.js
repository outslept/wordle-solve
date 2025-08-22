(function (global) {
  "use strict";

  // patternArray -> base-3 int
  function patternArrayToInt(array) {
    if (!Array.isArray(array)) throw new TypeError("pattern must be an array");
    let value = 0;
    let power = 1;
    for (let i = 0; i < 5; i++) {
      value += (array[i] || 0) * power;
      power *= 3;
    }
    return value;
  }

  // inverse
  function patternIntToArray(v) {
    v = Number(v) || 0;
    const res = [];
    for (let i = 0; i < 5; i++) {
      res.push(v % 3);
      v = Math.floor(v / 3);
    }
    return res;
  }

  function simulatePattern(guess, answer) {
    if (!guess || !answer) return patternArrayToInt([0,0,0,0,0]);
    const g = String(guess).toLowerCase();
    const a = String(answer).toLowerCase();
    const pattern = [0,0,0,0,0];
    const used = [false,false,false,false,false];

    // exacts
    for (let i = 0; i < 5; i++) {
      if (g[i] === a[i]) {
        pattern[i] = 2;
        used[i] = true;
      }
    }
    // misplaced
    for (let i = 0; i < 5; i++) {
      if (pattern[i] === 2) continue;
      for (let j = 0; j < 5; j++) {
        if (used[j]) continue;
        if (g[i] === a[j]) {
          pattern[i] = 1;
          used[j] = true;
          break;
        }
      }
    }
    return patternArrayToInt(pattern);
  }

  global.patternArrayToInt = patternArrayToInt;
  global.patternIntToArray = patternIntToArray;
  global.simulatePattern = simulatePattern;

})(window);
