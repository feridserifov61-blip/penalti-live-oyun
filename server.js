const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

const PORT = Number(process.env.PORT) || 3003;
const DEFAULT_TIKTOK_USER = (process.env.TIKTOK_USER || 'bakuremixlab').trim().replace(/^@+/, '').toLowerCase();
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_PATH = path.join(__dirname, 'settings.json');

const THEMES = ['ucl', 'gold', 'azerbaijan'];
const DIFFICULTIES = { easy: 0.22, normal: 0.34, hard: 0.45 };
const BOT_NAMES = [
  'Tural', 'Rəşad', 'Kamran', 'Elvin', 'Orxan', 'Fərid', 'Vüsal', 'Emin',
  'Cavid', 'Aynur', 'Nigar', 'Günel', 'Murad', 'Samir', 'Babək', 'Nicat'
];

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveSettings(patch) {
  try {
    const next = { ...loadSettings(), ...patch };
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  } catch (_) {}
}

const initialSettings = loadSettings();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// ==================== PENALTY ENGINE STATE ====================
const game = {
  phase: 'aim', // 'aim' | 'kick' | 'result'
  phaseStartedAt: Date.now(),
  theme: THEMES.includes(initialSettings.theme) ? initialSettings.theme : 'ucl',
  difficulty: DIFFICULTIES[initialSettings.difficulty] ? initialSettings.difficulty : 'normal',
  autoBotShots: initialSettings.autoBotShots !== undefined ? !!initialSettings.autoBotShots : true,
  soundMuted: false,
  goalsTotal: 0,
  savesTotal: 0,
  likeEnergy: 0,
  nextShotSuper: false,
  queue: [], // { id, uniqueId, nickname, zone: 1|2|3, isBot, isSuper, giftName? }
  currentShot: null, // { ..., keeperZone, outcome: 'goal'|'saved'|null, mul }
  streaks: new Map(), // uniqueId -> number
  leaderboard: new Map(), // uniqueId -> { uniqueId, nickname, goals, score, bestStreak }
  feed: [],
  nextId: 1,
  loopTimer: null
};

const tiktok = {
  username: DEFAULT_TIKTOK_USER,
  conn: null,
  connecting: false,
  connected: false,
  viewerCount: 0,
  error: '',
  reconnectTimer: null
};

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    connected: tiktok.connected,
    phase: game.phase,
    goals: game.goalsTotal,
    saves: game.savesTotal,
    queueLen: game.queue.length
  });
});

function pushFeed(text, kind = 'info') {
  game.feed.unshift({ id: game.nextId++, text, kind });
  if (game.feed.length > 5) game.feed.length = 5;
}

function getSortedBoard() {
  return Array.from(game.leaderboard.values())
    .sort((a, b) => b.score - a.score || b.goals - a.goals)
    .slice(0, 5);
}

function buildState() {
  return {
    phase: game.phase,
    phaseStartedAt: game.phaseStartedAt,
    theme: game.theme,
    difficulty: game.difficulty,
    autoBotShots: game.autoBotShots,
    soundMuted: game.soundMuted,
    goalsTotal: game.goalsTotal,
    savesTotal: game.savesTotal,
    likeEnergy: game.likeEnergy,
    nextShotSuper: game.nextShotSuper,
    currentShot: game.currentShot,
    queue: game.queue.slice(0, 6).map((q) => ({
      nickname: q.nickname,
      zone: q.zone,
      isBot: q.isBot,
      isSuper: q.isSuper
    })),
    queueCount: game.queue.length,
    feed: game.feed,
    leaderboard: getSortedBoard()
  };
}

function broadcastState() {
  io.emit('penalty-state', buildState());
}

function spawnBotShot() {
  const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  const zone = 1 + Math.floor(Math.random() * 3);
  return {
    id: game.nextId++,
    uniqueId: `bot_${name}`,
    nickname: `🤖 ${name}`,
    zone,
    isBot: true,
    isSuper: false
  };
}

function enqueueShot({ uniqueId, nickname, zone, explicit = false, isVip = false, giftName = '' }) {
  if (!isVip) {
    const existing = game.queue.find((item) => item.uniqueId === uniqueId);
    if (existing) {
      if (explicit) {
        existing.zone = zone;
        broadcastState();
      }
      return false;
    }
  }

  const shot = {
    id: game.nextId++,
    uniqueId,
    nickname: String(nickname || uniqueId).slice(0, 18),
    zone,
    isBot: false,
    isSuper: isVip,
    giftName
  };

  if (isVip) {
    game.queue.unshift(shot);
    pushFeed(`🎁 ${shot.nickname} VIP QIZIL TOP atdı!`, 'vip');
  } else {
    const firstBotIdx = game.queue.findIndex((q) => q.isBot);
    if (firstBotIdx === -1) game.queue.push(shot);
    else game.queue.splice(firstBotIdx, 0, shot);
  }

  if (game.queue.length > 250) game.queue.length = 250;
  broadcastState();
  return true;
}

function getStageTimings() {
  const qLen = game.queue.length;
  if (qLen >= 12) return { aim: 700, kick: 750, result: 900 };
  if (qLen >= 4) return { aim: 1000, kick: 850, result: 1150 };
  return { aim: 1450, kick: 900, result: 1650 };
}

function pickNextShot() {
  clearTimeout(game.loopTimer);

  let next = game.queue.shift();
  if (!next) {
    if (game.autoBotShots) {
      next = spawnBotShot();
    } else {
      game.phase = 'aim';
      game.currentShot = null;
      broadcastState();
      game.loopTimer = setTimeout(pickNextShot, 1000);
      return;
    }
  }

  const useSuper = next.isSuper || game.nextShotSuper;
  if (!next.isSuper && game.nextShotSuper) {
    game.nextShotSuper = false;
  }

  game.phase = 'aim';
  game.phaseStartedAt = Date.now();
  game.currentShot = {
    ...next,
    isSuper: useSuper,
    keeperZone: 2,
    outcome: null,
    pointsEarned: 0,
    streakAfter: 0
  };
  io.emit('penalty-fx', { type: 'whistle' });
  broadcastState();

  game.loopTimer = setTimeout(executeKick, getStageTimings().aim);
}

function executeKick() {
  if (!game.currentShot) {
    pickNextShot();
    return;
  }

  const shot = game.currentShot;
  const saveProb = DIFFICULTIES[game.difficulty] || 0.34;

  // Determine keeper dive: Super Shot CANNOT be saved!
  let keeperZone;
  if (shot.isSuper) {
    const others = [1, 2, 3].filter((z) => z !== shot.zone);
    keeperZone = others[Math.floor(Math.random() * others.length)];
  } else if (Math.random() < saveProb) {
    keeperZone = shot.zone;
  } else {
    const others = [1, 2, 3].filter((z) => z !== shot.zone);
    keeperZone = others[Math.floor(Math.random() * others.length)];
  }

  shot.keeperZone = keeperZone;
  shot.outcome = shot.isSuper || shot.zone !== keeperZone ? 'goal' : 'saved';

  game.phase = 'kick';
  game.phaseStartedAt = Date.now();
  io.emit('penalty-fx', { type: 'kick', zone: shot.zone, keeperZone, isSuper: shot.isSuper });
  broadcastState();

  game.loopTimer = setTimeout(finishShotResult, getStageTimings().kick);
}

function finishShotResult() {
  if (!game.currentShot) {
    pickNextShot();
    return;
  }

  const shot = game.currentShot;
  game.phase = 'result';
  game.phaseStartedAt = Date.now();

  if (shot.outcome === 'goal') {
    game.goalsTotal += 1;
    if (!shot.isBot) {
      const prevStreak = game.streaks.get(shot.uniqueId) || 0;
      const newStreak = prevStreak + 1;
      game.streaks.set(shot.uniqueId, newStreak);
      const streakMul = newStreak >= 5 ? 3 : newStreak >= 3 ? 2 : 1;
      const shotMul = shot.isSuper ? 2 : 1;
      const pts = 100 * streakMul * shotMul;
      shot.pointsEarned = pts;
      shot.streakAfter = newStreak;

      const entry = game.leaderboard.get(shot.uniqueId) || {
        uniqueId: shot.uniqueId,
        nickname: shot.nickname,
        goals: 0,
        score: 0,
        bestStreak: 0
      };
      entry.goals += 1;
      entry.score += pts;
      entry.nickname = shot.nickname;
      entry.bestStreak = Math.max(entry.bestStreak, newStreak);
      game.leaderboard.set(shot.uniqueId, entry);

      const badge = shot.isSuper ? '⚡ SUPER ' : newStreak >= 3 ? `🔥×${streakMul} ` : '';
      pushFeed(`⚽ ${badge}${shot.nickname} QOL VURDU! (+${pts})`, 'goal');
    } else {
      pushFeed(`⚽ ${shot.nickname} qol vurdu`, 'goal');
    }
    io.emit('penalty-fx', { type: 'goal', isSuper: shot.isSuper, nickname: shot.nickname });
  } else {
    game.savesTotal += 1;
    if (!shot.isBot) {
      game.streaks.set(shot.uniqueId, 0);
    }
    pushFeed(`🧤 Qapıçı ${shot.nickname}-ın zərbəsini TUTDU!`, 'save');
    io.emit('penalty-fx', { type: 'save', nickname: shot.nickname });
  }

  broadcastState();
  game.loopTimer = setTimeout(pickNextShot, getStageTimings().result);
}

function parseZoneCommand(rawText) {
  const clean = String(rawText || '').trim().toLowerCase().replace(/а/g, 'a');
  if (!clean) return null;
  if (/^[1¹]\b|^1[!?.]*$|^(sol|left|a\s*1)$/i.test(clean)) return { zone: 1, explicit: true };
  if (/^[2²]\b|^2[!?.]*$|^(orta|center|mid|a\s*2)$/i.test(clean)) return { zone: 2, explicit: true };
  if (/^[3³]\b|^3[!?.]*$|^(sag|sağ|right|a\s*3)$/i.test(clean)) return { zone: 3, explicit: true };
  // "a" (or go/oyna/vur/+) joins the strict arrival queue with random corner
  if (/^(a|go|vur|qol|gol|penalti|oyna|\+)[!?.]*$/i.test(clean)) {
    return { zone: 1 + Math.floor(Math.random() * 3), explicit: false };
  }
  return null;
}

function handleViewerChat({ uniqueId, nickname, comment }) {
  const parsed = parseZoneCommand(comment);
  if (!parsed) return;
  enqueueShot({ uniqueId, nickname, zone: parsed.zone, explicit: parsed.explicit, isVip: false });
}

function handleViewerLike(count) {
  game.likeEnergy += Math.max(1, Number(count) || 1) * 3;
  if (game.likeEnergy >= 100) {
    game.likeEnergy = 0;
    game.nextShotSuper = true;
    pushFeed('🔥 SUPER ŞUT ENERJİSİ DOLDU! Növbəti zərbə tutulmazdır!', 'vip');
  }
  broadcastState();
}

function handleViewerGift({ uniqueId, nickname, giftName }) {
  const zone = 1 + Math.floor(Math.random() * 3);
  enqueueShot({ uniqueId, nickname, zone, isVip: true, giftName });
}

// ==================== TIKTOK CONNECTOR ====================
function emitTikTokStatus() {
  io.emit('tiktok-status', {
    connecting: tiktok.connecting,
    connected: tiktok.connected,
    username: tiktok.username,
    viewerCount: tiktok.viewerCount,
    error: tiktok.error
  });
}

function scheduleReconnect(delayMs = 6000) {
  clearTimeout(tiktok.reconnectTimer);
  if (!tiktok.username) return;
  tiktok.reconnectTimer = setTimeout(() => {
    if (!tiktok.connected && !tiktok.connecting) {
      connectTikTok(tiktok.username, false);
    }
  }, delayMs);
}

async function disconnectTikTok(clearUser = false) {
  clearTimeout(tiktok.reconnectTimer);
  const old = tiktok.conn;
  tiktok.conn = null;
  tiktok.connecting = false;
  tiktok.connected = false;
  tiktok.viewerCount = 0;
  if (clearUser) tiktok.username = '';
  if (old) {
    try { await old.disconnect(); } catch (_) {}
  }
  emitTikTokStatus();
}

async function connectTikTok(rawUsername, isManual = false) {
  const clean = (rawUsername || '').trim().replace(/^@+/, '').toLowerCase();
  if (!clean) {
    tiktok.error = 'İstifadəçi adı boşdur';
    emitTikTokStatus();
    return;
  }

  await disconnectTikTok(false);
  tiktok.username = clean;
  tiktok.connecting = true;
  tiktok.error = '';
  emitTikTokStatus();

  console.log(`[TikTok] @${clean} canlı yayımına qoşulur...`);
  const conn = new TikTokLiveConnection(clean, {
    processInitialData: false,
    enableExtendedGiftInfo: false,
    requestPollingIntervalMs: 1200
  });
  tiktok.conn = conn;

  conn.on(WebcastEvent.CHAT, (data) => {
    if (tiktok.conn !== conn) return;
    const uniqueId = String(data.user?.displayId || data.user?.uniqueId || data.user?.id || data.user?.userId || data.uniqueId || 'viewer');
    const nickname = String(data.user?.nickname || uniqueId);
    const comment = String(data.content ?? data.comment ?? '').trim();
    if (!comment) return;
    handleViewerChat({ uniqueId, nickname, comment });
  });

  conn.on(WebcastEvent.LIKE, (data) => {
    if (tiktok.conn !== conn) return;
    handleViewerLike(Number(data.count ?? data.likeCount ?? 1));
  });

  conn.on(WebcastEvent.GIFT, (data) => {
    if (tiktok.conn !== conn) return;
    const giftType = data.gift?.type ?? data.giftDetails?.giftType;
    if (giftType === 1 && !data.repeatEnd) return;
    const uniqueId = String(data.user?.displayId || data.user?.uniqueId || data.user?.id || 'viewer');
    const nickname = String(data.user?.nickname || uniqueId);
    const giftName = data.gift?.name || data.giftDetails?.giftName || `Hədiyyə #${data.giftId}`;
    handleViewerGift({ uniqueId, nickname, giftName });
  });

  conn.on(WebcastEvent.ROOM_USER, (data) => {
    if (tiktok.conn !== conn) return;
    const rawVc = data.viewerCount ?? data.total ?? data.totalUser;
    if (rawVc !== undefined && rawVc !== null && rawVc !== '') {
      const vc = Number(rawVc);
      if (Number.isFinite(vc)) {
        tiktok.viewerCount = vc;
        emitTikTokStatus();
      }
    }
  });

  conn.on(WebcastEvent.STREAM_END, () => {
    if (tiktok.conn !== conn) return;
    tiktok.connected = false;
    tiktok.connecting = false;
    tiktok.error = 'Canlı yayım bitdi';
    emitTikTokStatus();
    scheduleReconnect(15000);
  });

  conn.on(ControlEvent.DISCONNECTED, () => {
    if (tiktok.conn !== conn) return;
    if (tiktok.connected) {
      tiktok.connected = false;
      tiktok.connecting = false;
      emitTikTokStatus();
      scheduleReconnect(5000);
    }
  });

  conn.on(ControlEvent.ERROR, (err) => {
    if (tiktok.conn !== conn) return;
    console.error('[TikTok ERROR]', err?.exception?.message || err?.info || err);
  });

  try {
    const state = await conn.connect();
    if (tiktok.conn !== conn) return;
    tiktok.connecting = false;
    tiktok.connected = true;
    tiktok.viewerCount = Number(state?.roomInfo?.data?.user_count ?? state?.roomInfo?.user_count ?? 0) || 0;
    tiktok.error = '';
    console.log(`[TikTok] Qoşuldu! Room ID: ${state.roomId}`);
    emitTikTokStatus();
  } catch (err) {
    if (tiktok.conn !== conn) return;
    const rawMsg = err?.message || String(err || '');
    const isOffline = /offline|not live|UserOffline|isn't online/i.test(rawMsg);
    tiktok.connecting = false;
    tiktok.connected = false;
    tiktok.error = isOffline
      ? `@${clean} hazırda canlı yayımda deyil (canlı başlayanda qoşulacaq)`
      : `Qoşulma xətası: ${rawMsg.slice(0, 90)}`;
    console.warn(`[TikTok] Qoşulmadı (${isOffline ? 'offline' : rawMsg})`);
    emitTikTokStatus();
    if (!isManual || isOffline) {
      scheduleReconnect(15000);
    }
  }
}

// ==================== SOCKET CONTROLS ====================
io.on('connection', (socket) => {
  socket.emit('penalty-state', buildState());
  socket.emit('tiktok-status', {
    connecting: tiktok.connecting,
    connected: tiktok.connected,
    username: tiktok.username,
    viewerCount: tiktok.viewerCount,
    error: tiktok.error
  });

  socket.on('kick-now', () => {
    if (game.phase === 'aim' && game.currentShot) {
      clearTimeout(game.loopTimer);
      executeKick();
    }
  });

  socket.on('toggle-bots', ({ enabled } = {}) => {
    game.autoBotShots = !!enabled;
    saveSettings({ autoBotShots: game.autoBotShots });
    broadcastState();
  });

  socket.on('set-difficulty', ({ difficulty } = {}) => {
    if (!DIFFICULTIES[difficulty]) return;
    game.difficulty = difficulty;
    saveSettings({ difficulty });
    broadcastState();
  });

  socket.on('set-theme', ({ theme } = {}) => {
    if (!THEMES.includes(theme)) return;
    game.theme = theme;
    saveSettings({ theme });
    broadcastState();
  });

  socket.on('toggle-sound', ({ muted } = {}) => {
    game.soundMuted = !!muted;
    broadcastState();
  });

  socket.on('reset-scores', () => {
    game.goalsTotal = 0;
    game.savesTotal = 0;
    game.leaderboard.clear();
    game.streaks.clear();
    game.feed = [];
    pushFeed('🔄 Hesab və xallar sıfırlandı!', 'info');
    broadcastState();
  });

  socket.on('connect-tiktok', ({ username } = {}) => connectTikTok(username, true));
  socket.on('disconnect-tiktok', () => disconnectTikTok(true));
  socket.on('manual-kick', ({ nickname, zone, isVip } = {}) => {
    const z = [1, 2, 3].includes(Number(zone)) ? Number(zone) : 2;
    enqueueShot({
      uniqueId: `host_${Date.now()}_${Math.random()}`,
      nickname: nickname || 'Aparıcı_Test',
      zone: z,
      isVip: !!isVip,
      giftName: isVip ? 'Qızıl Top' : ''
    });
  });
});

// ==================== BOOT ====================
pickNextShot();

server.listen(PORT, () => {
  console.log(`\n================================================`);
  console.log(`  Canli Penalti Dueli Server isleyir!`);
  console.log(`  Aparici Studiyasi : http://localhost:${PORT}`);
  console.log(`  OBS / Studio Link : http://localhost:${PORT}/?overlay=1`);
  console.log(`  TikTok Kanal      : @${tiktok.username}`);
  console.log(`================================================\n`);
  connectTikTok(DEFAULT_TIKTOK_USER, false);
});

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err?.stack || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});
