'use strict';

/* ============================================================
   The Scriptorium — client-side clerk
   A Pomodoro timer with decrees the scribe may amend at will.
   ============================================================ */

(() => {
  const DEFAULTS = Object.freeze({
    focusMinutes: 25,
    shortBreakMinutes: 5,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    autoStartBreaks: false,
    autoStartFocus: false,
    sound: true,
  });

  const MODE_INFO = {
    focus: { label: 'Study', glyph: '✒', setting: 'focusMinutes', auto: 'autoStartFocus' },
    short: { label: 'Rest', glyph: '☕', setting: 'shortBreakMinutes', auto: 'autoStartBreaks' },
    long: { label: 'Feast', glyph: '🍗', setting: 'longBreakMinutes', auto: 'autoStartBreaks' },
  };

  const RING_CIRCUMFERENCE = 2 * Math.PI * 104;
  const STORAGE_KEY = 'scriptorium.settings.v1';
  const BASE_TITLE = 'The Scriptorium — A Pomodoro of the Realm';

  const $ = (id) => document.getElementById(id);

  const el = {
    timerCard: document.querySelector('.timer-card'),
    modeTabs: Array.from(document.querySelectorAll('.mode-tab')),
    modeLabel: $('modeLabel'),
    timeDisplay: $('timeDisplay'),
    dialSub: $('dialSub'),
    ringProgress: $('ringProgress'),
    startBtn: $('startBtn'),
    resetBtn: $('resetBtn'),
    skipBtn: $('skipBtn'),
    seals: $('seals'),
    form: $('settingsForm'),
    settingsStatus: $('settingsStatus'),
    saveBtn: $('saveBtn'),
    defaultsBtn: $('defaultsBtn'),
    ledgerList: $('ledgerList'),
    clearLedgerBtn: $('clearLedgerBtn'),
    toast: $('toast'),
  };

  const state = {
    settings: { ...DEFAULTS },
    mode: 'focus',
    totalMs: DEFAULTS.focusMinutes * 60000,
    remainingMs: DEFAULTS.focusMinutes * 60000,
    running: false,
    endAt: 0,
    ticker: null,
    completedInCycle: 0,
    lastSealKey: '',
    lastSecond: null,
    toastTimer: null,
    autoStartTimer: null,
    apiOnline: true,
  };

  /* ---------- Small helpers ---------- */

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function durationMs(mode) {
    return state.settings[MODE_INFO[mode].setting] * 60000;
  }

  function formatTime(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
  }

  function setStatus(message, isError = false) {
    el.settingsStatus.textContent = message;
    el.settingsStatus.classList.toggle('error', isError);
  }

  /* ---------- Persistence ---------- */

  function saveLocalSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch {
      /* the local scroll is full; the royal archive still holds the truth */
    }
  }

  function readLocalSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.settings = { ...DEFAULTS, ...data.settings };
      state.apiOnline = true;
    } catch {
      state.settings = readLocalSettings();
      state.apiOnline = false;
      setStatus('The royal courier is away; the local scroll holds your decrees.', true);
    }
    applySettings({ resetCurrent: true, announce: false });
    renderSettingsForm();
  }

  async function persistSettings(nextSettings) {
    saveLocalSettings();
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      state.settings = { ...DEFAULTS, ...data.settings };
      state.apiOnline = true;
      return { ok: true };
    } catch (err) {
      state.apiOnline = false;
      return { ok: false, error: err.message || 'The raven lost the scroll.' };
    }
  }

  /* ---------- Settings form ---------- */

  function renderSettingsForm() {
    el.form.elements.focusMinutes.value = state.settings.focusMinutes;
    el.form.elements.shortBreakMinutes.value = state.settings.shortBreakMinutes;
    el.form.elements.longBreakMinutes.value = state.settings.longBreakMinutes;
    el.form.elements.longBreakEvery.value = state.settings.longBreakEvery;
    el.form.elements.autoStartBreaks.checked = state.settings.autoStartBreaks;
    el.form.elements.autoStartFocus.checked = state.settings.autoStartFocus;
    el.form.elements.sound.checked = state.settings.sound;
    setStatus(state.apiOnline ? 'The decrees are in force.' : 'Amendments are kept in the local scroll.');
  }

  function readSettingsForm() {
    const data = new FormData(el.form);
    const readNumber = (key, min, max, label) => {
      const raw = String(data.get(key) ?? '').trim();
      const value = Number(raw);
      if (!raw || !Number.isInteger(value)) {
        throw new Error(`${label} must be a whole number of minutes.`);
      }
      if (value < min || value > max) {
        throw new Error(`${label} must be between ${min} and ${max}.`);
      }
      return value;
    };
    return {
      focusMinutes: readNumber('focusMinutes', 1, 180, 'Study'),
      shortBreakMinutes: readNumber('shortBreakMinutes', 1, 60, 'Rest'),
      longBreakMinutes: readNumber('longBreakMinutes', 1, 90, 'Feast'),
      longBreakEvery: readNumber('longBreakEvery', 2, 12, 'Seals before the Feast'),
      autoStartBreaks: data.has('autoStartBreaks'),
      autoStartFocus: data.has('autoStartFocus'),
      sound: data.has('sound'),
    };
  }

  async function submitSettings(event) {
    event.preventDefault();
    let next;
    try {
      next = readSettingsForm();
    } catch (err) {
      setStatus(err.message, true);
      return;
    }

    const previous = state.settings;
    const result = await persistSettings(next);
    if (!result.ok) {
      // Keep the amended values in the form but do not enact them.
      setStatus(`The seal failed: ${result.error}`, true);
      toast('The royal seal cracked. Your amendments were not enacted.');
      return;
    }

    const currentKey = MODE_INFO[state.mode].setting;
    const currentChanged = previous[currentKey] !== state.settings[currentKey];
    applySettings({ resetCurrent: currentChanged && !state.running, announce: false });
    renderSettingsForm();
    setStatus('The decrees are sealed and in force.');
    toast('The royal decrees are sealed.');
  }

  async function restoreDefaults() {
    const result = await persistSettings({ ...DEFAULTS });
    if (!result.ok) {
      setStatus(`The seal failed: ${result.error}`, true);
      return;
    }
    applySettings({ resetCurrent: !state.running, announce: false });
    renderSettingsForm();
    setStatus('The old ways are restored.');
    toast('The old ways are restored.');
  }

  function applySettings({ resetCurrent, announce }) {
    if (resetCurrent) {
      state.totalMs = durationMs(state.mode);
      state.remainingMs = state.totalMs;
    }
    if (announce) {
      toast(`The decrees are amended: Study ${state.settings.focusMinutes}m · Rest ${state.settings.shortBreakMinutes}m · Feast ${state.settings.longBreakMinutes}m.`);
    }
    render();
  }

  /* ---------- Timer engine ---------- */

  function setMode(mode, { keepRunning = false } = {}) {
    if (!MODE_INFO[mode]) return;
    if (!keepRunning) stopTicker();
    state.running = false;
    state.mode = mode;
    state.totalMs = durationMs(mode);
    state.remainingMs = state.totalMs;
    state.lastSecond = null;
    el.timerCard.dataset.mode = mode;
    el.modeTabs.forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
    });
    render();
  }

  function start() {
    if (state.running) return;
    if (state.remainingMs <= 0) state.remainingMs = state.totalMs;
    state.endAt = Date.now() + state.remainingMs;
    state.running = true;
    stopTicker();
    state.ticker = setInterval(tick, 200);
    render();
  }

  function pause() {
    if (!state.running) return;
    state.remainingMs = Math.max(0, state.endAt - Date.now());
    state.running = false;
    stopTicker();
    render();
  }

  function toggle() {
    if (state.running) pause();
    else start();
  }

  function stopTicker() {
    if (state.ticker !== null) {
      clearInterval(state.ticker);
      state.ticker = null;
    }
  }

  function tick() {
    if (!state.running) return;
    state.remainingMs = Math.max(0, state.endAt - Date.now());
    if (state.remainingMs <= 0) {
      completeVigil();
      return;
    }
    render();
  }

  function resetTimer() {
    stopTicker();
    state.running = false;
    state.totalMs = durationMs(state.mode);
    state.remainingMs = state.totalMs;
    state.lastSecond = null;
    render();
  }

  function nextModeAfter(mode) {
    if (mode !== 'focus') return 'focus';
    state.completedInCycle += 1;
    return state.completedInCycle % state.settings.longBreakEvery === 0 ? 'long' : 'short';
  }

  function completeVigil() {
    const finishedMode = state.mode;
    const finishedSeconds = Math.max(1, Math.round(state.totalMs / 1000));
    state.running = false;
    stopTicker();
    state.remainingMs = 0;
    render();

    if (state.settings.sound) ringBell();

    const info = MODE_INFO[finishedMode];
    const next = nextModeAfter(finishedMode);
    recordSession(finishedMode, finishedSeconds);
    setMode(next);
    toast(
      finishedMode === 'focus'
        ? `The ${info.label.toLowerCase()} is complete. ${next === 'long' ? 'A Feast awaits!' : 'Rest a while, scribe.'}`
        : `The ${info.label.toLowerCase()} is done. Back to the desk!`
    );

    const autoKey = MODE_INFO[next].auto;
    if (state.settings[autoKey]) {
      clearTimeout(state.autoStartTimer);
      const expectedMode = next;
      state.autoStartTimer = setTimeout(() => {
        if (state.mode === expectedMode && !state.running) start();
      }, 900);
    }
  }

  function skipVigil() {
    const next = state.mode === 'focus' ? 'short' : 'focus';
    setMode(next);
    toast('The scribe skips ahead. The sands are reset.');
  }

  /* ---------- Rendering ---------- */

  function renderSeals() {
    const total = state.settings.longBreakEvery;
    const filled = state.mode === 'long' ? total : state.completedInCycle % total;
    const key = `${total}:${filled}`;
    if (key === state.lastSealKey) return;
    state.lastSealKey = key;
    el.seals.replaceChildren();
    for (let i = 0; i < total; i += 1) {
      const seal = document.createElement('span');
      seal.className = `seal${i < filled ? ' filled' : ''}`;
      seal.setAttribute('aria-hidden', 'true');
      el.seals.appendChild(seal);
    }
    el.seals.setAttribute('aria-label', `${filled} of ${total} seals until the Feast`);
  }

  function render() {
    const display = formatTime(state.remainingMs);
    if (display !== state.lastSecond) {
      state.lastSecond = display;
      el.timeDisplay.textContent = display;
      if (state.running) document.title = `${display} · ${MODE_INFO[state.mode].label} — The Scriptorium`;
    }

    const fraction = state.totalMs > 0 ? clamp(state.remainingMs / state.totalMs, 0, 1) : 0;
    el.ringProgress.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));

    const info = MODE_INFO[state.mode];
    el.modeLabel.textContent = info.label;
    const minutes = Math.max(1, Math.round(state.totalMs / 60000));
    el.dialSub.textContent = `of ${minutes} minute${minutes === 1 ? '' : 's'}`;

    el.timerCard.classList.toggle('running', state.running);
    el.startBtn.textContent = state.running
      ? 'Pause the Vigil'
      : state.remainingMs > 0 && state.remainingMs < state.totalMs
        ? 'Resume the Vigil'
        : 'Begin the Vigil';

    if (!state.running) document.title = BASE_TITLE;
    renderSeals();
  }

  /* ---------- Ledger ---------- */

  const GLYPHS = { focus: '✒', short: '☕', long: '🍗' };

  function formatLedgerDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'an unknown hour';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function renderLedger(sessions) {
    el.ledgerList.replaceChildren();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'ledger-empty';
      empty.textContent = 'No vigils recorded yet. The parchment awaits.';
      el.ledgerList.appendChild(empty);
      return;
    }

    for (const session of sessions.slice(0, 30)) {
      const info = MODE_INFO[session.mode] || { label: session.mode, glyph: '•' };
      const li = document.createElement('li');
      li.dataset.mode = session.mode;

      const glyph = document.createElement('span');
      glyph.className = 'ledger-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = GLYPHS[session.mode] || '•';

      const main = document.createElement('div');
      main.className = 'ledger-main';
      const title = document.createElement('div');
      title.className = 'ledger-title';
      title.textContent = `${info.label} vigil`;
      const meta = document.createElement('div');
      meta.className = 'ledger-meta';
      meta.textContent = formatLedgerDate(session.completedAt);
      main.append(title, meta);

      const time = document.createElement('span');
      time.className = 'ledger-time';
      const minutes = Math.max(1, Math.round(session.durationSeconds / 60));
      time.textContent = `${minutes} min`;

      li.append(glyph, main, time);
      el.ledgerList.appendChild(li);
    }
  }

  async function loadLedger() {
    try {
      const res = await fetch('/api/sessions', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      renderLedger(data.sessions);
    } catch {
      const empty = document.createElement('li');
      empty.className = 'ledger-empty';
      empty.textContent = 'The ledger is beyond the castle walls; the royal courier is away.';
      el.ledgerList.replaceChildren(empty);
    }
  }

  async function recordSession(mode, durationSeconds) {
    const entry = { mode, durationSeconds, completedAt: new Date().toISOString() };
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadLedger();
    } catch {
      toast('The ledger could not be reached; this vigil is unrecorded.');
    }
  }

  async function clearLedger() {
    if (!window.confirm('Burn the ledger? All recorded vigils will be lost to the flames.')) return;
    try {
      const res = await fetch('/api/sessions', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      renderLedger([]);
      toast('The ledger is ash. A fresh parchment awaits.');
    } catch {
      toast('The flames would not catch; the ledger remains.');
    }
  }

  /* ---------- The chapel bell ---------- */

  let audioContext = null;

  function ringBell() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioContext = audioContext || new Ctx();
      if (audioContext.state === 'suspended') audioContext.resume();

      const now = audioContext.currentTime + 0.02;
      const partials = [
        { freq: 523.25, gain: 0.22, decay: 2.6 },
        { freq: 659.25, gain: 0.16, decay: 2.2 },
        { freq: 783.99, gain: 0.12, decay: 1.9 },
        { freq: 1046.5, gain: 0.07, decay: 1.4 },
      ];

      for (const partial of partials) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(partial.freq, now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(partial.gain, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + partial.decay);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(now);
        osc.stop(now + partial.decay + 0.1);
      }
    } catch {
      /* silence is also a medieval virtue */
    }
  }

  /* ---------- Wiring ---------- */

  el.modeTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      clearTimeout(state.autoStartTimer);
      setMode(tab.dataset.mode);
    });
  });

  el.startBtn.addEventListener('click', () => {
    clearTimeout(state.autoStartTimer);
    toggle();
  });
  el.resetBtn.addEventListener('click', () => {
    clearTimeout(state.autoStartTimer);
    resetTimer();
    toast('The sands are returned to the top.');
  });
  el.skipBtn.addEventListener('click', () => {
    clearTimeout(state.autoStartTimer);
    skipVigil();
  });

  el.form.addEventListener('submit', submitSettings);
  el.form.addEventListener('input', () => {
    setStatus('Amendments await the royal seal.');
  });
  el.defaultsBtn.addEventListener('click', restoreDefaults);
  el.clearLedgerBtn.addEventListener('click', clearLedger);

  document.querySelectorAll('.step').forEach((button) => {
    button.addEventListener('click', () => {
      const input = el.form.elements[button.dataset.target];
      if (!input) return;
      const delta = Number(button.dataset.delta) || 0;
      const min = Number(input.min) || 0;
      const max = Number(input.max) || 999;
      const current = Number(input.value) || min;
      input.value = String(clamp(current + delta, min, max));
      setStatus('Amendments await the royal seal.');
    });
  });

  document.addEventListener('keydown', (event) => {
    const tag = (event.target && event.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(tag) || event.target.isContentEditable) return;
    if (event.code === 'Space') {
      event.preventDefault();
      clearTimeout(state.autoStartTimer);
      toggle();
    } else if (event.key === 'r' || event.key === 'R') {
      clearTimeout(state.autoStartTimer);
      resetTimer();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.running) tick();
  });

  window.addEventListener('beforeunload', () => {
    if (state.settings.sound && audioContext) audioContext.close().catch(() => {});
  });

  /* ---------- The scribe takes up the quill ---------- */

  setMode('focus');
  loadSettings().then(loadLedger);
})();