const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const MAP = require('./shared/map');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
// CORS_ORIGIN lets a separately hosted website (e.g. on Vercel) connect.
// Comma-separated list, e.g. "https://lunch-spy.vercel.app". Defaults to allowing any site.
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : '*';
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000, cors: { origin: CORS_ORIGIN } });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));
app.get('/health', (req, res) => res.send('ok'));

// ---- Tunables ----
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 3;
const TASK_TIME = 3000;
const TASKS_PER_STUDENT = 5;
const MISSIONS_PER_SPY = 3;
const COVER_TASKS = 3;
const MEETING_TIME = 90000;
const RESULT_TIME = 6500;
const BELL_COOLDOWN = 15000;
const HEAR_RANGE = 340;
const LOBBY_GRACE = 45000;

const rooms = new Map();
const stationById = Object.fromEntries(MAP.stations.map(s => [s.id, s]));

// ---- Helpers ----
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function makeCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do {
    c = '';
    for (let i = 0; i < 4; i++) c += L[Math.floor(Math.random() * L.length)];
  } while (rooms.has(c));
  return c;
}
function cleanName(n) {
  return String(n || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
}
function emitTo(p, ev, data) {
  if (p.connected && p.socketId) io.to(p.socketId).emit(ev, data);
}
function players(room) { return [...room.players.values()]; }

function pickColor(room, wanted) {
  const taken = new Set(players(room).map(p => p.color));
  if (MAP.COLORS.includes(wanted) && !taken.has(wanted)) return wanted;
  return MAP.COLORS.find(c => !taken.has(c)) || MAP.COLORS[0];
}

function createRoom() {
  const room = {
    code: makeCode(), hostId: null, players: new Map(), phase: 'lobby',
    round: 0, meeting: null, result: null, gameOver: null, bellReadyAt: 0,
    lastActive: Date.now(), scores: new Map()
  };
  rooms.set(room.code, room);
  return room;
}

function newPlayer(id, socketId, name, color) {
  return {
    id, socketId, name, color, x: MAP.bell.x, y: MAP.bell.y, dir: 1, moving: false,
    alive: true, left: false, role: null, tasks: [], missions: [], bellUsed: false,
    connected: true, action: null, vote: null, tpSeq: 0, lastSay: 0
  };
}

function fixHost(room) {
  const host = room.players.get(room.hostId);
  if (host && host.connected && !host.left) return;
  const next = players(room).find(p => p.connected && !p.left);
  if (next) room.hostId = next.id;
}

function removePlayer(room, id) {
  room.players.delete(id);
  if (room.players.size === 0) { rooms.delete(room.code); return; }
  fixHost(room);
  sendRoom(room);
}

function placeAtSpawn(room) {
  const list = players(room);
  list.forEach((p, i) => {
    const s = MAP.spawnPoint(i, list.length);
    p.x = s.x; p.y = s.y; p.moving = false; p.action = null; p.tpSeq++;
  });
}

// ---- What each player is allowed to see ----
function view(room, viewer) {
  const over = room.phase === 'over';
  const now = Date.now();
  const iAmSpy = viewer.role === 'spy' && room.phase !== 'lobby';
  const students = players(room).filter(p => p.role === 'student' && !p.left);
  const total = students.reduce((n, p) => n + p.tasks.length, 0);
  const done = students.reduce((n, p) => n + p.tasks.filter(t => t.done).length, 0);
  const spies = players(room).filter(p => p.role === 'spy');

  const v = {
    code: room.code,
    phase: room.phase,
    round: room.round,
    hostId: room.hostId,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: players(room).map(p => ({
      id: p.id, name: p.name, color: p.color, alive: p.alive, left: p.left,
      connected: p.connected,
      spy: (over || (iAmSpy && room.phase !== 'lobby')) ? p.role === 'spy' : undefined,
      voted: room.phase === 'meeting' ? !!p.vote : undefined
    })),
    me: {
      id: viewer.id, role: viewer.role, alive: viewer.alive, bellUsed: viewer.bellUsed,
      tasks: viewer.tasks, missions: viewer.missions,
      tp: { x: viewer.x, y: viewer.y, seq: viewer.tpSeq },
      vote: viewer.vote
    },
    progress: { done, total },
    bellIn: Math.max(0, room.bellReadyAt - now)
  };
  if (iAmSpy) {
    const mt = spies.reduce((n, p) => n + p.missions.length, 0);
    const md = spies.reduce((n, p) => n + p.missions.filter(m => m.done).length, 0);
    v.missionProgress = { done: md, total: mt };
  }
  if (room.meeting) {
    v.meeting = { caller: room.meeting.caller, callerColor: room.meeting.callerColor, left: Math.max(0, room.meeting.endsAt - now), id: room.meeting.id };
  }
  if (room.result) {
    v.result = { ejected: room.result.ejected, tally: room.result.tally, reason: room.result.reason, spiesLeft: room.result.spiesLeft, left: Math.max(0, room.result.endsAt - now) };
  }
  if (room.gameOver) v.gameOver = room.gameOver;
  v.scores = [...room.scores.values()]
    .sort((a, b) => b.wins - a.wins || a.games - b.games || a.name.localeCompare(b.name))
    .slice(0, 10);
  return v;
}

function sendRoom(room) {
  room.lastActive = Date.now();
  for (const p of room.players.values()) emitTo(p, 'room', view(room, p));
}

// ---- Game flow ----
function startGame(room) {
  for (const p of players(room)) if (!p.connected) room.players.delete(p.id);
  const list = shuffle(players(room));
  const spyCount = list.length >= 7 ? 2 : 1;
  const missionPool = shuffle(MAP.stations.filter(s => s.mission).map(s => s.id));
  const allIds = MAP.stations.map(s => s.id);

  list.forEach((p, i) => {
    p.role = i < spyCount ? 'spy' : 'student';
    p.alive = true; p.left = false; p.bellUsed = false; p.action = null; p.vote = null;
    if (p.role === 'spy') {
      p.missions = missionPool.splice(0, MISSIONS_PER_SPY).map(id => ({ id, done: false }));
      const mine = new Set(p.missions.map(m => m.id));
      p.tasks = shuffle(allIds.filter(id => !mine.has(id))).slice(0, COVER_TASKS).map(id => ({ id, done: false }));
    } else {
      p.missions = [];
      p.tasks = shuffle([...allIds]).slice(0, TASKS_PER_STUDENT).map(id => ({ id, done: false }));
    }
  });

  placeAtSpawn(room);
  room.round++;
  room.phase = 'playing';
  room.meeting = null; room.result = null; room.gameOver = null;
  room.bellReadyAt = Date.now() + BELL_COOLDOWN;
  sendRoom(room);
}

function endGame(room, winner, reason) {
  room.phase = 'over';
  room.meeting = null; room.result = null;
  for (const p of room.players.values()) {
    p.action = null;
    if (!p.role) continue;
    const s = room.scores.get(p.id) || { id: p.id, name: p.name, color: p.color, wins: 0, games: 0, spyWins: 0 };
    s.name = p.name; s.color = p.color; s.games++;
    const won = (winner === 'spies') === (p.role === 'spy');
    if (won) { s.wins++; if (p.role === 'spy') s.spyWins++; }
    room.scores.set(p.id, s);
  }
  room.gameOver = {
    winner, reason,
    spies: players(room).filter(p => p.role === 'spy').map(p => ({ name: p.name, color: p.color }))
  };
  sendRoom(room);
}

function checkWin(room) {
  if (room.phase !== 'playing' && room.phase !== 'result') return false;
  const all = players(room);
  const aliveSpies = all.filter(p => p.role === 'spy' && p.alive);
  const aliveStudents = all.filter(p => p.role === 'student' && p.alive);
  if (aliveSpies.length === 0) { endGame(room, 'students', 'All the spies were caught!'); return true; }
  if (aliveSpies.every(s => s.missions.every(m => m.done))) { endGame(room, 'spies', 'The spies finished all their secret missions!'); return true; }
  if (aliveSpies.length >= aliveStudents.length) { endGame(room, 'spies', 'The spies took over the cafeteria!'); return true; }
  const students = all.filter(p => p.role === 'student' && !p.left);
  const total = students.reduce((n, p) => n + p.tasks.length, 0);
  const done = students.reduce((n, p) => n + p.tasks.filter(t => t.done).length, 0);
  if (total > 0 && done >= total) { endGame(room, 'students', 'Everyone finished their lunch list!'); return true; }
  return false;
}

function cancelAction(room, p) {
  if (!p.action) return;
  const id = p.action.id;
  p.action = null;
  emitTo(p, 'actionEnd', { id, ok: false });
}

function completeAction(room, p) {
  const a = p.action;
  p.action = null;
  if (a.type === 'task') {
    const t = p.tasks.find(t => t.id === a.id);
    if (t) t.done = true;
  } else if (a.type === 'mission') {
    const m = p.missions.find(m => m.id === a.id);
    if (m) m.done = true;
    const s = stationById[a.id];
    const round = room.round;
    // Delay the alert so nobody knows exactly when it happened
    setTimeout(() => {
      if (room.round !== round || room.phase === 'lobby') return;
      io.to(room.code).emit('alert', { text: s.alert, station: s.id });
    }, 3000 + Math.random() * 7000);
  }
  emitTo(p, 'actionEnd', { id: a.id, ok: true, type: a.type });
  if (!checkWin(room)) sendRoom(room);
}

function startMeeting(room, caller) {
  for (const p of room.players.values()) { cancelAction(room, p); p.vote = null; p.moving = false; }
  room.phase = 'meeting';
  room.meeting = { id: Date.now(), caller: caller.name, callerColor: caller.color, endsAt: Date.now() + MEETING_TIME };
  io.to(room.code).emit('bellRung', { name: caller.name });
  sendRoom(room);
}

function checkMeetingDone(room) {
  if (room.phase !== 'meeting') return;
  const voters = players(room).filter(p => p.alive && p.connected);
  if (voters.length && voters.every(p => p.vote)) {
    room.meeting.endsAt = Math.min(room.meeting.endsAt, Date.now() + 2500);
  }
}

function endMeeting(room) {
  const tally = {};
  for (const p of room.players.values()) {
    if (p.alive && p.vote) tally[p.vote] = (tally[p.vote] || 0) + 1;
  }
  let best = null, bestN = 0, tie = false;
  for (const k in tally) {
    if (tally[k] > bestN) { best = k; bestN = tally[k]; tie = false; }
    else if (tally[k] === bestN) tie = true;
  }
  let ejected = null, reason = null;
  if (!best) reason = 'Nobody voted.';
  else if (tie) reason = "It's a tie!";
  else if (best === 'skip') reason = 'Most people skipped.';
  else {
    const t = room.players.get(best);
    if (t && t.alive) {
      t.alive = false; t.action = null;
      ejected = { id: t.id, name: t.name, color: t.color, wasSpy: t.role === 'spy' };
    }
  }
  const spiesLeft = players(room).filter(p => p.role === 'spy' && p.alive).length;
  room.phase = 'result';
  room.meeting = null;
  room.result = { ejected, tally, reason, spiesLeft, endsAt: Date.now() + RESULT_TIME };
  sendRoom(room);
}

function finishResult(room) {
  room.result = null;
  room.phase = 'playing';
  placeAtSpawn(room);
  room.bellReadyAt = Date.now() + BELL_COOLDOWN;
  if (!checkWin(room)) sendRoom(room);
}

// ---- Sockets ----
function ctx(socket) {
  const room = rooms.get(socket.data.room);
  if (!room) return null;
  const p = room.players.get(socket.data.pid);
  if (!p || p.socketId !== socket.id) return null;
  return { room, p };
}

io.on('connection', socket => {
  socket.on('join', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    data = data || {};
    const token = String(data.token || '').slice(0, 40);
    if (!token) return cb({ error: 'Missing player id. Refresh the page.' });
    const name = cleanName(data.name);

    let room;
    if (data.code) {
      room = rooms.get(String(data.code).toUpperCase().trim());
      if (!room) return cb({ error: 'Room not found. Check the code.' });
    } else {
      if (!name) return cb({ error: 'Enter your name first.' });
      room = createRoom();
    }

    let p = room.players.get(token);
    if (p && !p.left) {
      p.socketId = socket.id;
      p.connected = true;
      if (room.phase === 'lobby' && name) p.name = name;
    } else {
      if (room.phase !== 'lobby') return cb({ error: 'That game already started. Wait for the next round.' });
      if (room.players.size >= MAX_PLAYERS) return cb({ error: 'Room is full (10 players).' });
      if (!name) return cb({ error: 'Enter your name first.' });
      p = newPlayer(token, socket.id, name, pickColor(room, data.color));
      room.players.set(token, p);
    }
    if (!room.hostId || !room.players.get(room.hostId)) room.hostId = token;
    fixHost(room);

    socket.data.room = room.code;
    socket.data.pid = token;
    socket.join(room.code);
    cb({ ok: true, code: room.code });
    sendRoom(room);
  });

  socket.on('color', color => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    if (room.phase !== 'lobby') return;
    const taken = players(room).some(q => q !== p && q.color === color);
    if (MAP.COLORS.includes(color) && !taken) { p.color = color; sendRoom(room); }
  });

  socket.on('start', () => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    if (room.hostId !== p.id || room.phase !== 'lobby') return;
    const n = players(room).filter(q => q.connected).length;
    if (n < MIN_PLAYERS) return socket.emit('toast', `Need at least ${MIN_PLAYERS} players to start.`);
    startGame(room);
  });

  socket.on('move', d => {
    const c = ctx(socket); if (!c || !d) return;
    const { room, p } = c;
    if (room.phase !== 'playing' || d.t !== p.tpSeq) return;
    if (typeof d.x !== 'number' || typeof d.y !== 'number' || !isFinite(d.x) || !isFinite(d.y)) return;
    p.x = Math.max(0, Math.min(MAP.W, d.x));
    p.y = Math.max(0, Math.min(MAP.H, d.y));
    p.dir = d.dir < 0 ? -1 : 1;
    p.moving = !!d.m;
    if (p.action && dist(p, p.action) > 14) cancelAction(room, p);
  });

  socket.on('use', id => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    if (room.phase !== 'playing' || p.action || p.left) return;
    const s = stationById[id];
    if (!s || dist(p, s) > MAP.USE_RANGE + 25) return;
    let type = null;
    if (p.role === 'spy' && p.alive && p.missions.some(m => m.id === id && !m.done)) type = 'mission';
    else if (p.tasks.some(t => t.id === id && !t.done) && (p.alive || p.role === 'student')) type = 'task';
    else if (p.alive) type = 'idle'; // anyone can hang out at a station, to blend in
    if (!type) return;
    p.action = { id, type, x: p.x, y: p.y, start: Date.now() };
    emitTo(p, 'actionStart', { id, type, duration: TASK_TIME });
  });

  socket.on('cancel', () => {
    const c = ctx(socket); if (!c) return;
    cancelAction(c.room, c.p);
  });

  socket.on('bell', () => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    if (room.phase !== 'playing' || !p.alive || p.bellUsed) return;
    if (Date.now() < room.bellReadyAt) return;
    if (dist(p, MAP.bell) > MAP.BELL_RANGE + 30) return;
    p.bellUsed = true;
    startMeeting(room, p);
  });

  socket.on('vote', target => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    if (room.phase !== 'meeting' || !p.alive || p.vote) return;
    if (target !== 'skip') {
      const t = room.players.get(target);
      if (!t || !t.alive) return;
    }
    p.vote = target;
    checkMeetingDone(room);
    sendRoom(room);
  });

  socket.on('say', raw => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const now = Date.now();
    if (!text || now - p.lastSay < 600) return;
    p.lastSay = now;
    const msg = { from: p.id, name: p.name, color: p.color, text, ghost: !p.alive && room.phase !== 'lobby', t: now };
    if (room.phase === 'meeting' || room.phase === 'result') {
      msg.mode = 'meeting';
      for (const q of room.players.values()) if (!(msg.ghost && q.alive)) emitTo(q, 'chat', msg);
    } else if (room.phase === 'playing') {
      msg.mode = 'near';
      for (const q of room.players.values()) {
        if (msg.ghost && q.alive) continue;          // living can't hear ghosts
        if (!msg.ghost && q.alive && dist(p, q) > HEAR_RANGE) continue; // proximity
        emitTo(q, 'chat', msg);                       // ghosts hear everything
      }
    } else {
      msg.mode = 'lobby';
      for (const q of room.players.values()) emitTo(q, 'chat', msg);
    }
  });

  socket.on('playAgain', () => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    if (room.hostId !== p.id || room.phase !== 'over') return;
    for (const q of players(room)) if (!q.connected || q.left) room.players.delete(q.id);
    for (const q of room.players.values()) {
      q.role = null; q.tasks = []; q.missions = []; q.alive = true; q.vote = null; q.action = null; q.bellUsed = false;
    }
    room.phase = 'lobby'; room.gameOver = null; room.meeting = null; room.result = null;
    fixHost(room);
    sendRoom(room);
  });

  socket.on('leave', () => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    socket.leave(room.code);
    socket.data.room = null;
    if (room.phase === 'lobby' || room.phase === 'over') {
      removePlayer(room, p.id);
    } else {
      p.left = true; p.alive = false; p.connected = false; p.action = null;
      fixHost(room);
      if (!checkWin(room)) { checkMeetingDone(room); sendRoom(room); }
    }
  });

  socket.on('disconnect', () => {
    const c = ctx(socket); if (!c) return;
    const { room, p } = c;
    p.connected = false;
    cancelAction(room, p);
    if (room.phase === 'lobby') {
      setTimeout(() => {
        if (!p.connected && room.phase === 'lobby' && room.players.get(p.id) === p) removePlayer(room, p.id);
      }, LOBBY_GRACE);
    }
    fixHost(room);
    checkMeetingDone(room);
    sendRoom(room);
  });
});

// ---- Main loop: positions, actions, timers (15 times a second) ----
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === 'meeting' && now >= room.meeting.endsAt) endMeeting(room);
    else if (room.phase === 'result' && now >= room.result.endsAt) finishResult(room);
    if (room.phase !== 'playing') continue;

    for (const p of room.players.values()) {
      if (p.action && now - p.action.start >= TASK_TIME) completeAction(room, p);
      if (room.phase !== 'playing') break;
    }
    if (room.phase !== 'playing') continue;

    const list = players(room).filter(p => !p.left);
    for (const viewer of list) {
      if (!viewer.connected) continue;
      const out = [];
      for (const q of list) {
        if (q === viewer) continue;
        if (viewer.alive && !q.alive) continue; // living can't see ghosts
        out.push([q.id, Math.round(q.x), Math.round(q.y), q.dir, q.moving ? 1 : 0, q.action ? 1 : 0, q.alive ? 1 : 0]);
      }
      emitTo(viewer, 'pos', out);
    }
  }
}, 66);

// Clean up empty rooms
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const anyone = players(room).some(p => p.connected);
    if (!anyone && now - room.lastActive > 10 * 60 * 1000) rooms.delete(room.code);
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`\n  🕶️  Lunch Spy is running!\n`);
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  On your Wi-Fi:     http://${a.address}:${PORT}`);
    }
  }
  console.log('');
});
