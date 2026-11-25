// prepMASTER cloud sync: GitHub Pages hosts the app; Firebase stores private user data.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, onSnapshot, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD3LRduma8s6Wg_0x9ifQmzg4mXbl-6Owo",
    authDomain: "prepmaster-324ac.firebaseapp.com",
    projectId: "prepmaster-324ac",
    storageBucket: "prepmaster-324ac.firebasestorage.app",
    messagingSenderId: "561214719051",
    appId: "1:561214719051:web:2f06baa552528b347fb9ce",
    measurementId: "G-CKC571DL3C"
  };

let firebaseAuth = null;
let firestore = null;
let cloudUser = null;
let stopSessionsListener = null;
let stopSettingsListener = null;
let cloudBusy = false;

function firebaseIsConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_") &&
    firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("PASTE_");
}

function setCloudStatus(message, connected = false) {
  const status = document.getElementById("cloudStatus");
  status.innerHTML = `<i></i> ${message}`;
  status.classList.toggle("connected", connected);
  const button = document.getElementById("cloudBtn");
  button.textContent = connected ? "Disconnect sync" : "Connect Google to sync";
}

async function initCloudSync() {
  const button = document.getElementById("cloudBtn");
  if (!firebaseIsConfigured()) {
    setCloudStatus("Local only");
    button.addEventListener("click", () => {
      showMessage("cloudMessage", "Cloud sync needs a one-time Firebase setup. Follow README.md, then add your Firebase web config in app.js.", true);
    });
    return;
  }

  try {
    const app = initializeApp(firebaseConfig);
    firebaseAuth = getAuth(app);
    firestore = getFirestore(app);

    button.addEventListener("click", async () => {
      if (!firebaseAuth) return;
      if (cloudUser) {
        await signOut(firebaseAuth);
      } else {
        try {
          const provider = new GoogleAuthProvider();
          provider.setCustomParameters({ prompt: "select_account" });
          await signInWithPopup(firebaseAuth, provider);
        } catch (error) {
          showMessage("cloudMessage", `Google sign-in failed: ${error.message}`, true);
        }
      }
    });

    onAuthStateChanged(firebaseAuth, async user => {
      cloudUser = user || null;
      if (stopSessionsListener) stopSessionsListener();
      if (stopSettingsListener) stopSettingsListener();
      stopSessionsListener = null;
      stopSettingsListener = null;

      if (!user) {
        setCloudStatus("Local only");
        showMessage("cloudMessage", "Your local records remain on this device.");
        return;
      }

      setCloudStatus(`Syncing ${user.displayName || user.email || "account"}…`, true);
      try {
        await connectUserCloud(user);
      } catch (error) {
        setCloudStatus("Sync paused");
        showMessage("cloudMessage", `Cloud sync issue: ${error.message}`, true);
      }
    });
  } catch (error) {
    setCloudStatus("Sync unavailable");
    showMessage("cloudMessage", `Firebase setup error: ${error.message}`, true);
  }
}

function userSessionsRef(user) {
  return collection(firestore, "users", user.uid, "sessions");
}
function userSettingsRef(user) {
  return doc(firestore, "users", user.uid, "settings", "main");
}

function newSessionId() {
  return (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : `s${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function localSettingsPayload() {
  return {
    examDate,
    pomoDurations,
    pomoFocusCount,
    updatedAt: new Date().toISOString()
  };
}

async function syncSettingsToCloud() {
  if (!cloudUser || !firestore || cloudBusy) return;
  try {
    await setDoc(userSettingsRef(cloudUser), localSettingsPayload(), { merge: true });
    showMessage("cloudMessage", "Settings synced.");
  } catch (error) {
    showMessage("cloudMessage", `Settings are saved locally; cloud sync failed: ${error.message}`, true);
  }
}

async function connectUserCloud(user) {
  if (cloudBusy) return;
  cloudBusy = true;
  try {
    const sessionsRef = userSessionsRef(user);
    const existingSnapshot = await getDocs(sessionsRef);
    const cloudIds = new Set(existingSnapshot.docs.map(item => item.id));

    // Migrate this browser's existing local history to the signed-in cloud profile.
    for (const item of sessions) {
      if (!item.syncId) item.syncId = newSessionId();
      if (!cloudIds.has(item.syncId)) {
        const { syncId, ...payload } = item;
        await setDoc(doc(sessionsRef, syncId), { ...payload, syncId });
      }
    }

    const settingsRef = userSettingsRef(user);
    const settingsSnapshot = await getDoc(settingsRef);
    if (settingsSnapshot.exists()) {
      const remote = settingsSnapshot.data();
      examDate = remote.examDate || examDate;
      if (remote.pomoDurations) {
        pomoDurations = {
          focus: clamp(remote.pomoDurations.focus, 1, 180, 25),
          shortBreak: clamp(remote.pomoDurations.shortBreak, 1, 60, 5),
          longBreak: clamp(remote.pomoDurations.longBreak, 1, 90, 15)
        };
        $("customFocus").value = pomoDurations.focus;
        $("customBreak").value = pomoDurations.shortBreak;
        $("customLong").value = pomoDurations.longBreak;
      }
      if (Number.isFinite(remote.pomoFocusCount)) pomoFocusCount = remote.pomoFocusCount;
      if (examDate) $("examDate").value = examDate;
      updateCountdown();
      renderPomo();
      persist();
    } else {
      await setDoc(settingsRef, localSettingsPayload());
    }

    stopSessionsListener = onSnapshot(sessionsRef, snapshot => {
      sessions = snapshot.docs.map(item => ({ ...item.data(), syncId: item.id }));
      sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      persist();
      renderStats();
      renderHistory();
      setCloudStatus("Synced", true);
    }, error => {
      setCloudStatus("Sync paused");
      showMessage("cloudMessage", `Could not read cloud history: ${error.message}`, true);
    });

    stopSettingsListener = onSnapshot(settingsRef, snapshot => {
      if (!snapshot.exists()) return;
      const remote = snapshot.data();
      if (remote.examDate && remote.examDate !== examDate) {
        examDate = remote.examDate;
        $("examDate").value = examDate;
        updateCountdown();
      }
      if (remote.pomoDurations) {
        pomoDurations = {
          focus: clamp(remote.pomoDurations.focus, 1, 180, 25),
          shortBreak: clamp(remote.pomoDurations.shortBreak, 1, 60, 5),
          longBreak: clamp(remote.pomoDurations.longBreak, 1, 90, 15)
        };
        $("customFocus").value = pomoDurations.focus;
        $("customBreak").value = pomoDurations.shortBreak;
        $("customLong").value = pomoDurations.longBreak;
        if (!pomoRunning) pomoRemaining = currentPomoDuration();
        renderPomo();
      }
      if (Number.isFinite(remote.pomoFocusCount)) {
        pomoFocusCount = remote.pomoFocusCount;
        renderPomo();
      }
      persist();
    }, error => {
      showMessage("cloudMessage", `Could not read cloud settings: ${error.message}`, true);
    });

    setCloudStatus("Synced", true);
    showMessage("cloudMessage", "Connected. Saved sessions and settings now sync across your devices.");
    persist();
  } finally {
    cloudBusy = false;
  }
}

async function saveSessionToCloud(session) {
  if (!cloudUser || !firestore) return;
  try {
    if (!session.syncId) session.syncId = newSessionId();
    const { syncId, ...payload } = session;
    await setDoc(doc(userSessionsRef(cloudUser), syncId), { ...payload, syncId });
    setCloudStatus("Synced", true);
  } catch (error) {
    setCloudStatus("Local save");
    showMessage("cloudMessage", `Saved on this device; cloud upload failed: ${error.message}`, true);
  }
}

// prepMASTER v2 — no sign-in. Data is stored locally in this browser.
const $ = id => document.getElementById(id);
const STORAGE_KEY = "prepMASTER_local_data_v1";
const RING_CIRCUMFERENCE = 2 * Math.PI * 96;

let sessions = [];
let examDate = "";
let elapsedBeforeStart = 0;
let startedAt = null;
let running = false;
let ticker = null;

// Pomodoro state
let pomoDurations = { focus: 25, shortBreak: 5, longBreak: 15 };
let pomoMode = "focus";
let pomoRemaining = 25 * 60;
let pomoEndsAt = null;
let pomoRunning = false;
let pomoFocusCount = 0;
let pomoTicker = null;
let lastCountdownValues = {};

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.error("prepMASTER could not read local data:", error);
    return {};
  }
}

function persist() {
  const state = {
    sessions, examDate, elapsedBeforeStart, startedAt, running,
    pomoDurations, pomoMode, pomoRemaining, pomoEndsAt, pomoRunning, pomoFocusCount
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    showMessage("timerMessage", "Could not save data. Check your browser storage.", true);
  }
}

function restore() {
  const saved = readStore();
  sessions = Array.isArray(saved.sessions) ? saved.sessions : [];
  examDate = typeof saved.examDate === "string" ? saved.examDate : "";
  elapsedBeforeStart = Math.max(0, Number(saved.elapsedBeforeStart) || 0);
  startedAt = saved.startedAt ? Number(saved.startedAt) : null;
  running = Boolean(saved.running && startedAt);

  if (examDate) $("examDate").value = examDate;

  if (saved.pomoDurations) {
    pomoDurations = {
      focus: clamp(saved.pomoDurations.focus, 1, 180, 25),
      shortBreak: clamp(saved.pomoDurations.shortBreak, 1, 60, 5),
      longBreak: clamp(saved.pomoDurations.longBreak, 1, 90, 15)
    };
  }
  pomoMode = ["focus", "shortBreak", "longBreak"].includes(saved.pomoMode) ? saved.pomoMode : "focus";
  pomoRemaining = Number.isFinite(saved.pomoRemaining) ? Math.max(0, saved.pomoRemaining) : pomoDurations[pomoMode] * 60;
  pomoEndsAt = saved.pomoEndsAt ? Number(saved.pomoEndsAt) : null;
  pomoRunning = Boolean(saved.pomoRunning && pomoEndsAt);
  pomoFocusCount = Math.max(0, Number(saved.pomoFocusCount) || 0);

  if (running) startMainTicker();
  if (pomoRunning) {
    // A running Pomodoro resumes using its saved end timestamp.
    if (pomoEndsAt <= Date.now()) completePomoPhase();
    else startPomoTicker();
  }

  $("customFocus").value = pomoDurations.focus;
  $("customBreak").value = pomoDurations.shortBreak;
  $("customLong").value = pomoDurations.longBreak;
  updateCountdown();
  renderStats();
  renderHistory();
  drawMainTimer();
  setMainTimerUI();
  renderPomo();
  updateTodayLabel();
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function showMessage(id, message, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.style.color = error ? "#ff9b9b" : "#ff8099";
}

function formatTime(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function formatPomoTime(seconds) {
  seconds = Math.max(0, Math.ceil(seconds));
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function updateTodayLabel() {
  $("todayLabel").textContent = new Date().toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

// ----- JEE live countdown -----
function animateCountdownValue(id, value) {
  const el = $(id);
  const text = String(value).padStart(2, "0");
  if (lastCountdownValues[id] !== text) {
    el.textContent = text;
    el.classList.remove("tick");
    void el.offsetWidth;
    el.classList.add("tick");
    lastCountdownValues[id] = text;
  }
}

function updateCountdown() {
  const value = $("examDate").value || examDate;
  if (!value) {
    $("countdown").textContent = "Set your exam date";
    $("countdownSub").textContent = "Choose your target date to start the live countdown.";
    ["cdDays", "cdHours", "cdMinutes", "cdSeconds"].forEach(id => animateCountdownValue(id, "--"));
    $("countdownProgress").style.width = "0%";
    return;
  }

  const target = new Date(`${value}T00:00:00`);
  const remainingMs = target.getTime() - Date.now();
  if (remainingMs <= 0) {
    $("countdown").textContent = remainingMs > -86400000 ? "Your target date is here" : "Target date has passed";
    $("countdownSub").textContent = target.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
    ["cdDays", "cdHours", "cdMinutes", "cdSeconds"].forEach(id => animateCountdownValue(id, "00"));
    $("countdownProgress").style.width = "100%";
    return;
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  $("countdown").textContent = `${days} ${days === 1 ? "day" : "days"} remaining`;
  $("countdownSub").textContent = `Until ${target.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })} · Updates every second`;
  animateCountdownValue("cdDays", days);
  animateCountdownValue("cdHours", hours);
  animateCountdownValue("cdMinutes", minutes);
  animateCountdownValue("cdSeconds", seconds);

  // Decorative countdown indicator pulses as the seconds update.
  $("countdownProgress").style.width = `${Math.max(8, 100 - (seconds / 60) * 92)}%`;
}

function saveExamDate() {
  const selected = $("examDate").value;
  if (!selected) {
    showMessage("timerMessage", "Choose a target date first.", true);
    return;
  }
  examDate = selected;
  persist();
  updateCountdown();
  syncSettingsToCloud();
  showMessage("timerMessage", "JEE target date saved.");
}

// ----- Shared study history -----
function renderStats() {
  const today = new Date().toLocaleDateString();
  const todaySeconds = sessions
    .filter(s => new Date(s.createdAt).toLocaleDateString() === today)
    .reduce((sum, s) => sum + s.duration, 0);
  $("todayTotal").textContent = formatTime(todaySeconds);
  $("allTotal").textContent = formatTime(sessions.reduce((sum, s) => sum + s.duration, 0));
  $("sessionCount").textContent = sessions.length;
}

function renderHistory() {
  const body = $("historyBody");
  body.innerHTML = "";
  if (!sessions.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">No sessions yet. Start your first timer!</td></tr>';
    return;
  }

  sessions.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 40).forEach(s => {
    const row = document.createElement("tr");
    const date = new Date(s.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    [date, s.subject || "Other", s.topic || "—", formatTime(s.duration), s.source || "Stopwatch"].forEach(value => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

function addStudySession(duration, source) {
  const session = {
    syncId: newSessionId(),
    duration: Math.max(1, Math.floor(duration)),
    subject: $("subject").value,
    topic: $("topic").value.trim(),
    source,
    createdAt: new Date().toISOString()
  };
  sessions.push(session);
  persist();
  renderStats();
  renderHistory();
  saveSessionToCloud(session);
}

// ----- Study stopwatch -----
function mainElapsed() {
  return elapsedBeforeStart + (running && startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0);
}

function drawMainTimer() {
  $("timerDisplay").textContent = formatTime(mainElapsed());
}

function setMainTimerUI() {
  $("startBtn").disabled = running;
  $("pauseBtn").disabled = !running;
  $("saveSessionBtn").disabled = mainElapsed() < 1;
  $("timerStatus").textContent = running ? "Focus session in progress" : "Ready when you are";
  $("timerDot").classList.toggle("running", running);
}

function startMainTicker() {
  if (ticker) clearInterval(ticker);
  ticker = setInterval(() => {
    drawMainTimer();
    setMainTimerUI();
    persist();
  }, 1000);
}

function startMainTimer() {
  if (running) return;
  startedAt = Date.now();
  running = true;
  startMainTicker();
  drawMainTimer();
  setMainTimerUI();
  persist();
}

function pauseMainTimer() {
  if (!running) return;
  elapsedBeforeStart = mainElapsed();
  startedAt = null;
  running = false;
  if (ticker) clearInterval(ticker);
  ticker = null;
  drawMainTimer();
  setMainTimerUI();
  persist();
}

function resetMainTimer() {
  if (ticker) clearInterval(ticker);
  ticker = null;
  elapsedBeforeStart = 0;
  startedAt = null;
  running = false;
  drawMainTimer();
  setMainTimerUI();
  persist();
  showMessage("timerMessage", "Stopwatch reset.");
}

function saveMainSession() {
  if (running) pauseMainTimer();
  const duration = mainElapsed();
  if (duration < 1) return;
  addStudySession(duration, "Stopwatch");
  elapsedBeforeStart = 0;
  startedAt = null;
  running = false;
  drawMainTimer();
  setMainTimerUI();
  $("topic").value = "";
  showMessage("timerMessage", "Study session saved.");
  persist();
}

// ----- Pomodoro timer -----
function currentPomoDuration() {
  return pomoDurations[pomoMode] * 60;
}

function setPomoMode(mode, announce = true) {
  if (!["focus", "shortBreak", "longBreak"].includes(mode)) return;
  stopPomoTicker();
  pomoMode = mode;
  pomoRunning = false;
  pomoEndsAt = null;
  pomoRemaining = currentPomoDuration();
  renderPomo();
  setActivePomoButtons();
  persist();
  if (announce) showMessage("pomoMessage", `${modeLabel(mode)} selected.`);
}

function modeLabel(mode) {
  return mode === "focus" ? "Focus session" : mode === "shortBreak" ? "Short break" : "Long break";
}

function startPomoTicker() {
  stopPomoTicker();
  pomoTicker = setInterval(() => {
    pomoRemaining = Math.max(0, Math.ceil((pomoEndsAt - Date.now()) / 1000));
    renderPomo();
    if (pomoRemaining <= 0) completePomoPhase();
    else if (pomoRemaining % 5 === 0) persist();
  }, 200);
}

function stopPomoTicker() {
  if (pomoTicker) clearInterval(pomoTicker);
  pomoTicker = null;
}

function startPomo() {
  if (pomoRunning) return;
  if (pomoRemaining <= 0) pomoRemaining = currentPomoDuration();
  pomoEndsAt = Date.now() + pomoRemaining * 1000;
  pomoRunning = true;
  startPomoTicker();
  renderPomo();
  setActivePomoButtons();
  persist();
  showMessage("pomoMessage", `${modeLabel(pomoMode)} started.`);
}

function pausePomo() {
  if (!pomoRunning) return;
  pomoRemaining = Math.max(0, Math.ceil((pomoEndsAt - Date.now()) / 1000));
  pomoRunning = false;
  pomoEndsAt = null;
  stopPomoTicker();
  renderPomo();
  setActivePomoButtons();
  persist();
  showMessage("pomoMessage", "Pomodoro paused.");
}

function resetPomo() {
  stopPomoTicker();
  pomoRunning = false;
  pomoEndsAt = null;
  pomoRemaining = currentPomoDuration();
  renderPomo();
  setActivePomoButtons();
  persist();
  showMessage("pomoMessage", "Current Pomodoro phase reset.");
}

function completePomoPhase() {
  if (!pomoRunning && pomoRemaining > 0) return;
  const completedMode = pomoMode;
  pomoRunning = false;
  pomoEndsAt = null;
  stopPomoTicker();

  if (completedMode === "focus") {
    // A completed focus interval is automatically added to the study history.
    addStudySession(pomoDurations.focus * 60, "Pomodoro");
    pomoFocusCount += 1;
    const nextMode = pomoFocusCount % 4 === 0 ? "longBreak" : "shortBreak";
    pomoMode = nextMode;
    pomoRemaining = currentPomoDuration();
    showMessage("pomoMessage", `Focus interval complete. ${modeLabel(nextMode)} is ready.`);
  } else {
    pomoMode = "focus";
    pomoRemaining = currentPomoDuration();
    showMessage("pomoMessage", "Break complete. Ready for your next focus interval.");
  }

  renderPomo();
  setActivePomoButtons();
  persist();
  syncSettingsToCloud();
}

function skipPomoPhase() {
  if (pomoRunning && pomoMode === "focus") {
    // Skipping an unfinished focus interval does not add study time.
  }
  pomoRunning = false;
  pomoEndsAt = null;
  stopPomoTicker();
  if (pomoMode === "focus") {
    pomoMode = pomoFocusCount > 0 && pomoFocusCount % 4 === 0 ? "longBreak" : "shortBreak";
  } else {
    pomoMode = "focus";
  }
  pomoRemaining = currentPomoDuration();
  renderPomo();
  setActivePomoButtons();
  persist();
  showMessage("pomoMessage", `${modeLabel(pomoMode)} is ready.`);
}

function renderPomo() {
  if (pomoRunning && pomoEndsAt) {
    pomoRemaining = Math.max(0, Math.ceil((pomoEndsAt - Date.now()) / 1000));
  }
  $("pomoTime").textContent = formatPomoTime(pomoRemaining);
  $("pomoModeLabel").textContent = pomoMode === "focus" ? "FOCUS SESSION" : pomoMode === "shortBreak" ? "SHORT BREAK" : "LONG BREAK";
  $("pomoCycle").textContent = `CYCLE ${(pomoFocusCount % 4) + 1} · 4`;
  $("pomoDescription").textContent = pomoMode === "focus"
    ? "Time to focus. One task, no distractions."
    : pomoMode === "shortBreak"
      ? "Take a breath, stretch, and reset."
      : "You earned a longer break. Recharge.";
  const total = currentPomoDuration();
  const progress = total > 0 ? Math.min(1, Math.max(0, pomoRemaining / total)) : 0;
  $("pomoRing").style.strokeDasharray = String(RING_CIRCUMFERENCE);
  $("pomoRing").style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress));
  $("pomoStartBtn").textContent = pomoRunning ? "Running…" : pomoMode === "focus" ? "Start focus" : "Start break";
  $("pomoPauseBtn").disabled = !pomoRunning;
  document.querySelectorAll(".mode-tab").forEach(btn => btn.classList.toggle("active", btn.dataset.mode === pomoMode));
  document.querySelectorAll(".preset").forEach(btn => {
    const active = Number(btn.dataset.focus) === pomoDurations.focus &&
      Number(btn.dataset.break) === pomoDurations.shortBreak &&
      Number(btn.dataset.long) === pomoDurations.longBreak;
    btn.classList.toggle("active", active);
  });
  const dots = $("cycleDots").querySelectorAll("i");
  dots.forEach((dot, index) => dot.classList.toggle("filled", index < (pomoFocusCount % 4)));
}

function setActivePomoButtons() {
  $("pomoStartBtn").disabled = pomoRunning;
  $("pomoPauseBtn").disabled = !pomoRunning;
}

function applyPreset(focus, shortBreak, longBreak) {
  if (pomoRunning) pausePomo();
  pomoDurations = { focus, shortBreak, longBreak };
  $("customFocus").value = focus;
  $("customBreak").value = shortBreak;
  $("customLong").value = longBreak;
  pomoRemaining = currentPomoDuration();
  renderPomo();
  persist();
  syncSettingsToCloud();
  showMessage("pomoMessage", `${focus}/${shortBreak}/${longBreak} minute routine applied.`);
}

function applyCustomDurations() {
  const focus = clamp($("customFocus").value, 1, 180, 25);
  const shortBreak = clamp($("customBreak").value, 1, 60, 5);
  const longBreak = clamp($("customLong").value, 1, 90, 15);
  $("customFocus").value = focus;
  $("customBreak").value = shortBreak;
  $("customLong").value = longBreak;
  applyPreset(focus, shortBreak, longBreak);
}

function bindEvents() {
  $("saveDateBtn").addEventListener("click", saveExamDate);
  $("examDate").addEventListener("change", updateCountdown);

  $("startBtn").addEventListener("click", startMainTimer);
  $("pauseBtn").addEventListener("click", pauseMainTimer);
  $("resetBtn").addEventListener("click", resetMainTimer);
  $("saveSessionBtn").addEventListener("click", saveMainSession);

  $("pomoStartBtn").addEventListener("click", startPomo);
  $("pomoPauseBtn").addEventListener("click", pausePomo);
  $("pomoResetBtn").addEventListener("click", resetPomo);
  $("pomoSkipBtn").addEventListener("click", skipPomoPhase);
  $("applyCustomBtn").addEventListener("click", applyCustomDurations);

  document.querySelectorAll(".preset").forEach(btn => {
    btn.addEventListener("click", () => applyPreset(
      Number(btn.dataset.focus), Number(btn.dataset.break), Number(btn.dataset.long)
    ));
  });
  document.querySelectorAll(".mode-tab").forEach(btn => {
    btn.addEventListener("click", () => setPomoMode(btn.dataset.mode));
  });

  $("refreshBtn").addEventListener("click", () => {
    const saved = readStore();
    sessions = Array.isArray(saved.sessions) ? saved.sessions : sessions;
    renderStats();
    renderHistory();
    updateCountdown();
    showMessage("timerMessage", "Study history refreshed.");
  });

  window.addEventListener("beforeunload", persist);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      updateCountdown();
      if (pomoRunning) renderPomo();
      drawMainTimer();
    }
  });
}

bindEvents();
restore();
initCloudSync();
setInterval(updateCountdown, 1000);
setInterval(updateTodayLabel, 60 * 1000);
