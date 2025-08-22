(async function () {
  const guessInput = document.getElementById("guessInput");
  const pickerRow = document.getElementById("pickerRow");
  const addBtn = document.getElementById("addGuessBtn");
  const updateBtn = document.getElementById("updateGuessBtn");
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  const undoBtn = document.getElementById("undoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const methodEl = document.getElementById("method");
  const suggestionEl = document.getElementById("suggestion");
  const historyEl = document.getElementById("historyContent");
  const possibleCountEl = document.getElementById("possibleCount");
  const requestTimeEl = document.getElementById("requestTime");
  const entropyEl = document.getElementById("entropy");
  const letterFreqEl = document.getElementById("letterFreq");
  const sampleWordsEl = document.getElementById("sampleWords");

  // --- state ---
  let answers = [];
  let hasMatrix = false;
  const guesses = [];
  const patterns = [];
  let editingIndex = -1;
  let currentPossibleAnswers = [];

  // --- picker tiles ---
  const pickerTiles = [];
  function updateTileAppearance(tile, state) {
    tile.classList.remove("gray", "yellow", "green");
    if (state === 0) tile.classList.add("gray");
    else if (state === 1) tile.classList.add("yellow");
    else tile.classList.add("green");
  }
  for (let i = 0; i < 5; i++) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.state = "0";
    tile.addEventListener("click", () => {
      let state = Number(tile.dataset.state) || 0;
      state = (state + 1) % 3;
      tile.dataset.state = String(state);
      updateTileAppearance(tile, state);
    });
    updateTileAppearance(tile, 0);
    pickerRow.appendChild(tile);
    pickerTiles.push(tile);
  }

  // --- load words  ---
  try {
    const resp = await fetch("/api/words");
    if (!resp.ok) throw new Error("network error: " + resp.status);
    const data = await resp.json();
    if (!Array.isArray(data.allowed) || !Array.isArray(data.answers)) {
      throw new Error("/api/words returned unexpected payload");
    }
    allowed = data.allowed;
    answers = data.answers;
    hasMatrix = !!data.hasMatrix;

    if (!hasMatrix) {
      const optEntropy = methodEl.querySelector('option[value="entropy"]');
      const optExpected = methodEl.querySelector('option[value="expected"]');
      if (optEntropy) optEntropy.disabled = true;
      if (optExpected) optExpected.disabled = true;
    }

    possibleCountEl.textContent = String(answers.length);
    currentPossibleAnswers = answers.slice();

    updateLetterFrequency();
    updateSampleWords();
  } catch (err) {
    console.error("failed to fetch words:", err);
    letterFreqEl.innerHTML = `<div class="error">failed to load word lists. check server console.</div>`;
    sampleWordsEl.innerHTML = `<div class="error">failed to load word lists.</div>`;
  }

  function patternArrayToIntLocal(arr) {
    if (typeof window.patternArrayToInt === "function")
      return window.patternArrayToInt(arr);
    let value = 0,
      p = 1;
    for (let i = 0; i < 5; i++) {
      value += (arr[i] || 0) * p;
      p *= 3;
    }
    return value;
  }
  function patternIntToArrayLocal(v) {
    if (typeof window.patternIntToArray === "function")
      return window.patternIntToArray(v);
    const res = [];
    v = Number(v) || 0;
    for (let i = 0; i < 5; i++) {
      res.push(v % 3);
      v = Math.floor(v / 3);
    }
    return res;
  }
  function simulatePatternLocal(g, a) {
    if (typeof window.simulatePattern === "function")
      return window.simulatePattern(g, a);
    const guess = String(g).toLowerCase();
    const answer = String(a).toLowerCase();
    const pat = [0, 0, 0, 0, 0];
    const used = [false, false, false, false, false];
    for (let i = 0; i < 5; i++)
      if (guess[i] === answer[i]) {
        pat[i] = 2;
        used[i] = true;
      }
    for (let i = 0; i < 5; i++) {
      if (pat[i] === 2) continue;
      for (let j = 0; j < 5; j++) {
        if (used[j] || guess[i] !== answer[j]) continue;
        pat[i] = 1;
        used[j] = true;
        break;
      }
    }
    return patternArrayToIntLocal(pat);
  }

  function updateLetterFrequency() {
    if (!currentPossibleAnswers || currentPossibleAnswers.length === 0) {
      letterFreqEl.innerHTML = "";
      return;
    }
    const freq = {};
    for (const w of currentPossibleAnswers) {
      for (const ch of w) freq[ch] = (freq[ch] || 0) + 1;
    }
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    letterFreqEl.innerHTML = `
      <h4>most common letters:</h4>
      <div>${sorted
        .map(([c, n]) => `<span class="freq-item">${c}: ${n}</span>`)
        .join("")}</div>
    `;
  }

  function updateSampleWords() {
    if (!currentPossibleAnswers || currentPossibleAnswers.length === 0) {
      sampleWordsEl.innerHTML =
        '<div style="text-align: center; color: #999; margin-top: 20px;">no remaining possibilities</div>';
      return;
    }
    const sampleSize = Math.min(30, currentPossibleAnswers.length);
    const sample = currentPossibleAnswers.slice(0, sampleSize);
    const moreCount = currentPossibleAnswers.length - sampleSize;
    let html = `<h4 style="margin: 20px 0 12px 0;">remaining possibilities:</h4>`;
    html += `<div>${sample.join(", ")}`;
    if (moreCount > 0)
      html += ` <span style="color: #999;">(+${moreCount} more)</span>`;
    html += `</div>`;
    sampleWordsEl.innerHTML = html;
  }

  function showDiagnostics() {
    if (guesses.length === 0) return;
    let diagnosticsHtml = "<h4>diagnostics:</h4>";
    const initial = answers.length;
    diagnosticsHtml += `<div style="font-family: monospace; font-size: 12px;">`;
    diagnosticsHtml += `start: ${initial} possibilities<br>`;

    let lastPossible = answers.slice();

    for (let i = 0; i < guesses.length; i++) {
      let testPossible = answers.slice();
      for (let j = 0; j <= i; j++) {
        testPossible = testPossible.filter(
          (word) => simulatePatternLocal(guesses[j], word) === patterns[j]
        );
      }
      lastPossible = testPossible;

      const patternArray = patternIntToArrayLocal(patterns[i]);
      const patternStr = patternArray
        .map((p) => (p === 0 ? "⬛" : p === 1 ? "🟨" : "🟩"))
        .join("");
      diagnosticsHtml += `${i + 1}. ${guesses[i]} ${patternStr} → ${
        testPossible.length
      } left`;

      if (testPossible.length === 0) {
        diagnosticsHtml += ` <span style="color: #e00;">⚠️ contradiction here!</span>`;
      }
      diagnosticsHtml += `<br>`;
    }

    diagnosticsHtml += `</div>`;

    if (lastPossible.length === 0) {
      diagnosticsHtml += `<div style="margin-top: 12px; padding: 12px; background: #fef7f7; border: 1px solid #f5c6cb; border-radius: 6px; font-size: 13px;">
        <strong>problem detected:</strong> no possibilities remain after applying all provided patterns. Check your patterns/guesses above.
      </div>`;
    }

    sampleWordsEl.innerHTML = diagnosticsHtml;
  }

  // --- history render ---
  function renderHistory() {
    if (guesses.length === 0) {
      historyEl.innerHTML = '<div class="empty-state">no guesses yet</div>';
      return;
    }

    const html = guesses
      .map((guess, index) => {
        const patternArray = patternIntToArrayLocal(patterns[index]);
        const tilesHtml = patternArray
          .map((state, i) => {
            const char = guess[i] ? guess[i].toUpperCase() : "";
            const bgColor =
              state === 0 ? "#787c7e" : state === 1 ? "#c9b458" : "#6aaa64";
            return `<div class="history-tile" style="background: ${bgColor}">${char}</div>`;
          })
          .join("");

        return `
        <div class="history-row" data-index="${index}">
          <div class="history-tiles">${tilesHtml}</div>
          <div class="meta">
            <strong>${guess}</strong> | pattern: ${patterns[index]} | step ${
          index + 1
        }
            <button style="margin-left: 8px; padding: 2px 6px; font-size: 11px;" onclick="checkStep(${index})">check</button>
          </div>
        </div>
      `;
      })
      .join("");

    historyEl.innerHTML = html;

    // attach click handlers for edit (row click)
    historyEl.querySelectorAll(".history-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.tagName === "BUTTON") return;
        const index = Number(row.dataset.index);
        startEdit(index);
      });
    });
  }

  // expose checkStep for inline buttons
  window.checkStep = function (stepIndex) {
    let remaining = answers.slice();
    for (let i = 0; i <= stepIndex; i++) {
      const before = remaining.length;
      remaining = remaining.filter(
        (word) => simulatePatternLocal(guesses[i], word) === patterns[i]
      );
      console.log(
        `step ${i + 1}: ${guesses[i]} → ${before} → ${remaining.length}`
      );
      if (remaining.length <= 10)
        console.log(`remaining: ${remaining.join(", ")}`);
    }
    alert(
      `after step ${stepIndex + 1}: ${remaining.length} possibilities remaining`
    );
  };

  function startEdit(index) {
    editingIndex = index;
    guessInput.value = guesses[index];
    const arr = patternIntToArrayLocal(patterns[index]);
    setPickerFromWord(guesses[index], arr);

    addBtn.style.display = "none";
    updateBtn.style.display = "inline-block";
    cancelEditBtn.style.display = "inline-block";
  }

  function cancelEdit() {
    editingIndex = -1;
    guessInput.value = "";
    setPickerFromWord("");
    addBtn.style.display = "inline-block";
    updateBtn.style.display = "none";
    cancelEditBtn.style.display = "none";
  }

  function setPickerFromWord(word, patternArray = null) {
    word = (word || "").toUpperCase();
    for (let i = 0; i < 5; i++) {
      const tile = pickerTiles[i];
      tile.textContent = word[i] || "";
      const state = patternArray ? patternArray[i] : 0;
      tile.dataset.state = String(state);
      updateTileAppearance(tile, state);
    }
  }

  // --- request suggestion ---
  async function requestSuggestion() {
    const startTime = performance.now();
    try {
      suggestionEl.textContent = "calculating...";
      possibleCountEl.textContent = "—";
      requestTimeEl.textContent = "—";
      entropyEl.textContent = "—";
      letterFreqEl.innerHTML = '<div class="loading">analyzing...</div>';
      sampleWordsEl.innerHTML = '<div class="loading">analyzing...</div>';

      const body = {
        guesses: guesses.slice(),
        patterns: patterns.slice(),
        method: methodEl.value,
      };
      const resp = await fetch("/api/next-guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await resp.json();
      const endTime = performance.now();
      const requestTime = Math.round(endTime - startTime);

      if (data.error) {
        suggestionEl.textContent = "error";
        possibleCountEl.textContent = "0";
        requestTimeEl.textContent = String(requestTime);
        entropyEl.textContent = "0";
        letterFreqEl.innerHTML = `<div class="error">${data.error}</div>`;
        // show diagnostic panel for the user
        showDiagnostics();
        return;
      }

      suggestionEl.textContent = data.nextGuess || "—";
      possibleCountEl.textContent = String(data.possibleCount || 0);
      requestTimeEl.textContent = String(requestTime);

      const currentEntropy =
        data.possibleCount > 0 ? Math.log2(data.possibleCount) : 0;
      entropyEl.textContent = currentEntropy.toFixed(2);

      currentPossibleAnswers = Array.isArray(data.sample) ? data.sample : [];
      updateLetterFrequency();
      updateSampleWords();
    } catch (err) {
      console.error("request failed:", err);
      suggestionEl.textContent = "request failed";
      letterFreqEl.innerHTML = '<div class="error">request failed</div>';
      sampleWordsEl.innerHTML = "";
    }
  }

  // --- event listeners ---
  guessInput.addEventListener("input", (e) => {
    const value = e.target.value.toLowerCase().slice(0, 5);
    e.target.value = value;
    for (let i = 0; i < 5; i++) {
      pickerTiles[i].textContent = value[i] ? value[i].toUpperCase() : "";
    }
  });

  methodEl.addEventListener("change", () => {
    if (guesses.length > 0) requestSuggestion();
  });

  addBtn.addEventListener("click", async () => {
    const word = guessInput.value.toLowerCase();
    if (!/^[a-z]{5}$/.test(word)) {
      alert("please enter a valid 5-letter word.");
      return;
    }

    const patternArray = pickerTiles.map((tile) => Number(tile.dataset.state));
    const patternInt = patternArrayToIntLocal(patternArray);

    guesses.push(word);
    patterns.push(patternInt);

    guessInput.value = "";
    setPickerFromWord("");
    renderHistory();
    await requestSuggestion();
  });

  updateBtn.addEventListener("click", async () => {
    if (editingIndex < 0) return;
    const word = guessInput.value.toLowerCase();
    if (!/^[a-z]{5}$/.test(word)) {
      alert("please enter a valid 5-letter word.");
      return;
    }

    const patternArray = pickerTiles.map((tile) => Number(tile.dataset.state));
    const patternInt = patternArrayToIntLocal(patternArray);

    guesses[editingIndex] = word;
    patterns[editingIndex] = patternInt;

    cancelEdit();
    renderHistory();
    await requestSuggestion();
  });

  cancelEditBtn.addEventListener("click", cancelEdit);

  undoBtn.addEventListener("click", async () => {
    if (guesses.length === 0) return;
    guesses.pop();
    patterns.pop();
    renderHistory();

    if (guesses.length > 0) {
      await requestSuggestion();
    } else {
      suggestionEl.textContent = "—";
      possibleCountEl.textContent = answers.length
        ? String(answers.length)
        : "—";
      requestTimeEl.textContent = "—";
      entropyEl.textContent = answers.length
        ? Math.log2(answers.length).toFixed(2)
        : "—";
      currentPossibleAnswers = answers.slice();
      updateLetterFrequency();
      updateSampleWords();
    }
  });

  clearBtn.addEventListener("click", async () => {
    if (guesses.length === 0) return;
    if (!confirm("clear all guesses?")) return;
    guesses.length = 0;
    patterns.length = 0;
    cancelEdit();
    renderHistory();
    suggestionEl.textContent = "—";
    possibleCountEl.textContent = answers.length ? String(answers.length) : "—";
    requestTimeEl.textContent = "—";
    entropyEl.textContent = answers.length
      ? Math.log2(answers.length).toFixed(2)
      : "—";
    currentPossibleAnswers = answers.slice();
    updateLetterFrequency();
    updateSampleWords();
  });

  guessInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (updateBtn.style.display !== "none") updateBtn.click();
      else addBtn.click();
    }
  });

  setPickerFromWord("");
  renderHistory();
  suggestionEl.textContent = "—";
  if (answers.length > 0)
    entropyEl.textContent = Math.log2(answers.length).toFixed(2);
  sampleWordsEl.innerHTML =
    '<div style="text-align: center; color: #999; margin-top: 20px;">enter your first guess to begin</div>';
})();
