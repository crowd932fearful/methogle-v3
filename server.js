"use strict";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { TOPICS, generateQuestionSet } = require("./question-engine");

const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const ACCOUNTS_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY);
const COOKIE_SECURE = process.env.NODE_ENV === "production";
const K_FACTOR = 28;

const MODE_CONFIG = Object.freeze({
  ranked: { label: "Ranked Arena", rounds: 7, roundMs: 30_000, players: 2, rated: true, topic: "mixed" },
  casual: { label: "Casual Duel", rounds: 5, roundMs: 30_000, players: 2, rated: false, topic: "mixed" },
  topic: { label: "Topic Clash", rounds: 7, roundMs: 30_000, players: 2, rated: false, topic: "mixed" },
  private: { label: "Private Room", rounds: 7, roundMs: 35_000, players: 2, rated: false, topic: "mixed" },
  practice: { label: "Practice Bot", rounds: 8, roundMs: 35_000, players: 2, rated: false, topic: "mixed", bot: true },
  daily: { label: "Daily Challenge", rounds: 10, roundMs: 30_000, players: 1, rated: false, topic: "mixed", daily: true },
  survival: { label: "Survival", rounds: 20, roundMs: 25_000, players: 1, rated: false, topic: "mixed", survival: true },
  blitz: { label: "Speed Blitz", rounds: 12, roundMs: 15_000, players: 1, rated: false, topic: "mixed", blitz: true }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  maxHttpBufferSize: 25_000,
  pingInterval: 25_000,
  pingTimeout: 20_000
});

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
});
app.use(express.json({ limit: "30kb" }));
app.use(express.static(path.join(__dirname, "public"), {
  extensions: ["html"],
  maxAge: process.env.NODE_ENV === "production" ? "30m" : 0
}));

const queues = new Map();
const rooms = new Map();
const matches = new Map();
const players = new Map();
const rateBuckets = new Map();
const memoryProfiles = new Map();
const memoryMatches = [];

function id(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function cleanUsername(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_ -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}

function cleanTopic(value) {
  return TOPICS.includes(value) ? value : "mixed";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function parseCookies(header = "") {
  const output = {};
  for (const pair of String(header).split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) output[key] = decodeURIComponent(value);
  }
  return output;
}

function cookieOptions(maxAgeSeconds) {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds * 1000
  };
}

function setAuthCookies(res, session) {
  if (!session?.access_token) return;
  const accessAge = Math.max(300, Number(session.expires_in || 3600));
  res.cookie("methogle_access", session.access_token, cookieOptions(accessAge));
  if (session.refresh_token) {
    res.cookie("methogle_refresh", session.refresh_token, cookieOptions(60 * 60 * 24 * 30));
  }
}

function clearAuthCookies(res) {
  res.clearCookie("methogle_access", cookieOptions(0));
  res.clearCookie("methogle_refresh", cookieOptions(0));
}

function publicHeaders(extra = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    "Content-Type": "application/json",
    ...extra
  };
}

function adminHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...extra
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function supabaseAuth(route, options = {}) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}${route}`, {
      ...options,
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message || error?.message || "connection failed";
    throw new Error(`Could not connect to Supabase (${cause}). Recheck SUPABASE_URL and redeploy.`);
  }
  const body = await readJson(response);
  if (!response.ok) {
    const error = new Error(body.msg || body.message || body.error_description || "Account request failed.");
    error.status = response.status;
    error.detail = body;
    throw error;
  }
  return body;
}

async function supabaseRest(route, options = {}) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1${route}`, {
      ...options,
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message || error?.message || "connection failed";
    throw new Error(`Could not connect to Supabase (${cause}). Recheck SUPABASE_URL and redeploy.`);
  }
  const body = response.status === 204 ? null : await readJson(response);
  if (!response.ok) {
    const error = new Error(body?.message || `Database request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function allowRequest(key, limit = 10, windowMs = 60_000) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || [];
  const recent = bucket.filter((time) => now - time < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  rateBuckets.set(key, recent);
  return true;
}

async function verifyToken(accessToken) {
  if (!ACCOUNTS_CONFIGURED || !accessToken) return null;
  try {
    return await supabaseAuth("/auth/v1/user", {
      headers: publicHeaders({ Authorization: `Bearer ${accessToken}` })
    });
  } catch {
    return null;
  }
}

async function refreshSession(refreshToken) {
  if (!refreshToken) return null;
  try {
    return await supabaseAuth("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: publicHeaders(),
      body: JSON.stringify({ refresh_token: refreshToken })
    });
  } catch {
    return null;
  }
}

async function resolveRequestUser(req, res = null) {
  const cookies = parseCookies(req.headers.cookie);
  let accessToken = cookies.methogle_access || "";
  let user = await verifyToken(accessToken);
  if (!user && cookies.methogle_refresh) {
    const refreshed = await refreshSession(cookies.methogle_refresh);
    if (refreshed?.access_token) {
      accessToken = refreshed.access_token;
      user = refreshed.user || await verifyToken(accessToken);
      if (res) setAuthCookies(res, refreshed);
    }
  }
  return { user, accessToken };
}

async function getProfile(userId) {
  if (!userId) return null;
  if (!ACCOUNTS_CONFIGURED) return memoryProfiles.get(userId) || null;
  const rows = await supabaseRest(`/profiles?id=eq.${encodeURIComponent(userId)}&select=id,username,rating,wins,losses,draws,games,xp,level,pro,created_at&limit=1`, {
    headers: adminHeaders()
  });
  return rows?.[0] || null;
}

async function getOrCreateProfile(user) {
  if (!user?.id) return null;
  let profile = await getProfile(user.id);
  if (profile) return profile;
  const username = cleanUsername(user.user_metadata?.username) || `solver_${user.id.slice(0, 6)}`;
  if (!ACCOUNTS_CONFIGURED) {
    profile = { id: user.id, username, rating: 1000, wins: 0, losses: 0, draws: 0, games: 0, xp: 0, level: 1, pro: false };
    memoryProfiles.set(user.id, profile);
    return profile;
  }
  const rows = await supabaseRest("/profiles?select=id,username,rating,wins,losses,draws,games,xp,level,pro", {
    method: "POST",
    headers: adminHeaders({ Prefer: "return=representation,resolution=merge-duplicates" }),
    body: JSON.stringify({ id: user.id, username })
  });
  return rows?.[0] || null;
}

async function usernameExists(username) {
  if (!ACCOUNTS_CONFIGURED) return false;
  const rows = await supabaseRest(`/profiles?username=ilike.${encodeURIComponent(username)}&select=id&limit=1`, {
    headers: adminHeaders()
  });
  return Boolean(rows?.length);
}

async function updateProfile(userId, patch) {
  if (!userId) return null;
  if (!ACCOUNTS_CONFIGURED) {
    const current = memoryProfiles.get(userId) || { id: userId, username: "Player", rating: 1000, wins: 0, losses: 0, draws: 0, games: 0, xp: 0, level: 1, pro: false };
    const next = { ...current, ...patch };
    memoryProfiles.set(userId, next);
    return next;
  }
  const rows = await supabaseRest(`/profiles?id=eq.${encodeURIComponent(userId)}&select=id,username,rating,wins,losses,draws,games,xp,level,pro`, {
    method: "PATCH",
    headers: adminHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  return rows?.[0] || null;
}

async function saveMatch(match, result) {
  const row = {
    id: match.id,
    mode: match.mode,
    player1_id: match.players[0]?.userId || null,
    player2_id: match.players[1]?.userId || null,
    winner_id: result.winnerUserId || null,
    player1_name: match.players[0]?.name || "Player 1",
    player2_name: match.players[1]?.name || null,
    player1_score: match.players[0]?.score || 0,
    player2_score: match.players[1]?.score || 0,
    player1_rating_change: result.ratingChanges?.[match.players[0]?.socketId] || 0,
    player2_rating_change: result.ratingChanges?.[match.players[1]?.socketId] || 0,
    topic: match.topic,
    completed_at: new Date().toISOString()
  };
  if (!ACCOUNTS_CONFIGURED) {
    memoryMatches.unshift(row);
    memoryMatches.splice(100);
    return;
  }
  await supabaseRest("/matches", {
    method: "POST",
    headers: adminHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(row)
  });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Methogle",
    version: "3.0.1",
    accountsConfigured: ACCOUNTS_CONFIGURED,
    onlinePlayers: io.engine.clientsCount,
    activeMatches: matches.size
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    accountsConfigured: ACCOUNTS_CONFIGURED,
    proCheckoutEnabled: false,
    modes: Object.fromEntries(Object.entries(MODE_CONFIG).map(([key, config]) => [key, {
      label: config.label,
      rounds: config.rounds,
      seconds: config.roundMs / 1000
    }]))
  });
});

app.post("/api/auth/signup", async (req, res) => {
  if (!ACCOUNTS_CONFIGURED) return res.status(503).json({ message: "Accounts are not connected yet. Guest play is still available." });
  if (!allowRequest(`signup:${req.ip}`, 6, 10 * 60_000)) return res.status(429).json({ message: "Too many signup attempts. Try again later." });
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const username = cleanUsername(req.body?.username);
  if (!validEmail(email)) return res.status(400).json({ message: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ message: "Password must be 8–128 characters." });
  if (username.length < 3) return res.status(400).json({ message: "Username must be 3–20 characters." });
  try {
    if (await usernameExists(username)) return res.status(409).json({ message: "That username is already taken." });
    const redirectTo = `${req.protocol}://${req.get("host")}`;
    const body = await supabaseAuth(`/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      headers: publicHeaders(),
      body: JSON.stringify({ email, password, data: { username } })
    });
    if (body.access_token) setAuthCookies(res, body);
    return res.status(201).json({
      ok: true,
      signedIn: Boolean(body.access_token),
      message: body.access_token ? "Account created." : "Account created. Check your email to confirm it, then log in."
    });
  } catch (error) {
    console.error("Signup failed:", error.message);
    return res.status(error.status || 500).json({ message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!ACCOUNTS_CONFIGURED) return res.status(503).json({ message: "Accounts are not connected yet." });
  if (!allowRequest(`login:${req.ip}`, 12, 10 * 60_000)) return res.status(429).json({ message: "Too many login attempts. Try again later." });
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!validEmail(email) || !password) return res.status(400).json({ message: "Enter your email and password." });
  try {
    const session = await supabaseAuth("/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: publicHeaders(),
      body: JSON.stringify({ email, password })
    });
    setAuthCookies(res, session);
    const profile = await getOrCreateProfile(session.user);
    return res.json({ ok: true, profile });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (ACCOUNTS_CONFIGURED && cookies.methogle_access) {
    try {
      await supabaseAuth("/auth/v1/logout", {
        method: "POST",
        headers: publicHeaders({ Authorization: `Bearer ${cookies.methogle_access}` }),
        body: "{}"
      });
    } catch {
      // Local logout should still succeed if Supabase is temporarily unavailable.
    }
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!ACCOUNTS_CONFIGURED) return res.json({ user: null, profile: null, accountsConfigured: false });
  try {
    const { user } = await resolveRequestUser(req, res);
    if (!user) return res.status(401).json({ user: null, profile: null });
    const profile = await getOrCreateProfile(user);
    return res.json({ user: { id: user.id, email: user.email }, profile, accountsConfigured: true });
  } catch (error) {
    console.error("Session read failed:", error.message);
    return res.status(500).json({ message: "Could not load your account." });
  }
});

app.get("/api/leaderboard", async (_req, res) => {
  try {
    let rows;
    if (ACCOUNTS_CONFIGURED) {
      rows = await supabaseRest("/profiles?select=username,rating,wins,losses,draws,games,level,pro&order=rating.desc&limit=50", {
        headers: adminHeaders()
      });
    } else {
      rows = [...memoryProfiles.values()].sort((a, b) => b.rating - a.rating).slice(0, 50);
    }
    res.json({ leaderboard: rows || [] });
  } catch (error) {
    console.error("Leaderboard failed:", error.message);
    res.status(500).json({ message: "Could not load the leaderboard." });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const { user } = await resolveRequestUser(req, res);
    if (!user) return res.status(401).json({ message: "Log in to view progress." });
    const profile = await getOrCreateProfile(user);
    let recent = [];
    if (ACCOUNTS_CONFIGURED) {
      recent = await supabaseRest(`/matches?or=(player1_id.eq.${user.id},player2_id.eq.${user.id})&select=id,mode,player1_name,player2_name,player1_score,player2_score,winner_id,topic,completed_at&order=completed_at.desc&limit=10`, {
        headers: adminHeaders()
      });
    } else {
      recent = memoryMatches.filter((match) => match.player1_id === user.id || match.player2_id === user.id).slice(0, 10);
    }
    res.json({ profile, recent });
  } catch (error) {
    console.error("Dashboard failed:", error.message);
    res.status(500).json({ message: "Could not load progress." });
  }
});

app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api/") || req.path === "/health" || req.path.startsWith("/socket.io")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function queueKey(mode, topic) {
  return `${mode}:${topic || "mixed"}`;
}

function removeFromAllQueues(socketId) {
  for (const [key, queue] of queues.entries()) {
    const next = queue.filter((entry) => entry.socketId !== socketId);
    if (next.length) queues.set(key, next);
    else queues.delete(key);
  }
}

function publicPlayer(player) {
  return {
    socketId: player.socketId,
    name: player.name,
    rating: player.rating,
    score: player.score,
    streak: player.streak,
    answered: player.answered,
    connected: player.connected !== false,
    isBot: Boolean(player.isBot)
  };
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function makePlayer(socket, identity, extra = {}) {
  return {
    socketId: socket.id,
    userId: identity.userId || null,
    name: cleanUsername(identity.name) || "Guest",
    rating: Number(identity.rating || 1000),
    score: 0,
    streak: 0,
    answered: false,
    connected: true,
    isBot: false,
    ...extra
  };
}

function createMatch({ mode, topic = "mixed", entrants, room = null }) {
  const config = MODE_CONFIG[mode];
  const today = new Date().toISOString().slice(0, 10);
  const seed = config.daily ? `methogle:${today}` : null;
  const questions = generateQuestionSet({
    topic: cleanTopic(topic),
    count: config.rounds,
    difficulty: mode === "ranked" ? 2 : 1,
    seed
  });
  const match = {
    id: id("match"),
    mode,
    topic: cleanTopic(topic),
    config,
    room,
    players: entrants,
    questions,
    roundIndex: -1,
    roundStartedAt: 0,
    deadline: 0,
    timer: null,
    status: "starting",
    ended: false
  };
  matches.set(match.id, match);
  for (const player of entrants) {
    if (!player.isBot) {
      players.set(player.socketId, { ...players.get(player.socketId), matchId: match.id });
      io.to(player.socketId).emit("matchFound", {
        matchId: match.id,
        mode,
        modeLabel: config.label,
        topic: match.topic,
        rounds: config.rounds,
        seconds: config.roundMs / 1000,
        players: entrants.map(publicPlayer),
        roomCode: room
      });
    }
  }
  setTimeout(() => beginRound(match.id), 1_200);
  return match;
}

function emitToMatch(match, event, payload) {
  for (const player of match.players) {
    if (!player.isBot) io.to(player.socketId).emit(event, payload);
  }
}

function beginRound(matchId) {
  const match = matches.get(matchId);
  if (!match || match.ended) return;
  match.roundIndex += 1;
  if (match.roundIndex >= match.questions.length) return endMatch(matchId, "complete");
  match.status = "round";
  match.roundStartedAt = Date.now();
  match.deadline = match.roundStartedAt + match.config.roundMs;
  for (const player of match.players) player.answered = false;
  const question = match.questions[match.roundIndex];
  emitToMatch(match, "roundStarted", {
    matchId,
    round: match.roundIndex + 1,
    totalRounds: match.questions.length,
    deadline: match.deadline,
    question: {
      id: question.id,
      prompt: question.prompt,
      options: question.options,
      topic: question.topic,
      difficulty: question.difficulty,
      skill: question.skill
    },
    players: match.players.map(publicPlayer)
  });
  clearTimeout(match.timer);
  match.timer = setTimeout(() => finishRound(matchId), match.config.roundMs + 80);
  const bot = match.players.find((player) => player.isBot);
  if (bot) scheduleBotAnswer(match, bot, question);
}

function scheduleBotAnswer(match, bot, question) {
  const difficultyPenalty = question.difficulty * 0.07;
  const accuracy = Math.max(0.45, 0.88 - difficultyPenalty);
  const delay = Math.floor(3_000 + Math.random() * Math.max(2_000, match.config.roundMs - 7_000));
  setTimeout(() => {
    if (!matches.has(match.id) || match.ended || match.roundIndex < 0 || bot.answered) return;
    const correct = Math.random() < accuracy;
    const choice = correct
      ? question.answerIndex
      : [0, 1, 2, 3].filter((index) => index !== question.answerIndex)[Math.floor(Math.random() * 3)];
    recordAnswer(match, bot, choice);
  }, delay);
}

function scoreAnswer(match, player, correct) {
  if (!correct) {
    player.streak = 0;
    return 0;
  }
  player.streak += 1;
  const remaining = Math.max(0, match.deadline - Date.now());
  const speed = Math.round((remaining / match.config.roundMs) * 120);
  const streakBonus = Math.min(80, (player.streak - 1) * 15);
  return 100 + speed + streakBonus;
}

function recordAnswer(match, player, optionIndex) {
  if (match.status !== "round" || player.answered) return;
  const question = match.questions[match.roundIndex];
  player.answered = true;
  const correct = Number(optionIndex) === question.answerIndex;
  const points = scoreAnswer(match, player, correct);
  player.score += points;
  if (!player.isBot) {
    io.to(player.socketId).emit("answerAccepted", { correct, points, streak: player.streak });
  }
  if (match.config.survival && !correct) {
    return setTimeout(() => endMatch(match.id, "survival_miss"), 650);
  }
  if (match.players.every((entry) => entry.answered || entry.connected === false)) {
    setTimeout(() => finishRound(match.id), 450);
  }
}

function finishRound(matchId) {
  const match = matches.get(matchId);
  if (!match || match.ended || match.status !== "round") return;
  clearTimeout(match.timer);
  match.status = "reveal";
  const question = match.questions[match.roundIndex];
  emitToMatch(match, "roundEnded", {
    correctIndex: question.answerIndex,
    explanation: question.explanation,
    players: match.players.map(publicPlayer)
  });
  setTimeout(() => beginRound(matchId), 2_900);
}

function eloChange(ratingA, ratingB, scoreA) {
  const expectedA = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  return Math.round(K_FACTOR * (scoreA - expectedA));
}

async function applyPersistentResults(match, winner) {
  const ratingChanges = {};
  const humanPlayers = match.players.filter((player) => !player.isBot && player.userId);
  if (match.config.rated && humanPlayers.length === 2) {
    const [a, b] = humanPlayers;
    const scoreA = winner === null ? 0.5 : winner.socketId === a.socketId ? 1 : 0;
    const changeA = eloChange(a.rating, b.rating, scoreA);
    ratingChanges[a.socketId] = changeA;
    ratingChanges[b.socketId] = -changeA;
  }
  for (const player of humanPlayers) {
    try {
      const profile = await getProfile(player.userId);
      if (!profile) continue;
      const won = winner && winner.socketId === player.socketId;
      const drawn = winner === null && match.players.length > 1;
      const lost = !won && !drawn && match.players.length > 1;
      const xpGain = 35 + Math.floor(player.score / 40) + (won ? 50 : 0);
      const newXp = Number(profile.xp || 0) + xpGain;
      const patch = {
        rating: Math.max(100, Number(profile.rating || 1000) + (ratingChanges[player.socketId] || 0)),
        wins: Number(profile.wins || 0) + (won ? 1 : 0),
        losses: Number(profile.losses || 0) + (lost ? 1 : 0),
        draws: Number(profile.draws || 0) + (drawn ? 1 : 0),
        games: Number(profile.games || 0) + 1,
        xp: newXp,
        level: Math.max(1, Math.floor(Math.sqrt(newXp / 100)) + 1)
      };
      await updateProfile(player.userId, patch);
    } catch (error) {
      console.error("Profile result update failed:", error.message);
    }
  }
  return ratingChanges;
}

async function endMatch(matchId, reason = "complete") {
  const match = matches.get(matchId);
  if (!match || match.ended) return;
  match.ended = true;
  match.status = "ended";
  clearTimeout(match.timer);
  const sorted = [...match.players].sort((a, b) => b.score - a.score);
  const winner = sorted.length > 1 && sorted[0].score === sorted[1].score ? null : sorted[0] || null;
  const ratingChanges = await applyPersistentResults(match, winner);
  const result = {
    matchId,
    mode: match.mode,
    reason,
    winnerSocketId: winner?.socketId || null,
    winnerUserId: winner?.userId || null,
    ratingChanges,
    players: match.players.map(publicPlayer)
  };
  emitToMatch(match, "matchEnded", result);
  try {
    await saveMatch(match, result);
  } catch (error) {
    console.error("Match save failed:", error.message);
  }
  for (const player of match.players) {
    if (!player.isBot) {
      const state = players.get(player.socketId);
      if (state) players.set(player.socketId, { ...state, matchId: null });
    }
  }
  if (match.room) rooms.delete(match.room);
  setTimeout(() => matches.delete(matchId), 60_000);
}

async function socketIdentity(socket) {
  const cookies = parseCookies(socket.request.headers.cookie);
  let user = await verifyToken(cookies.methogle_access);
  if (!user && cookies.methogle_refresh) {
    const session = await refreshSession(cookies.methogle_refresh);
    user = session?.user || null;
  }
  if (user) {
    try {
      const profile = await getOrCreateProfile(user);
      return { userId: user.id, name: profile?.username || "Solver", rating: profile?.rating || 1000, authenticated: true };
    } catch {
      return { userId: user.id, name: cleanUsername(user.user_metadata?.username) || "Solver", rating: 1000, authenticated: true };
    }
  }
  return { userId: null, name: cleanUsername(socket.handshake.auth?.guestName) || `Guest${Math.floor(100 + Math.random() * 900)}`, rating: 1000, authenticated: false };
}

function tryMatchQueue(key) {
  const queue = queues.get(key) || [];
  while (queue.length >= 2) {
    const first = queue.shift();
    const second = queue.shift();
    const firstSocket = io.sockets.sockets.get(first.socketId);
    const secondSocket = io.sockets.sockets.get(second.socketId);
    if (!firstSocket || !secondSocket) continue;
    createMatch({ mode: first.mode, topic: first.topic, entrants: [first.player, second.player] });
  }
  if (queue.length) queues.set(key, queue);
  else queues.delete(key);
}

io.on("connection", async (socket) => {
  const identity = await socketIdentity(socket);
  players.set(socket.id, { socketId: socket.id, identity, matchId: null, queued: false });
  socket.emit("identity", identity);
  io.emit("presence", { onlinePlayers: io.engine.clientsCount });

  socket.on("updateGuestName", (payload = {}) => {
    const state = players.get(socket.id);
    if (!state || state.identity.authenticated) return;
    state.identity.name = cleanUsername(payload.name) || state.identity.name;
    players.set(socket.id, state);
    socket.emit("identity", state.identity);
  });

  socket.on("joinQueue", (payload = {}, callback = () => {}) => {
    const mode = ["ranked", "casual", "topic"].includes(payload.mode) ? payload.mode : "casual";
    const topic = mode === "topic" ? cleanTopic(payload.topic) : "mixed";
    const state = players.get(socket.id);
    if (!state || state.matchId) return callback({ ok: false, message: "You are already in a match." });
    if (mode === "ranked" && !state.identity.authenticated) return callback({ ok: false, message: "Log in to enter ranked matchmaking." });
    removeFromAllQueues(socket.id);
    const player = makePlayer(socket, state.identity);
    const key = queueKey(mode, topic);
    const queue = queues.get(key) || [];
    queue.push({ socketId: socket.id, mode, topic, player, joinedAt: Date.now() });
    queues.set(key, queue);
    players.set(socket.id, { ...state, queued: true });
    socket.emit("queueJoined", { mode, topic, position: queue.length });
    callback({ ok: true });
    tryMatchQueue(key);
  });

  socket.on("leaveQueue", () => {
    removeFromAllQueues(socket.id);
    const state = players.get(socket.id);
    if (state) players.set(socket.id, { ...state, queued: false });
    socket.emit("queueLeft");
  });

  socket.on("createPrivateRoom", (payload = {}, callback = () => {}) => {
    const state = players.get(socket.id);
    if (!state || state.matchId) return callback({ ok: false, message: "You are already in a match." });
    let code = roomCode();
    while (rooms.has(code)) code = roomCode();
    const topic = cleanTopic(payload.topic);
    rooms.set(code, { hostSocketId: socket.id, topic, createdAt: Date.now() });
    socket.join(`room:${code}`);
    socket.emit("privateRoomCreated", { code, topic });
    callback({ ok: true, code });
  });

  socket.on("joinPrivateRoom", (payload = {}, callback = () => {}) => {
    const code = String(payload.code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, message: "Room not found. Check the code." });
    if (room.hostSocketId === socket.id) return callback({ ok: false, message: "You already created this room." });
    const hostSocket = io.sockets.sockets.get(room.hostSocketId);
    if (!hostSocket) {
      rooms.delete(code);
      return callback({ ok: false, message: "The host left the room." });
    }
    const hostState = players.get(room.hostSocketId);
    const guestState = players.get(socket.id);
    if (!hostState || !guestState) return callback({ ok: false, message: "Could not join the room." });
    socket.join(`room:${code}`);
    createMatch({
      mode: "private",
      topic: room.topic,
      room: code,
      entrants: [makePlayer(hostSocket, hostState.identity), makePlayer(socket, guestState.identity)]
    });
    callback({ ok: true });
  });

  socket.on("startSolo", (payload = {}, callback = () => {}) => {
    const mode = ["practice", "daily", "survival", "blitz"].includes(payload.mode) ? payload.mode : "practice";
    const state = players.get(socket.id);
    if (!state || state.matchId) return callback({ ok: false, message: "You are already in a match." });
    const human = makePlayer(socket, state.identity);
    const entrants = [human];
    if (MODE_CONFIG[mode].bot) {
      entrants.push({ socketId: "bot", userId: null, name: "Methobot", rating: 1050, score: 0, streak: 0, answered: false, connected: true, isBot: true });
    }
    createMatch({ mode, topic: cleanTopic(payload.topic), entrants });
    callback({ ok: true });
  });

  socket.on("submitAnswer", (payload = {}, callback = () => {}) => {
    const state = players.get(socket.id);
    const match = state?.matchId ? matches.get(state.matchId) : null;
    if (!match || match.id !== payload.matchId) return callback({ ok: false });
    const player = match.players.find((entry) => entry.socketId === socket.id);
    if (!player || player.answered) return callback({ ok: false });
    const optionIndex = Number(payload.optionIndex);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) return callback({ ok: false });
    recordAnswer(match, player, optionIndex);
    callback({ ok: true });
  });

  socket.on("reaction", (payload = {}) => {
    const allowed = ["GG", "Nice!", "Wow", "Close!", "🔥"];
    if (!allowed.includes(payload.reaction)) return;
    const state = players.get(socket.id);
    const match = state?.matchId ? matches.get(state.matchId) : null;
    if (!match) return;
    emitToMatch(match, "reaction", { from: state.identity.name, reaction: payload.reaction });
  });

  socket.on("leaveMatch", () => {
    const state = players.get(socket.id);
    const match = state?.matchId ? matches.get(state.matchId) : null;
    if (!match || match.ended) return;
    const player = match.players.find((entry) => entry.socketId === socket.id);
    if (player) player.connected = false;
    endMatch(match.id, "player_left");
  });

  socket.on("disconnect", () => {
    removeFromAllQueues(socket.id);
    for (const [code, room] of rooms.entries()) {
      if (room.hostSocketId === socket.id) rooms.delete(code);
    }
    const state = players.get(socket.id);
    const match = state?.matchId ? matches.get(state.matchId) : null;
    if (match && !match.ended) {
      const player = match.players.find((entry) => entry.socketId === socket.id);
      if (player) player.connected = false;
      setTimeout(() => {
        const current = matches.get(match.id);
        if (current && !current.ended) endMatch(current.id, "disconnect");
      }, 2_000);
    }
    players.delete(socket.id);
    io.emit("presence", { onlinePlayers: io.engine.clientsCount });
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now - room.createdAt > 30 * 60_000) rooms.delete(code);
  }
  for (const [key, times] of rateBuckets.entries()) {
    const recent = times.filter((time) => now - time < 10 * 60_000);
    if (recent.length) rateBuckets.set(key, recent);
    else rateBuckets.delete(key);
  }
}, 60_000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Methogle v3 running on port ${PORT}`);
  console.log(`Accounts configured: ${ACCOUNTS_CONFIGURED ? "yes" : "no (guest mode available)"}`);
});
