(function () {
  const notes = [
    { solfege: "ド", name: "C", frequency: 261.63 },
    { solfege: "レ", name: "D", frequency: 293.66 },
    { solfege: "ミ", name: "E", frequency: 329.63 },
    { solfege: "ファ", name: "F", frequency: 349.23 },
    { solfege: "ソ", name: "G", frequency: 392.00 },
    { solfege: "ラ", name: "A", frequency: 440.00 },
    { solfege: "シ", name: "B", frequency: 493.88 }
  ];

  const LISTEN_COUNT = 5;
  const VOICE_COUNT = 5;
  const VOICE_PASS_CENTS = 50;
  const VOICE_SILENCE_MS = 850;
  const VOICE_MIN_SAMPLES = 6;
  const OVERALL_PASS_POINTS = 7;

  const startFullTestButton = document.querySelector("#startFullTestButton");
  const restartButton = document.querySelector("#restartButton");
  const testers = {
    listen: document.querySelector("#listenTester"),
    voice: document.querySelector("#voiceTester")
  };
  const solfegeButtons = document.querySelector("#solfegeButtons");
  const listenResult = document.querySelector("#listenResult");
  const listenScore = document.querySelector("#listenScore");
  const targetNoteLabel = document.querySelector("#targetNoteLabel");
  const detectedNote = document.querySelector("#detectedNote");
  const centDiff = document.querySelector("#centDiff");
  const voiceResult = document.querySelector("#voiceResult");
  const voiceGate = document.querySelector("#voiceGate");
  const voiceInstruction = document.querySelector("#voiceInstruction");
  const tuner = document.querySelector(".tuner");
  const pitchNeedle = document.querySelector("#pitchNeedle");
  const waveCanvas = document.querySelector("#waveCanvas");
  const waveContext = waveCanvas.getContext("2d");
  const waitingPanel = document.querySelector("#waitingPanel");
  const resultPanel = document.querySelector("#resultPanel");
  const finalTitle = document.querySelector("#finalTitle");
  const finalMessage = document.querySelector("#finalMessage");
  const finalListenScore = document.querySelector("#finalListenScore");
  const finalVoiceScore = document.querySelector("#finalVoiceScore");
  const finalTotalScore = document.querySelector("#finalTotalScore");
  const finalLevel = document.querySelector("#finalLevel");
  const finalDetails = document.querySelector("#finalDetails");
  const lineCta = document.querySelector("#lineCta");
  const resultLevelItems = Array.from(document.querySelectorAll(".result-level-scale span"));
  const campaignParams = readCampaignParams();

  let audioContext;
  let micStream = null;
  let analyser = null;
  let micData = null;
  let animationFrame = null;
  let activePhase = "idle";

  let activeListenNote = null;
  let listenTotal = 0;
  let listenCorrect = 0;
  let solfegeButtonList = [];

  let targetNote = notes[0];
  let voiceTotal = 0;
  let voiceCorrect = 0;
  let voiceAttemptActive = false;
  let voiceLastHeardAt = 0;
  let voiceCentSamples = [];
  let voiceFrequencySamples = [];
  let voiceCentsByQuestion = [];
  let ignoreMicUntil = 0;

  function readCampaignParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      app_name: "kiradore_pitch_challenge",
      page_location: window.location.href,
      page_path: window.location.pathname,
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
      route: params.get("route") || params.get("utm_source") || "direct"
    };
  }

  function track(eventName, details = {}) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: eventName,
      ...campaignParams,
      ...details
    });
  }

  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    return audioContext;
  }

  function randomNote() {
    return notes[Math.floor(Math.random() * notes.length)];
  }

  function playFrequency(frequency, duration = 0.75) {
    const context = getAudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.34, context.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.04);
  }

  function playCorrectSound() {
    const context = getAudioContext();
    const now = context.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.075;
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.24, start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.25);
    });
  }

  function playFanfare(passed) {
    const context = getAudioContext();
    const now = context.currentTime;
    const melody = passed
      ? [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5]
      : [392.00, 329.63, 392.00, 523.25];
    melody.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.13;
      oscillator.type = passed ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(passed ? 0.24 : 0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.32);
    });
  }

  function setMode(mode) {
    Object.entries(testers).forEach(([key, element]) => {
      const active = key === mode;
      element.classList.toggle("is-active", active);
      element.hidden = !active;
    });
  }

  function updateResultLevel(level) {
    resultLevelItems.forEach((item, index) => item.classList.toggle("is-lit", index < level));
  }

  function renderSolfegeButtons() {
    const fragment = document.createDocumentFragment();
    notes.forEach((note) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = note.solfege;
      button.disabled = true;
      button.addEventListener("click", () => answerListen(note, button));
      solfegeButtonList.push(button);
      fragment.appendChild(button);
    });
    solfegeButtons.appendChild(fragment);
  }

  function setSolfegeEnabled(enabled) {
    solfegeButtonList.forEach((button) => {
      button.disabled = !enabled;
    });
  }

  async function prepareMic() {
    const context = getAudioContext();
    if (!micStream) {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const source = context.createMediaStreamSource(micStream);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      micData = new Float32Array(analyser.fftSize);
      source.connect(analyser);
    }
    if (!animationFrame) drawMic();
  }

  async function startFullTest() {
    try {
      startFullTestButton.disabled = true;
      startFullTestButton.textContent = "準備中";
      await prepareMic();
      resetAll();
      startFullTestButton.hidden = true;
      waitingPanel.hidden = true;
      resultPanel.hidden = true;
      setMode("listen");
      activePhase = "listen";
      listenResult.textContent = "今からなる音を、ドレミで答えてね！";
      track("kiradore_start");
      window.setTimeout(playNextListenNote, 450);
    } catch (error) {
      startFullTestButton.disabled = false;
      startFullTestButton.textContent = "チャレンジスタート！";
      startFullTestButton.hidden = false;
    }
  }

  function resetAll() {
    activePhase = "idle";
    activeListenNote = null;
    listenTotal = 0;
    listenCorrect = 0;
    voiceTotal = 0;
    voiceCorrect = 0;
    voiceAttemptActive = false;
    voiceCentSamples = [];
    voiceFrequencySamples = [];
    voiceCentsByQuestion = [];
    ignoreMicUntil = performance.now() + 500;
    listenScore.textContent = `0 / ${LISTEN_COUNT}`;
    listenResult.textContent = "スタートすると5問はじまります。";
    setSolfegeEnabled(false);
    targetNoteLabel.textContent = "ド";
    voiceGate.textContent = "発声OFF";
    voiceGate.classList.remove("is-on");
    voiceInstruction.textContent = "ドレミあての後に自動で始まります。";
    detectedNote.textContent = "--";
    centDiff.textContent = "--";
    voiceResult.textContent = `0 / ${VOICE_COUNT}`;
    pitchNeedle.style.left = "50%";
    tuner.classList.remove("is-hidden");
    waitingPanel.hidden = true;
    resultPanel.hidden = true;
    resultPanel.classList.remove("is-pass", "is-fail");
    updateResultLevel(0);
  }

  function playNextListenNote() {
    if (activePhase !== "listen" || activeListenNote) return;
    if (listenTotal >= LISTEN_COUNT) {
      finishListenPhase();
      return;
    }
    activeListenNote = randomNote();
    listenResult.textContent = `第${listenTotal + 1}問`;
    playFrequency(activeListenNote.frequency);
    setSolfegeEnabled(true);
  }

  function answerListen(note, button) {
    if (!activeListenNote || activePhase !== "listen") return;
    button.classList.remove("is-bouncy");
    void button.offsetWidth;
    button.classList.add("is-bouncy");
    setSolfegeEnabled(false);
    listenTotal += 1;
    if (note.solfege === activeListenNote.solfege) {
      listenCorrect += 1;
      playCorrectSound();
      listenResult.textContent = `正解です。${activeListenNote.solfege}でした。`;
    } else {
      listenResult.textContent = `今回は${activeListenNote.solfege}でした。`;
    }
    activeListenNote = null;
    listenScore.textContent = `${listenCorrect} / ${LISTEN_COUNT}`;
    if (listenTotal >= LISTEN_COUNT) {
      window.setTimeout(finishListenPhase, 850);
    } else {
      window.setTimeout(playNextListenNote, 950);
    }
  }

  function finishListenPhase() {
    activePhase = "between";
    listenResult.textContent = `ドレミあては終了です。正解は${listenCorrect}問でした。続いてこえチャレに進みます。`;
    setSolfegeEnabled(false);
    track("kiradore_listen_complete", {
      listen_score: listenCorrect,
      listen_total: LISTEN_COUNT
    });
    window.setTimeout(startVoicePhase, 1300);
  }

  function startVoicePhase() {
    setMode("voice");
    activePhase = "voice";
    voiceInstruction.textContent = "画面のドレミを、正しく歌ってね！お手本音は鳴りません。";
    voiceResult.textContent = `0 / ${VOICE_COUNT}`;
    window.setTimeout(playNextVoiceTarget, 500);
  }

  function playNextVoiceTarget() {
    if (activePhase !== "voice" || voiceAttemptActive) return;
    if (voiceTotal >= VOICE_COUNT) {
      finishVoicePhase();
      return;
    }
    targetNote = randomNote();
    targetNoteLabel.textContent = targetNote.solfege;
    resetVoiceAttempt();
    voiceInstruction.textContent = `第${voiceTotal + 1}問です。「${targetNote.solfege}」を声で出してください。`;
    voiceResult.textContent = `${voiceTotal} / ${VOICE_COUNT}`;
    ignoreMicUntil = performance.now() + 350;
  }

  function resetVoiceAttempt() {
    voiceAttemptActive = false;
    voiceLastHeardAt = 0;
    voiceCentSamples = [];
    voiceFrequencySamples = [];
    tuner.classList.remove("is-hidden");
    voiceGate.textContent = "発声OFF";
    voiceGate.classList.remove("is-on");
    detectedNote.textContent = "--";
    centDiff.textContent = "--";
    pitchNeedle.style.left = "50%";
  }

  function startVoiceAttempt(now) {
    voiceAttemptActive = true;
    voiceLastHeardAt = now;
    voiceCentSamples = [];
    voiceFrequencySamples = [];
    tuner.classList.add("is-hidden");
    voiceGate.textContent = "発声ON";
    voiceGate.classList.add("is-on");
    detectedNote.textContent = "--";
    centDiff.textContent = "--";
    voiceResult.textContent = "回答中";
    voiceInstruction.textContent = "発声中です。ゲージは見えない状態で記録しています。";
  }

  function finishVoiceAttempt() {
    voiceAttemptActive = false;
    tuner.classList.remove("is-hidden");
    voiceGate.textContent = "発声OFF";
    voiceGate.classList.remove("is-on");

    if (voiceCentSamples.length < VOICE_MIN_SAMPLES) {
      voiceInstruction.textContent = "短すぎました。同じ問題をもう少し長く発声してください。";
      voiceResult.textContent = `${voiceTotal} / ${VOICE_COUNT}`;
      return;
    }

    const finalCents = average(voiceCentSamples);
    const finalFrequency = average(voiceFrequencySamples);
    const clamped = Math.max(-100, Math.min(100, finalCents));
    const passed = Math.abs(finalCents) <= VOICE_PASS_CENTS;
    voiceTotal += 1;
    if (passed) voiceCorrect += 1;
    if (passed) playCorrectSound();
    voiceCentsByQuestion.push(Math.round(finalCents));
    detectedNote.textContent = frequencyToNote(finalFrequency);
    centDiff.textContent = `${Math.round(finalCents)} cent`;
    pitchNeedle.style.left = `${50 + clamped * 0.42}%`;
    voiceResult.textContent = `${voiceTotal} / ${VOICE_COUNT}`;
    voiceInstruction.textContent = `記録しました。次の問題へ進みます。`;

    if (voiceTotal >= VOICE_COUNT) {
      window.setTimeout(finishVoicePhase, 900);
    } else {
      window.setTimeout(playNextVoiceTarget, 1100);
    }
  }

  function finishVoicePhase() {
    activePhase = "done";
    stopMic();
    voiceInstruction.textContent = "こえチャレ終了。結果を発表します。";
    track("kiradore_voice_complete", {
      voice_score: voiceCorrect,
      voice_total: VOICE_COUNT
    });
    showWaitingResult();
  }

  function stopMic() {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
      micStream = null;
      analyser = null;
      micData = null;
    }
  }

  function showWaitingResult() {
    setMode("voice");
    waitingPanel.hidden = false;
    resultPanel.hidden = true;
    waitingPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(showFinalResult, 1600);
  }

  function showFinalResult() {
    const totalPoints = listenCorrect + voiceCorrect;
    const level = Math.min(5, Math.max(1, Math.ceil((totalPoints / (LISTEN_COUNT + VOICE_COUNT)) * 5)));
    const passed = totalPoints >= OVERALL_PASS_POINTS;
    const voiceAverage = voiceCentsByQuestion.length ? Math.round(average(voiceCentsByQuestion.map(Math.abs))) : 0;

    track("kiradore_result", {
      listen_score: listenCorrect,
      listen_total: LISTEN_COUNT,
      voice_score: voiceCorrect,
      voice_total: VOICE_COUNT,
      total_score: totalPoints,
      total_possible: LISTEN_COUNT + VOICE_COUNT,
      level,
      passed,
      voice_average_cents: voiceAverage
    });
    updateResultLevel(level);
    finalTitle.textContent = passed ? "キラドレ合格！" : "あと少しでキラドレ！";
    finalMessage.textContent = passed
      ? "ドレミをきく力も、声で出す力もばっちり。今日のチャレンジ、すてきにクリアです。"
      : "あと少しです。ドレミあてとこえチャレ、どちらを練習すると伸びるか見えてきました。";
    finalListenScore.textContent = `${listenCorrect} / ${LISTEN_COUNT}`;
    finalVoiceScore.textContent = `${voiceCorrect} / ${VOICE_COUNT}`;
    finalTotalScore.textContent = `${totalPoints} / ${LISTEN_COUNT + VOICE_COUNT}`;
    finalLevel.textContent = `レベル${level}`;
    finalDetails.textContent = `採点: ドレミあては正解1問につき1点。こえチャレは画面に出た音から±${VOICE_PASS_CENTS}cent以内で1点。総合${OVERALL_PASS_POINTS}点以上で合格です。こえチャレの平均ずれは約${voiceAverage}centでした。`;
    resultPanel.classList.toggle("is-pass", passed);
    resultPanel.classList.toggle("is-fail", !passed);
    waitingPanel.hidden = true;
    resultPanel.hidden = false;
    startFullTestButton.hidden = true;
    playFanfare(passed);
    resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function autoCorrelate(buffer, sampleRate) {
    let rms = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 0.015) return -1;

    let bestOffset = -1;
    let bestCorrelation = 0;
    const minOffset = Math.floor(sampleRate / 800);
    const maxOffset = Math.floor(sampleRate / 80);
    for (let offset = minOffset; offset <= maxOffset; offset += 1) {
      let correlation = 0;
      for (let i = 0; i < buffer.length - offset; i += 1) {
        correlation += 1 - Math.abs(buffer[i] - buffer[i + offset]);
      }
      correlation /= buffer.length - offset;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }
    if (bestCorrelation < 0.88 || bestOffset === -1) return -1;
    return sampleRate / bestOffset;
  }

  function frequencyToNote(frequency) {
    const midi = Math.round(12 * Math.log2(frequency / 440) + 69);
    const noteNames = ["ド", "ド#", "レ", "レ#", "ミ", "ファ", "ファ#", "ソ", "ソ#", "ラ", "ラ#", "シ"];
    return noteNames[((midi % 12) + 12) % 12];
  }

  function nearestTargetFrequency(frequency, targetFrequency) {
    let adjusted = targetFrequency;
    while (adjusted < frequency / Math.SQRT2) adjusted *= 2;
    while (adjusted > frequency * Math.SQRT2) adjusted /= 2;
    return adjusted;
  }

  function centsBetween(frequency, targetFrequency) {
    return 1200 * Math.log2(frequency / nearestTargetFrequency(frequency, targetFrequency));
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function drawWave(buffer) {
    const width = waveCanvas.width;
    const height = waveCanvas.height;
    waveContext.fillStyle = "#161d22";
    waveContext.fillRect(0, 0, width, height);
    waveContext.strokeStyle = "#e4c26a";
    waveContext.lineWidth = 3;
    waveContext.beginPath();
    const step = Math.ceil(buffer.length / width);
    for (let x = 0; x < width; x += 1) {
      const sample = buffer[x * step] || 0;
      const y = height / 2 + sample * height * 0.42;
      if (x === 0) {
        waveContext.moveTo(x, y);
      } else {
        waveContext.lineTo(x, y);
      }
    }
    waveContext.stroke();
  }

  function drawMic() {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(micData);
    drawWave(micData);

    const now = performance.now();
    const pitch = autoCorrelate(micData, getAudioContext().sampleRate);
    if (now < ignoreMicUntil) {
      animationFrame = window.requestAnimationFrame(drawMic);
      return;
    }

    if (pitch < 0) {
      if (voiceAttemptActive && now - voiceLastHeardAt > VOICE_SILENCE_MS) {
        finishVoiceAttempt();
      } else if (!voiceAttemptActive && activePhase === "voice") {
        voiceGate.textContent = "発声OFF";
        voiceGate.classList.remove("is-on");
      }
    } else if (activePhase === "voice") {
      const cents = centsBetween(pitch, targetNote.frequency);
      if (!voiceAttemptActive) startVoiceAttempt(now);
      voiceLastHeardAt = now;
      if (Math.abs(cents) <= 600) {
        voiceCentSamples.push(cents);
        voiceFrequencySamples.push(pitch);
      }
    }

    animationFrame = window.requestAnimationFrame(drawMic);
  }

  startFullTestButton.addEventListener("click", startFullTest);
  lineCta.addEventListener("click", () => {
    const totalPoints = listenCorrect + voiceCorrect;
    track("kiradore_line_click", {
      destination: lineCta.href,
      listen_score: listenCorrect,
      voice_score: voiceCorrect,
      total_score: totalPoints
    });
  });
  restartButton.addEventListener("click", () => {
    track("kiradore_restart", {
      listen_score: listenCorrect,
      voice_score: voiceCorrect,
      total_score: listenCorrect + voiceCorrect
    });
    startFullTestButton.hidden = false;
    startFullTestButton.disabled = false;
    startFullTestButton.textContent = "チャレンジスタート！";
    resultPanel.hidden = true;
    resetAll();
    setMode("listen");
    startFullTest();
  });

  window.addEventListener("beforeunload", () => {
    stopMic();
  });

  renderSolfegeButtons();
  resetAll();
  setMode("listen");
}());
