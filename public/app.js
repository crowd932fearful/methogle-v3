"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const TOPICS = [
  ["mixed", "Mixed Methods"],
  ["functions", "Functions"],
  ["calculus", "Calculus"],
  ["trigonometry", "Trigonometry"],
  ["exponentials", "Exponentials & Logs"],
  ["sequences", "Sequences & Series"],
  ["probability", "Probability"],
  ["statistics", "Statistics"]
];

const state = {
  config: null,
  user: null,
  profile: null,
  identity: null,
  authMode: "login",
  selectedMode: null,
  selectedTopic: "mixed",
  currentMatch: null,
  currentQuestion: null,
  selectedAnswer: null,
  lastMode: "casual",
  queueStartedAt: 0,
  queueInterval: null,
  timerInterval: null,
  timerDeadline: 0,
  timerDuration: 30_000,
  roundEnded: false,
  soundEnabled: localStorage.getItem("methogle_sound") === "on",
  guestName: localStorage.getItem("methogle_guest_name") || `Guest${Math.floor(100 + Math.random() * 900)}`
};

class SoundEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.musicTimer = null;
    this.step = 0;
    this.enabled = false;
  }

  async ensure() {
    if (!this.context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = 0.12;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") await this.context.resume();
    return true;
  }

  tone(frequency, duration = .12, type = "sine", gainValue = .13, delay = 0) {
    if (!this.enabled || !this.context || !this.master) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + .015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + .03);
  }

  sfx(name) {
    if (!this.enabled) return;
    if (name === "click") this.tone(420, .07, "sine", .06);
    if (name === "match") {
      this.tone(392, .12, "triangle", .12, 0);
      this.tone(523, .14, "triangle", .12, .11);
      this.tone(659, .22, "triangle", .13, .22);
    }
    if (name === "correct") {
      this.tone(523, .1, "sine", .11, 0);
      this.tone(659, .11, "sine", .1, .08);
      this.tone(784, .17, "sine", .1, .16);
    }
    if (name === "wrong") {
      this.tone(220, .12, "sawtooth", .07, 0);
      this.tone(174, .2, "sawtooth", .06, .1);
    }
    if (name === "win") {
      [392, 523, 659, 784].forEach((frequency, index) => this.tone(frequency, .24, "triangle", .1, index * .11));
    }
  }

  musicTick() {
    if (!this.enabled || !this.context) return;
    const progression = [
      [130.81, 196, 261.63],
      [146.83, 220, 293.66],
      [110, 164.81, 220],
      [123.47, 185, 246.94]
    ];
    const chord = progression[Math.floor(this.step / 4) % progression.length];
    const note = chord[this.step % chord.length];
    this.tone(note, .55, "sine", .026);
    if (this.step % 4 === 0) this.tone(chord[0] / 2, .8, "triangle", .018);
    this.step += 1;
  }

  async enable() {
    const ready = await this.ensure();
    if (!ready) return;
    this.enabled = true;
    this.musicTick();
    clearInterval(this.musicTimer);
    this.musicTimer = setInterval(() => this.musicTick(), 520);
  }

  disable() {
    this.enabled = false;
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

const sound = new SoundEngine();
const socket = io({ auth: { guestName: state.guestName } });

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initials(name) {
  return String(name || "M").trim().charAt(0).toUpperCase() || "M";
}

function capitalise(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toast(message, type = "success", duration = 3800) {
  const element = document.createElement("div");
  element.className = `toast ${type === "error" ? "error" : ""}`;
  element.innerHTML = `<p>${escapeHtml(message)}</p>`;
  $("#toastStack").appendChild(element);
  setTimeout(() => element.remove(), duration);
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add("hidden");
  if (!$(".modal-backdrop:not(.hidden)")) document.body.classList.remove("modal-open");
}

function closeAllModals() {
  $$(".modal-backdrop").forEach((modal) => modal.classList.add("hidden"));
  document.body.classList.remove("modal-open");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(body.message || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return body;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  $("#authLoginTab").classList.toggle("active", !signup);
  $("#authSignupTab").classList.toggle("active", signup);
  $("#usernameField").classList.toggle("hidden", !signup);
  $("#authTitle").textContent = signup ? "Create your account" : "Welcome back";
  $("#authIntro").textContent = signup
    ? "Save your ELO, XP, match history and progress across devices."
    : "Log in to enter ranked matches and continue your climb.";
  $("#authSubmit").textContent = signup ? "Create account" : "Log in";
  $("#authPassword").autocomplete = signup ? "new-password" : "current-password";
  $("#authMessage").textContent = "";
  $("#authMessage").classList.remove("success");
}

function showAuth(mode = "login") {
  setAuthMode(mode);
  openModal("authModal");
  setTimeout(() => $(mode === "signup" ? "#authUsername" : "#authEmail").focus(), 50);
}

async function submitAuth(event) {
  event.preventDefault();
  const button = $("#authSubmit");
  const message = $("#authMessage");
  const body = {
    email: $("#authEmail").value.trim(),
    password: $("#authPassword").value
  };
  if (state.authMode === "signup") body.username = $("#authUsername").value.trim();
  button.disabled = true;
  message.textContent = "";
  try {
    if (state.authMode === "signup") {
      const result = await api("/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
      message.classList.add("success");
      message.textContent = result.message;
      if (result.signedIn) {
        await loadSession();
        refreshSocketIdentity();
        closeModal("authModal");
        toast("Account created. Welcome to Methogle.");
      } else {
        setTimeout(() => setAuthMode("login"), 2800);
      }
    } else {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
      await loadSession();
      refreshSocketIdentity();
      closeModal("authModal");
      toast(`Welcome back, ${state.profile?.username || "solver"}.`);
    }
  } catch (error) {
    message.classList.remove("success");
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function loadSession() {
  try {
    const result = await api("/api/auth/me");
    state.user = result.user;
    state.profile = result.profile;
  } catch (error) {
    if (error.status !== 401) console.warn(error);
    state.user = null;
    state.profile = null;
  }
  updateAccountUi();
  await loadProgress();
  return state.profile;
}

function refreshSocketIdentity() {
  if (state.currentMatch) return;
  if (socket.connected) socket.disconnect();
  socket.connect();
}

function updateAccountUi() {
  const loggedIn = Boolean(state.profile);
  $("#loginButton").classList.toggle("hidden", loggedIn);
  $("#accountButton").classList.toggle("hidden", loggedIn);
  $("#profileButton").classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    const name = state.profile.username;
    $("#profileInitial").textContent = initials(name);
    $("#modalAvatar").textContent = initials(name);
    $("#modalUsername").textContent = name;
    $("#modalRating").textContent = `${state.profile.rating} ELO · Level ${state.profile.level || 1}`;
  }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch { /* no-op */ }
  state.user = null;
  state.profile = null;
  updateAccountUi();
  refreshSocketIdentity();
  await loadProgress();
  closeModal("profileModal");
  toast("You are logged out.");
}

async function loadConfig() {
  try {
    state.config = await api("/api/config");
    if (!state.config.accountsConfigured) {
      toast("Accounts are not connected yet. Guest modes still work.", "error", 6000);
    }
  } catch (error) {
    console.warn(error);
  }
}

async function loadLeaderboard() {
  const container = $("#leaderboardRows");
  try {
    const { leaderboard } = await api("/api/leaderboard");
    if (!leaderboard.length) {
      container.innerHTML = `<div class="leaderboard-loading">No ranked players yet. Be the first.</div>`;
      return;
    }
    container.innerHTML = leaderboard.map((player, index) => {
      const record = `${player.wins || 0}W · ${player.losses || 0}L`;
      return `<div class="leaderboard-row">
        <div class="rank-number ${index < 3 ? "podium" : ""}">${index + 1}</div>
        <div class="player-cell"><div class="mini-avatar">${escapeHtml(initials(player.username))}</div><div><strong>${escapeHtml(player.username)}${player.pro ? '<span class="pro-tag">PRO</span>' : ""}</strong><small>${player.games || 0} games</small></div></div>
        <div class="record-cell">${record}</div>
        <div class="level-cell">Level ${player.level || 1}</div>
        <div class="rating-cell">${player.rating || 1000}</div>
      </div>`;
    }).join("");
  } catch (error) {
    container.innerHTML = `<div class="leaderboard-loading">${escapeHtml(error.message)}</div>`;
  }
}

function updateProgressCard(profile, recent = []) {
  if (!profile) {
    $("#progressAvatar").textContent = initials(state.guestName);
    $("#progressName").textContent = state.guestName;
    $("#progressSubtitle").textContent = "Guest progress is not saved.";
    $("#levelChip").textContent = "LVL 1";
    $("#statRating").textContent = "1000";
    $("#statWins").textContent = "0";
    $("#statGames").textContent = "0";
    $("#statWinRate").textContent = "0%";
    $("#xpLabel").textContent = "0 XP";
    $("#xpBar").style.width = "0%";
    $("#recentMatches").innerHTML = `<div class="empty-state compact-empty">Log in to save matches and unlock analytics.</div>`;
    return;
  }
  const games = Number(profile.games || 0);
  const wins = Number(profile.wins || 0);
  const xp = Number(profile.xp || 0);
  const level = Number(profile.level || 1);
  const currentLevelStart = ((level - 1) ** 2) * 100;
  const nextLevelStart = (level ** 2) * 100;
  const progress = Math.max(0, Math.min(100, ((xp - currentLevelStart) / Math.max(1, nextLevelStart - currentLevelStart)) * 100));
  $("#progressAvatar").textContent = initials(profile.username);
  $("#progressName").textContent = profile.username;
  $("#progressSubtitle").textContent = profile.pro ? "Methogle Pro member" : "Free account";
  $("#levelChip").textContent = `LVL ${level}`;
  $("#statRating").textContent = profile.rating || 1000;
  $("#statWins").textContent = wins;
  $("#statGames").textContent = games;
  $("#statWinRate").textContent = games ? `${Math.round((wins / games) * 100)}%` : "0%";
  $("#xpLabel").textContent = `${xp} XP`;
  $("#xpBar").style.width = `${progress}%`;
  if (!recent.length) {
    $("#recentMatches").innerHTML = `<div class="empty-state compact-empty">Your completed matches will appear here.</div>`;
  } else {
    $("#recentMatches").innerHTML = recent.slice(0, 4).map((match) => {
      const first = match.player1_name || "Player 1";
      const second = match.player2_name || "Solo";
      return `<div class="recent-match"><div><strong>${escapeHtml(capitalise(match.mode))}</strong><span>${escapeHtml(match.topic || "mixed")}</span></div><small>${escapeHtml(first)} vs ${escapeHtml(second)}</small><strong>${match.player1_score || 0}–${match.player2_score || 0}</strong></div>`;
    }).join("");
  }
}

async function loadProgress() {
  if (!state.profile) {
    updateProgressCard(null);
    return;
  }
  try {
    const result = await api("/api/dashboard");
    state.profile = result.profile;
    updateAccountUi();
    updateProgressCard(result.profile, result.recent || []);
  } catch (error) {
    updateProgressCard(state.profile, []);
  }
}

function buildTopicGrid(mode) {
  const grid = $("#topicGrid");
  grid.innerHTML = TOPICS.map(([value, label]) => `<button class="topic-option" type="button" data-topic="${value}">${label}</button>`).join("");
  $$("[data-topic]", grid).forEach((button) => button.addEventListener("click", () => {
    state.selectedTopic = button.dataset.topic;
    closeModal("topicModal");
    if (mode === "topic") joinQueue("topic", state.selectedTopic);
    else if (mode === "private") openModal("privateModal");
    else startSolo(mode, state.selectedTopic);
  }));
}

function startMode(mode) {
  sound.sfx("click");
  state.selectedMode = mode;
  state.lastMode = mode;
  if (mode === "ranked" && !state.profile) {
    showAuth("login");
    toast("Log in to play ranked matches.", "error");
    return;
  }
  if (mode === "topic") {
    buildTopicGrid("topic");
    openModal("topicModal");
    return;
  }
  if (mode === "private") {
    state.selectedTopic = "mixed";
    openModal("privateModal");
    return;
  }
  if (["practice", "daily", "survival", "blitz"].includes(mode)) {
    if (mode === "practice") {
      buildTopicGrid("practice");
      openModal("topicModal");
    } else {
      startSolo(mode, "mixed");
    }
    return;
  }
  joinQueue(mode, "mixed");
}

function joinQueue(mode, topic) {
  state.queueStartedAt = Date.now();
  $("#queueTitle").textContent = mode === "ranked" ? "Finding a ranked opponent" : mode === "topic" ? `Finding a ${capitalise(topic)} opponent` : "Finding an opponent";
  $("#queueText").textContent = mode === "ranked" ? "Searching for another logged-in player…" : "Searching the live queue…";
  $("#queueTimer").textContent = "0:00";
  openModal("queueModal");
  clearInterval(state.queueInterval);
  state.queueInterval = setInterval(() => {
    const seconds = Math.floor((Date.now() - state.queueStartedAt) / 1000);
    $("#queueTimer").textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }, 1000);
  socket.emit("joinQueue", { mode, topic }, (result) => {
    if (!result?.ok) {
      closeModal("queueModal");
      clearInterval(state.queueInterval);
      toast(result?.message || "Could not join matchmaking.", "error");
    }
  });
}

function startSolo(mode, topic) {
  socket.emit("startSolo", { mode, topic }, (result) => {
    if (!result?.ok) toast(result?.message || "Could not start this mode.", "error");
  });
}

function updateBattleScoreboard(players) {
  const container = $("#battleScoreboard");
  container.innerHTML = players.map((player) => {
    const self = player.socketId === socket.id;
    return `<div class="score-player ${self ? "self" : ""} ${player.answered ? "answered" : ""}"><div class="avatar ${self ? "avatar-green" : "avatar-purple"}">${escapeHtml(initials(player.name))}</div><div><strong>${escapeHtml(self ? `${player.name} (You)` : player.name)}</strong><small>${player.rating || 1000} ELO · ${player.streak || 0} streak</small></div><b>${player.score || 0}</b></div>`;
  }).join("");
}

function enterBattle(payload) {
  clearInterval(state.queueInterval);
  closeAllModals();
  state.currentMatch = payload;
  state.currentQuestion = null;
  state.selectedAnswer = null;
  state.roundEnded = false;
  $("#battleMode").textContent = payload.modeLabel;
  $("#battleTopic").textContent = capitalise(payload.topic);
  $("#questionText").textContent = "Match found. Get ready…";
  $("#answerGrid").innerHTML = "";
  updateBattleScoreboard(payload.players || []);
  $("#battleView").classList.remove("hidden");
  document.body.classList.add("modal-open");
  sound.sfx("match");
  if (payload.roomCode) toast(`Room ${payload.roomCode} started.`);
}

function startTimer(deadline) {
  clearInterval(state.timerInterval);
  state.timerDeadline = deadline;
  state.timerDuration = Math.max(1000, deadline - Date.now());
  const circumference = 2 * Math.PI * 22;
  const ring = $("#timerRing");
  ring.style.strokeDasharray = String(circumference);
  const update = () => {
    const remaining = Math.max(0, state.timerDeadline - Date.now());
    const progress = remaining / state.timerDuration;
    const seconds = Math.ceil(remaining / 1000);
    $("#timerText").textContent = seconds;
    ring.style.strokeDashoffset = String(circumference * (1 - progress));
    ring.style.stroke = seconds <= 5 ? "#ff7f8d" : seconds <= 10 ? "#ffd166" : "#65f99a";
    if (remaining <= 0) clearInterval(state.timerInterval);
  };
  update();
  state.timerInterval = setInterval(update, 100);
}

function renderRound(payload) {
  state.currentQuestion = payload.question;
  state.selectedAnswer = null;
  state.roundEnded = false;
  $("#roundLabel").textContent = `Round ${payload.round} of ${payload.totalRounds}`;
  $("#questionSkill").textContent = payload.question.skill || capitalise(payload.question.topic);
  $("#difficultyLabel").textContent = `DIFFICULTY ${payload.question.difficulty}`;
  $("#questionText").textContent = payload.question.prompt;
  $("#answerFeedback").classList.add("hidden");
  $("#explanationPanel").classList.add("hidden");
  updateBattleScoreboard(payload.players || []);
  const labels = ["A", "B", "C", "D"];
  $("#answerGrid").innerHTML = payload.question.options.map((option, index) => `<button class="answer-button" type="button" data-answer="${index}"><span>${labels[index]}</span>${escapeHtml(option)}</button>`).join("");
  $$("[data-answer]").forEach((button) => button.addEventListener("click", () => submitAnswer(Number(button.dataset.answer))));
  startTimer(payload.deadline);
}

function submitAnswer(index) {
  if (!state.currentMatch || state.selectedAnswer !== null || state.roundEnded) return;
  state.selectedAnswer = index;
  const buttons = $$("[data-answer]");
  buttons.forEach((button) => button.disabled = true);
  buttons[index]?.classList.add("selected");
  socket.emit("submitAnswer", { matchId: state.currentMatch.matchId, optionIndex: index }, (result) => {
    if (!result?.ok) toast("The answer was not accepted.", "error");
  });
}

function showAnswerFeedback(payload) {
  const panel = $("#answerFeedback");
  const icon = $("#feedbackIcon");
  const title = $("#feedbackTitle");
  const text = $("#feedbackText");
  panel.classList.remove("hidden");
  if (payload.correct) {
    icon.textContent = "✓";
    icon.style.color = "#65f99a";
    icon.style.background = "rgba(101,249,154,.1)";
    title.textContent = "Correct";
    text.textContent = `+${payload.points} points · ${payload.streak} streak`;
    sound.sfx("correct");
  } else {
    icon.textContent = "×";
    icon.style.color = "#ff7f8d";
    icon.style.background = "rgba(255,127,141,.1)";
    title.textContent = "Not quite";
    text.textContent = "The worked answer will appear in a moment.";
    sound.sfx("wrong");
  }
}

function revealRound(payload) {
  state.roundEnded = true;
  clearInterval(state.timerInterval);
  const buttons = $$("[data-answer]");
  buttons.forEach((button, index) => {
    button.disabled = true;
    if (index === payload.correctIndex) button.classList.add("correct");
    else if (index === state.selectedAnswer) button.classList.add("incorrect");
  });
  $("#explanationText").textContent = payload.explanation;
  $("#explanationPanel").classList.remove("hidden");
  updateBattleScoreboard(payload.players || []);
}

function showResults(payload) {
  clearInterval(state.timerInterval);
  state.roundEnded = true;
  const me = payload.players.find((player) => player.socketId === socket.id);
  const winner = payload.winnerSocketId;
  const solo = payload.players.length === 1;
  const won = solo || winner === socket.id;
  const draw = !solo && !winner;
  $("#resultEmblem").textContent = solo ? "✓" : won ? "🏆" : draw ? "⚖" : "↗";
  $("#resultTitle").textContent = solo ? "Run complete" : won ? "Victory" : draw ? "Draw" : "Match complete";
  $("#resultSubtitle").textContent = solo
    ? `You scored ${me?.score || 0} points.`
    : won ? "You outsolved your opponent." : draw ? "Nothing separated the two of you." : "Review the explanations and run it back.";
  $("#resultScores").innerHTML = payload.players.map((player) => `<div class="result-score-row"><strong>${escapeHtml(player.name)}${player.socketId === socket.id ? " (You)" : ""}</strong><strong>${player.score}</strong></div>`).join("");
  const ratingChange = payload.ratingChanges?.[socket.id] || 0;
  $("#ratingResult").textContent = ratingChange ? `${ratingChange > 0 ? "+" : ""}${ratingChange} ELO` : payload.mode === "ranked" ? "No rating change" : "Unrated mode";
  openModal("resultModal");
  if (won && !solo) sound.sfx("win");
  loadLeaderboard();
  loadSession();
}

function leaveBattle() {
  socket.emit("leaveMatch");
  $("#battleView").classList.add("hidden");
  document.body.classList.remove("modal-open");
  state.currentMatch = null;
  state.currentQuestion = null;
  closeAllModals();
}

function playAgain() {
  const mode = state.currentMatch?.mode || state.lastMode;
  leaveBattle();
  setTimeout(() => startMode(mode), 250);
}

function returnHome() {
  leaveBattle();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindUi() {
  window.addEventListener("scroll", () => $("#siteHeader").classList.toggle("scrolled", window.scrollY > 20));
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add("visible");
  }), { threshold: .12 });
  $$(".reveal").forEach((element) => observer.observe(element));

  $("#loginButton").addEventListener("click", () => showAuth("login"));
  $("#accountButton").addEventListener("click", () => showAuth("signup"));
  $("#profileButton").addEventListener("click", () => openModal("profileModal"));
  $("#authLoginTab").addEventListener("click", () => setAuthMode("login"));
  $("#authSignupTab").addEventListener("click", () => setAuthMode("signup"));
  $("#authForm").addEventListener("submit", submitAuth);
  $("#logoutButton").addEventListener("click", logout);
  $("#refreshProgress").addEventListener("click", loadProgress);

  $$('[data-close-modal]').forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
  $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop && backdrop.id !== "queueModal") closeModal(backdrop.id);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = $(".modal-backdrop:not(.hidden)");
      if (open && open.id !== "queueModal") closeModal(open.id);
    }
  });

  $$('[data-start-mode]').forEach((button) => button.addEventListener("click", () => startMode(button.dataset.startMode)));
  $("#cancelQueueButton").addEventListener("click", () => {
    socket.emit("leaveQueue");
    clearInterval(state.queueInterval);
    closeModal("queueModal");
  });

  $("#createRoomButton").addEventListener("click", () => {
    socket.emit("createPrivateRoom", { topic: state.selectedTopic }, (result) => {
      if (!result?.ok) return toast(result?.message || "Could not create room.", "error");
      $("#roomCodeDisplay").textContent = result.code;
      $("#roomResult").classList.remove("hidden");
    });
  });
  $("#joinRoomButton").addEventListener("click", () => {
    const code = $("#roomCodeInput").value.trim().toUpperCase();
    if (code.length !== 6) return toast("Enter the six-character room code.", "error");
    socket.emit("joinPrivateRoom", { code }, (result) => {
      if (!result?.ok) toast(result?.message || "Could not join room.", "error");
    });
  });
  $("#copyRoomCode").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#roomCodeDisplay").textContent);
    toast("Room code copied.");
  });
  $("#roomCodeInput").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });

  $("#leaveMatchButton").addEventListener("click", leaveBattle);
  $("#battleLogo").addEventListener("click", (event) => { event.preventDefault(); leaveBattle(); });
  $("#playAgainButton").addEventListener("click", playAgain);
  $("#returnHomeButton").addEventListener("click", returnHome);
  $$('[data-reaction]').forEach((button) => button.addEventListener("click", () => socket.emit("reaction", { reaction: button.dataset.reaction })));

  $("#musicButton").addEventListener("click", async () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem("methogle_sound", state.soundEnabled ? "on" : "off");
    $("#musicButton").classList.toggle("active", state.soundEnabled);
    $("#musicButton").setAttribute("aria-label", state.soundEnabled ? "Turn music off" : "Turn music on");
    if (state.soundEnabled) {
      await sound.enable();
      toast("Original Methogle music enabled.");
    } else {
      sound.disable();
    }
  });

  $("#proButton").addEventListener("click", () => toast("Methogle Pro payments are not active yet. The waitlist is coming next."));
  $("#schoolButton").addEventListener("click", () => toast("School registrations will open after the student beta."));
}

function bindSocket() {
  socket.on("connect", () => {
    socket.emit("updateGuestName", { name: state.guestName });
  });
  socket.on("identity", (identity) => { state.identity = identity; });
  socket.on("presence", ({ onlinePlayers }) => { $("#onlineCount").textContent = Math.max(1, Number(onlinePlayers || 1)); });
  socket.on("queueJoined", () => {});
  socket.on("queueLeft", () => { clearInterval(state.queueInterval); });
  socket.on("privateRoomCreated", ({ code }) => {
    $("#roomCodeDisplay").textContent = code;
    $("#roomResult").classList.remove("hidden");
  });
  socket.on("matchFound", enterBattle);
  socket.on("roundStarted", renderRound);
  socket.on("answerAccepted", showAnswerFeedback);
  socket.on("roundEnded", revealRound);
  socket.on("matchEnded", showResults);
  socket.on("reaction", ({ from, reaction }) => {
    const pop = $("#reactionPop");
    pop.textContent = `${from}: ${reaction}`;
    pop.classList.remove("hidden");
    setTimeout(() => pop.classList.add("hidden"), 2000);
  });
  socket.on("disconnect", () => {
    if (state.currentMatch) toast("Connection lost. Reconnecting…", "error");
  });
}

async function init() {
  bindUi();
  bindSocket();
  $("#musicButton").classList.toggle("active", state.soundEnabled);
  if (state.soundEnabled) {
    const activate = async () => {
      await sound.enable();
      document.removeEventListener("pointerdown", activate);
    };
    document.addEventListener("pointerdown", activate, { once: true });
  }
  await Promise.all([loadConfig(), loadSession(), loadLeaderboard()]);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", init);
