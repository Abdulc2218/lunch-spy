(() => {
  'use strict';
  const M = window.MAP;
  const R = window.Retro;
  const $ = id => document.getElementById(id);
  const UI_FONT = '"Pixelify Sans", "Silkscreen", monospace';
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const sess = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };

  let token = store.get('ls_token');
  if (!token) {
    token = 'p' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    store.set('ls_token', token);
  }

  const SERVER = (window.LUNCH_SPY_SERVER || '').replace(/\/$/, '');
  const socket = io(SERVER || undefined, { transports: ['websocket', 'polling'] });

  const S = {
    code: null, room: null, me: null, round: -1,
    pos: { x: M.bell.x, y: M.bell.y }, dir: 1, moving: false, dirty: false, tpSeq: -1,
    others: new Map(), bubbles: new Map(), alerts: [],
    action: null, meetingEnds: 0, bellReady: 0, meetingId: null, voteSel: null,
    selColor: store.get('ls_color') || M.COLORS[0], revealOpen: false, useKey: '', bellKey: ''
  };
  if (!M.COLORS.includes(S.selColor)) S.selColor = M.COLORS[0];

  const stationById = Object.fromEntries(M.stations.map(s => [s.id, s]));
  const PLAY_CHIPS = ['Hi 👋', 'Follow me 🏃', 'Sus 👀', 'Where are you?', 'I saw something!', 'Not me!', 'Watch them 👁️', "Let's stick together", 'Help! 😱'];
  const MEET_CHIPS = ['Who did it? 🤔', 'Not me! 🙅', 'I saw someone 👀', 'Where was everyone?', 'I was in the kitchen', 'I was at the lunch line', 'I was in the dining hall', 'Let\'s skip', 'Trust me 🙏'];

  // ---------- small helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const playerById = id => S.room && S.room.players.find(p => p.id === id);
  const iAmSpy = () => S.me && S.me.role === 'spy';
  const amAlive = () => !S.me || S.me.alive;
  const myTaskOpen = id => S.me && S.me.tasks.some(t => t.id === id && !t.done);
  const myMissionOpen = id => S.me && S.me.alive && S.me.missions.some(m => m.id === id && !m.done);
  const vibrate = p => { if (!R.settings.vibrate) return; try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
  // Puts a pixelated emoji into an element (only redraws when it changes)
  function setPix(el, emoji, res, css) {
    const key = emoji + '|' + res + '|' + css;
    if (el.dataset.pix === key) return;
    el.dataset.pix = key;
    el.innerHTML = '';
    el.appendChild(R.pixEmoji(emoji, res, css));
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = amt < 0 ? 0 : 255, t = Math.abs(amt);
    r = Math.round((f - r) * t + r); g = Math.round((f - g) * t + g); b = Math.round((f - b) * t + b);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  function emo(c, e, x, y, size) {
    c.font = size + 'px ' + EMOJI_FONT;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(e, x, y);
  }

  // ---------- audio ----------
  let AC = null;
  function unlockAudio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (AC && AC.state === 'suspended') AC.resume();
  }
  function tone(f, d, type, vol, delay) {
    if (!AC) return;
    const master = (R.settings.volume == null ? 70 : R.settings.volume) / 100;
    if (master <= 0) return;
    const t = AC.currentTime + (delay || 0);
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square'; o.frequency.value = f;
    g.gain.setValueAtTime((vol || 0.12) * master * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(AC.destination);
    o.start(t); o.stop(t + d + 0.05);
  }
  const SFX = {
    done() { tone(660, 0.1); tone(990, 0.18, 'sine', 0.12, 0.1); },
    mission() { tone(330, 0.12, 'triangle'); tone(247, 0.25, 'triangle', 0.12, 0.12); },
    alert() { tone(220, 0.3, 'sawtooth', 0.06); tone(170, 0.45, 'sawtooth', 0.06, 0.28); },
    bell() { [0, 0.22, 0.44].forEach(d => tone(1046, 0.35, 'triangle', 0.14, d)); },
    start() { tone(520, 0.05, 'square', 0.04); },
    pop() { tone(880, 0.06, 'sine', 0.06); }
  };
  document.addEventListener('pointerdown', unlockAudio, { passive: true });

  // ---------- wake lock (keeps phone screen on during a game) ----------
  let wake = null;
  async function requestWake() {
    if (wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch (e) {}
  }
  function releaseWake() { if (wake) { wake.release().catch(() => {}); wake = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.room && S.room.phase !== 'lobby') requestWake();
  });

  // ---------- character drawing ----------
  function drawBean(c, x, y, s, color, o) {
    o = o || {};
    const dir = o.dir || 1, t = o.t || 0, moving = !!o.moving, ghost = !!o.ghost;
    c.save();
    c.translate(x, y);
    c.scale(s * dir, s);
    const bob = moving ? Math.abs(Math.sin(t * 12)) * -3 : 0;
    const dark = shade(color, -0.35);
    c.lineWidth = 3; c.strokeStyle = '#1a1026'; c.lineJoin = 'round';
    if (ghost) {
      c.globalAlpha = o.alpha != null ? o.alpha : 0.55;
      const fl = Math.sin(t * 3) * 3;
      c.translate(0, fl - 6);
    } else {
      c.fillStyle = 'rgba(0,0,0,.22)';
      c.beginPath(); c.ellipse(0, 0, 18, 6, 0, 0, Math.PI * 2); c.fill();
      const sw = moving ? Math.sin(t * 12) * 5 : 0;
      c.fillStyle = dark;
      rr(c, -13 + sw * 0.5, -15, 11, 15, 5); c.fill(); c.stroke();
      rr(c, 2 - sw * 0.5, -15, 11, 15, 5); c.fill(); c.stroke();
    }
    // backpack
    c.fillStyle = dark;
    rr(c, -23, -40 + bob, 11, 22, 5); c.fill(); c.stroke();
    // body
    c.fillStyle = color;
    if (ghost) {
      c.beginPath();
      c.moveTo(-16, -34);
      c.arc(0, -34, 16, Math.PI, 0);
      c.lineTo(16, -8);
      for (let i = 0; i <= 4; i++) {
        const px = 16 - i * 8;
        c.quadraticCurveTo(px - 4, i % 2 ? -14 : -2, px - 8, -8);
      }
      c.closePath(); c.fill(); c.stroke();
    } else {
      rr(c, -16, -52 + bob, 32, 42, 15); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.22)';
      rr(c, -11, -47 + bob, 6, 18, 3); c.fill();
    }
    // visor or sunglasses
    const vy = (ghost ? -42 : -43 + bob);
    if (o.glasses) {
      c.fillStyle = '#111';
      rr(c, -4, vy, 23, 11, 4); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.55)';
      rr(c, 2, vy + 2, 6, 3, 1.5); c.fill();
    } else {
      c.fillStyle = '#a6dcf7';
      rr(c, -3, vy, 21, 13, 6.5); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.8)';
      rr(c, 6, vy + 3, 7, 3.5, 1.7); c.fill();
    }
    c.restore();
  }

  // Beans in the UI are drawn tiny and scaled up with nearest-neighbour: pixel art
  function paintBean(cv, color, o, css) {
    const res = Math.max(22, Math.round(css / (css >= 80 ? 2.6 : 1.6)));
    cv.width = res; cv.height = res;
    cv.style.width = css + 'px'; cv.style.height = css + 'px';
    cv.classList.add('pixel');
    const c = cv.getContext('2d');
    c.clearRect(0, 0, res, res);
    drawBean(c, res / 2 + 1, res * 0.9, res / 62, color, o || {});
  }

  // ---------- screens ----------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  }
  function hideOverlays() {
    ['reveal', 'meeting', 'result', 'over', 'mapView', 'chatSheet', 'settings'].forEach(id => $(id).classList.add('hidden'));
    S.revealOpen = false;
  }
  let toastT = null;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms || 2200);
  }
  let alertT = null;
  function banner(msg) {
    const b = $('alertBanner');
    b.innerHTML = R.Win.html({
      title: 'ALERT.EXE', cls: 'sm', min: false, max: false, close: false,
      body: `<div class="dialog">${R.sprite('warn', { px: 2, cls: 'dicon' })}<p>${esc(msg)}</p></div>`
    });
    b.classList.remove('hidden');
    clearTimeout(alertT); alertT = setTimeout(() => b.classList.add('hidden'), 4500);
  }
  function feed(html, cls) {
    const f = $('feed');
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.innerHTML = html;
    f.appendChild(d);
    while (f.children.length > 4) f.removeChild(f.firstChild);
    setTimeout(() => d.remove(), 7000);
  }

  // Fit to the visible viewport (handles phone keyboards and browser bars)
  function fitHeight() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', h + 'px');
    if (document.activeElement && document.activeElement.tagName !== 'INPUT') window.scrollTo(0, 0);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitHeight);
  window.addEventListener('resize', fitHeight);
  fitHeight();

  // ---------- HOME ----------
  const nameIn = $('nameIn'), codeIn = $('codeIn');
  nameIn.value = store.get('ls_name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) codeIn.value = urlRoom.toUpperCase().slice(0, 4);

  function renderSwatches(el, taken, onPick) {
    el.innerHTML = '';
    M.COLORS.forEach(col => {
      const b = document.createElement('button');
      b.className = 'sw' + (col === S.selColor ? ' sel' : '') + (taken.has(col) && col !== S.selColor ? ' taken' : '');
      b.style.setProperty('--sw', col);
      b.type = 'button';
      b.setAttribute('aria-label', 'color');
      b.onclick = () => { if (!taken.has(col) || col === S.selColor) onPick(col); };
      el.appendChild(b);
    });
  }
  function renderHome() {
    renderSwatches($('colorPick'), new Set(), col => {
      S.selColor = col; store.set('ls_color', col); SFX.pop(); renderHome();
    });
    paintBean($('logoBean'), S.selColor, { glasses: true }, 88);
    paintBean($('radarBean'), S.selColor, { glasses: true }, 40);
  }
  renderHome();

  function homeErr(msg) {
    $('homeErr').textContent = msg || '';
    $('homeStatus').textContent = msg ? 'Error' : 'Ready';
    if (msg) R.Win.dialog({ title: 'Lunch Spy', icon: 'error', message: esc(msg) });
  }
  function doJoin(code) {
    const name = nameIn.value.trim();
    if (!name) { homeErr('Type your name first.'); return; }
    if (code !== null && code.length !== 4) { homeErr('Room codes have 4 letters.'); return; }
    store.set('ls_name', name);
    homeErr('');
    $('homeStatus').textContent = 'Dialing the cafeteria...';
    socket.emit('join', { name, color: S.selColor, code, token }, res => {
      if (!res || res.error) return homeErr(res ? res.error : 'Could not connect.');
      S.code = res.code;
      sess.set('ls_room', res.code);
      try { history.replaceState(null, '', '?room=' + res.code); } catch (e) {}
    });
  }
  $('createBtn').onclick = () => doJoin(null);
  $('joinBtn').onclick = () => doJoin(codeIn.value.trim().toUpperCase());
  codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  codeIn.addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') nameIn.blur(); });

  function leaveRoom() {
    socket.emit('leave');
    S.code = null; S.room = null; S.me = null; S.round = -1;
    sess.del('ls_room');
    try { history.replaceState(null, '', '/'); } catch (e) {}
    hideOverlays(); releaseWake();
    showScreen('home'); renderHome();
  }

  // ---------- LOBBY ----------
  $('leaveBtn').onclick = leaveRoom;
  $('codeBox').onclick = async () => {
    if (!S.code) return;
    const url = location.origin + '/?room=' + S.code;
    const text = 'Join my Lunch Spy game! Room code: ' + S.code;
    if (navigator.share) {
      try { await navigator.share({ title: 'Lunch Spy', text, url }); } catch (e) {}
    } else {
      try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); }
      catch (e) { toast('Room code: ' + S.code); }
    }
  };
  $('startBtn').onclick = () => { SFX.start(); socket.emit('start'); };

  function renderBoard(el, scores, meId) {
    if (!scores || !scores.length) {
      el.innerHTML = '<div class="empty">No games yet. Win a round to get on the board.</div>';
      return;
    }
    el.innerHTML = scores.map((s, i) =>
      `<div class="lb-row${s.id === meId ? ' me' : ''}"><span class="n">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="dot" style="background:${esc(s.color)}"></span><span class="nm">${esc(s.name.toUpperCase())}</span>` +
      `<span class="w">${String(s.wins).padStart(2, '0')}W/${String(s.games).padStart(2, '0')}G</span></div>`
    ).join('');
  }

  function renderLobby() {
    const v = S.room;
    $('roomCode').textContent = v.code;
    $('lobbyTitle').textContent = 'LOBBY - ROOM ' + v.code;
    const list = $('playerList');
    list.innerHTML = '';
    v.players.forEach(p => {
      const row = document.createElement('div');
      row.className = 'row' + (!p.connected ? ' off' : '') + (p.id === v.me.id ? ' sel' : '');
      const cv = document.createElement('canvas');
      row.appendChild(cv);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.innerHTML = esc(p.name) +
        `<span class="meta">${p.id === v.hostId ? '★ HOST' : !p.connected ? 'OFFLINE' : p.id === v.me.id ? 'YOU' : 'READY'}</span>`;
      row.appendChild(nm);
      list.appendChild(row);
      paintBean(cv, p.color, {}, 28);
    });
    renderBoard($('lbList'), v.scores, v.me.id);
    const online = v.players.filter(p => p.connected).length;
    $('pCount').textContent = String(v.players.length).padStart(2, '0');
    $('lobbyStatus').textContent = online < v.minPlayers ? 'Waiting for players...' : 'Ready to start';
    const me = v.players.find(p => p.id === v.me.id);
    if (me) S.selColor = me.color;
    const taken = new Set(v.players.filter(p => p.id !== v.me.id).map(p => p.color));
    renderSwatches($('lobbyColors'), taken, col => {
      S.selColor = col; store.set('ls_color', col); socket.emit('color', col);
    });
    const isHost = v.hostId === v.me.id;
    const host = v.players.find(p => p.id === v.hostId);
    $('startBtn').classList.toggle('hidden', !isHost);
    $('startBtn').disabled = online < v.minPlayers;
    if (isHost) {
      $('lobbyHint').textContent = online < v.minPlayers
        ? `Need ${v.minPlayers - online} more player${v.minPlayers - online > 1 ? 's' : ''}. Tap the code to invite friends.`
        : (online >= 7 ? '2 spies this round. Ready when you are!' : '1 spy this round. 7+ players gets 2 spies.');
    } else {
      $('lobbyHint').textContent = `Waiting for ${host ? host.name : 'the host'} to start...`;
    }
  }

  // ---------- socket events ----------
  socket.on('connect', () => {
    $('conn').classList.add('hidden');
    const saved = S.code || sess.get('ls_room');
    if (!saved) return;
    socket.emit('join', { code: saved, name: store.get('ls_name') || nameIn.value, color: S.selColor, token }, res => {
      if (!res || res.error) {
        S.code = null; S.room = null; sess.del('ls_room');
        hideOverlays(); showScreen('home'); renderHome();
        homeErr(res ? res.error : '');
      } else {
        S.code = res.code;
      }
    });
  });
  socket.on('disconnect', () => { if (S.code) $('conn').classList.remove('hidden'); });
  socket.on('toast', m => toast(m));

  socket.on('room', v => {
    const prev = S.room ? S.room.phase : null;
    S.room = v; S.me = v.me;
    if (v.phase === 'lobby') {
      hideOverlays(); releaseWake();
      showScreen('lobby');
      renderLobby();
      S.round = v.round;
      return;
    }
    if (!$('game').classList.contains('active')) { showScreen('game'); resize(); }
    requestWake();
    if (v.round !== S.round) { S.round = v.round; newRound(); }
    if (v.me.tp.seq !== S.tpSeq) {
      S.tpSeq = v.me.tp.seq; S.pos.x = v.me.tp.x; S.pos.y = v.me.tp.y; S.action = null; S.moving = false;
    }
    S.bellReady = performance.now() + v.bellIn;

    $('meeting').classList.toggle('hidden', v.phase !== 'meeting');
    if (v.phase === 'meeting') {
      if (S.meetingId !== v.meeting.id) {
        S.meetingId = v.meeting.id; S.voteSel = null;
        $('mLog').innerHTML = '';
        sysMsg(`🔔 ${esc(v.meeting.caller)} rang the lunch bell!`);
        $('chatSheet').classList.add('hidden'); $('mapView').classList.add('hidden');
        $('reveal').classList.add('hidden'); S.revealOpen = false;
      }
      S.meetingEnds = performance.now() + v.meeting.left;
      renderMeeting();
    }
    $('result').classList.toggle('hidden', v.phase !== 'result');
    if (v.phase === 'result' && prev !== 'result') renderResult();
    $('over').classList.toggle('hidden', v.phase !== 'over');
    if (v.phase === 'over' && prev !== 'over') renderOver();
    else if (v.phase === 'over') renderOverButtons();
    renderHud();
  });

  socket.on('pos', arr => {
    const seen = new Set();
    for (const [id, x, y, dir, m, busy, alive] of arr) {
      seen.add(id);
      let o = S.others.get(id);
      if (!o) { o = { x, y }; S.others.set(id, o); }
      if (Math.hypot(o.x - x, o.y - y) > 250) { o.x = x; o.y = y; }
      o.tx = x; o.ty = y; o.dir = dir; o.moving = !!m; o.busy = !!busy; o.alive = !!alive;
    }
    for (const id of [...S.others.keys()]) if (!seen.has(id)) S.others.delete(id);
  });

  socket.on('actionStart', d => {
    S.action = { id: d.id, type: d.type, start: performance.now(), duration: d.duration };
    vibrate(15);
  });
  socket.on('actionEnd', d => {
    S.action = null;
    if (!d.ok) return;
    if (d.type === 'task') { SFX.done(); vibrate(40); toast('✅ Task done!'); }
    else if (d.type === 'mission') { SFX.mission(); vibrate([30, 40, 30]); toast('🕶️ Mission done. Act natural...'); }
  });
  socket.on('alert', d => {
    SFX.alert(); vibrate([120, 60, 120]);
    banner(d.text);
    feed(esc(d.text), 'alert');
    S.alerts.push({ station: d.station, until: performance.now() + 10000 });
    if (S.room && S.room.phase === 'meeting') sysMsg(esc(d.text));
  });
  socket.on('bellRung', () => { SFX.bell(); vibrate([200, 80, 200]); });

  socket.on('chat', m => {
    const mine = m.from === S.me?.id;
    if (m.mode === 'meeting') {
      addLog(m, mine);
      if (!mine) SFX.pop();
    } else if (m.mode === 'near') {
      S.bubbles.set(m.from, { text: m.text, until: performance.now() + 5500 });
      if (!mine) {
        feed(`<b style="color:${esc(m.color)}">${esc(m.name)}${m.ghost ? ' 👻' : ''}:</b>${esc(m.text)}`);
        SFX.pop();
      }
    }
  });

  // ---------- round start / role reveal ----------
  function newRound() {
    S.others.clear(); S.bubbles.clear(); S.alerts = [];
    S.meetingId = null; S.action = null;
    $('feed').innerHTML = '';
    $('taskCard').classList.add('collapsed');
    hideOverlays();
    if (S.room.phase === 'playing') showReveal();
  }
  function showReveal() {
    const spy = iAmSpy();
    const me = playerById(S.me.id);
    paintBean($('revealBean'), me ? me.color : S.selColor, { glasses: spy }, 96);
    const h = $('revealRole');
    h.textContent = spy ? 'SPY' : 'STUDENT';
    h.className = spy ? 'spy' : '';
    const nSpies = S.room.players.filter(p => !p.left).length >= 7 ? 2 : 1;
    if (spy) {
      const partners = S.room.players.filter(p => p.spy && p.id !== S.me.id).map(p => p.name);
      $('revealText').textContent = (partners.length ? `Your partner is ${partners.join(', ')}. ` : '') +
        'Finish your secret missions without getting caught. Do normal tasks too so you blend in.';
    } else {
      $('revealText').textContent = `There ${nSpies > 1 ? 'are 2 spies' : 'is 1 spy'} at lunch today. Finish your lunch list and find them.`;
    }
    $('reveal').classList.remove('hidden');
    S.revealOpen = true;
    vibrate(spy ? [80, 60, 80, 60, 200] : 120);
    clearTimeout(S.revealT);
    S.revealT = setTimeout(closeReveal, 6000);
  }
  function closeReveal() { $('reveal').classList.add('hidden'); S.revealOpen = false; }
  $('reveal').onclick = closeReveal;

  // ---------- HUD ----------
  $('taskList').onclick = () => { $('taskCard').classList.toggle('collapsed'); renderHud(); };
  function taskLi(id, done, text, cls) {
    const s = stationById[id];
    return `<li class="${cls || ''}${done ? ' done' : ''}"><span>${s.emoji}</span><span>${esc(text)}<small>${esc(s.room)}</small></span></li>`;
  }
  function renderHud() {
    const v = S.room, me = S.me;
    if (!v || !me || !me.role) return;
    const spy = me.role === 'spy';
    const badge = $('roleBadge');
    badge.className = 'role-tag' + (spy ? ' spy' : '') + (!me.alive ? ' ghost' : '');
    badge.textContent = !me.alive ? 'GHOST' : (spy ? 'SPY' : 'STUDENT');
    // segmented bar: snap to whole blocks of 9px
    const pct = v.progress.total ? (v.progress.done / v.progress.total) : 0;
    const bar = $('classBar'), track = bar.parentElement.clientWidth - 6;
    const blocks = Math.floor(Math.max(0, track) / 9);
    bar.style.width = (Math.round(pct * blocks) * 9) + 'px';
    $('barLabel').textContent = 'Class';
    const mine = spy ? me.missions : me.tasks;
    $('hudTasks').textContent = String(mine.filter(t => t.done).length).padStart(2, '0');
    $('hudAlive').textContent = String(v.players.filter(p => p.alive && !p.left).length).padStart(2, '0');
    let html = '';
    if ($('taskCard').classList.contains('collapsed')) {
      const open = [];
      if (spy) me.missions.forEach(m => { if (!m.done) open.push(taskLi(m.id, false, stationById[m.id].mission, 'mission compact')); });
      me.tasks.forEach(t => { if (!t.done) open.push(taskLi(t.id, false, stationById[t.id].task, 'compact')); });
      html = open.slice(0, 2).join('') + `<li class="sep">${open.length > 2 ? '+' + (open.length - 2) + ' more · ' : ''}tap to see all ▾</li>`;
    } else if (spy) {
      html += '<li class="sep red">🕶️ SECRET MISSIONS</li>';
      me.missions.forEach(m => { html += taskLi(m.id, m.done, stationById[m.id].mission, 'mission'); });
      html += '<li class="sep">COVER TASKS · just for show</li>';
      me.tasks.forEach(t => { html += taskLi(t.id, t.done, stationById[t.id].task); });
    } else {
      me.tasks.forEach(t => { html += taskLi(t.id, t.done, stationById[t.id].task); });
    }
    if (spy) {
      $('taskTitle').textContent = 'SPY_LIST.TXT';
      $('taskCount').textContent = me.missions.filter(m => m.done).length + '/' + me.missions.length;
    } else {
      $('taskTitle').textContent = 'LUNCH_LIST.TXT';
      $('taskCount').textContent = me.tasks.filter(t => t.done).length + '/' + me.tasks.length;
    }
    $('taskList').innerHTML = html;
    $('ghostTag').classList.toggle('hidden', me.alive);
  }

  function nearestStation() {
    if (!S.me) return null;
    let best = null, bd = M.USE_RANGE;
    for (const s of M.stations) {
      const d = dist(S.pos, s);
      if (d > bd) continue;
      if (!amAlive() && !myTaskOpen(s.id)) continue;
      best = s; bd = d;
    }
    return best;
  }

  function updateButtons(now) {
    const v = S.room;
    const playing = v && v.phase === 'playing';
    const st = playing ? nearestStation() : null;
    let mode = null;
    if (st) {
      if (myMissionOpen(st.id)) mode = 'mission';
      else if (myTaskOpen(st.id) && (amAlive() || !iAmSpy())) mode = 'task';
      else if (amAlive()) mode = 'idle';
    }
    const key = (st ? st.id : '-') + '|' + mode + '|' + (S.action ? 1 : 0);
    if (key !== S.useKey) {
      S.useKey = key;
      const btn = $('useBtn');
      btn.disabled = !mode;
      btn.className = 'btn95 act use ' + (mode || '') + (S.action ? ' busy pressed' : '');
      setPix($('useIcon'), S.action ? '✋' : (st ? st.emoji : '✋'), 16, 40);
      $('useLabel').textContent = S.action ? 'STOP' : mode === 'mission' ? 'MISSION' : mode === 'task' ? 'DO TASK' : mode === 'idle' ? 'HANG OUT' : 'USE';
      const hint = $('useHint');
      if (S.action) hint.textContent = (S.action.type === 'mission' ? 'MISSION IN PROGRESS' : 'WORKING') + '... MOVE TO CANCEL';
      else if (st) hint.textContent = mode === 'mission' ? 'SECRET: ' + st.mission : mode === 'task' ? st.task : st.name + ' · not on your list, blend in';
      else hint.textContent = R.settings.controls === 'dpad' ? 'D-PAD TO MOVE · USE AT A STATION' : 'DRAG TO MOVE · USE AT A STATION';
    }
    // segmented progress inside USE
    const frac = S.action ? clamp((now - S.action.start) / S.action.duration, 0, 1) : 0;
    $('useProg').style.width = (Math.floor(frac * 12) / 12 * 100) + '%';

    // bell
    const nearBell = playing && amAlive() && S.me && !S.me.bellUsed && dist(S.pos, M.bell) < M.BELL_RANGE;
    const cool = Math.ceil((S.bellReady - now) / 1000);
    const bkey = nearBell + '|' + (cool > 0 ? cool : 0) + '|' + (S.me && S.me.bellUsed);
    if (bkey !== S.bellKey) {
      S.bellKey = bkey;
      const b = $('bellBtn');
      b.classList.toggle('hidden', !nearBell);
      b.classList.toggle('cool', cool > 0);
      setPix($('bellIco'), '🔔', 16, 32);
      $('bellLabel').textContent = cool > 0 ? cool + 's' : 'RING';
      $('hudBell').textContent = !S.me || S.me.bellUsed || !amAlive() ? '--' : cool > 0 ? String(Math.min(cool, 99)).padStart(2, '0') : 'OK';
    }

    // next task box: closest thing on my list
    if (S.me && playing && now - (S.nextT || 0) > 250) {
      S.nextT = now;
      let best = null, bd = 1e9;
      const consider = (id, txt) => { const s = stationById[id]; const d = dist(S.pos, s); if (d < bd) { bd = d; best = { s, txt }; } };
      S.me.missions.forEach(m => { if (!m.done && S.me.alive) consider(m.id, stationById[m.id].mission); });
      S.me.tasks.forEach(t => { if (!t.done && (S.me.alive || !iAmSpy())) consider(t.id, stationById[t.id].task); });
      if (best) {
        setPix($('nextIcon'), best.s.emoji, 12, 18);
        $('nextText').textContent = best.txt.toUpperCase() + ' ' + Math.max(1, Math.round(bd / 40)) + 'M';
      } else {
        $('nextIcon').innerHTML = ''; $('nextIcon').dataset.pix = '';
        $('nextText').textContent = 'ALL DONE';
      }
    }
  }

  function doUse() {
    if (!S.room || S.room.phase !== 'playing' || S.revealOpen) return;
    if (S.action) { socket.emit('cancel'); S.action = null; return; }
    const st = nearestStation();
    if (st) socket.emit('use', st.id);
  }
  function doBell() {
    if (performance.now() < S.bellReady) { toast('The bell is cooling down...'); return; }
    socket.emit('bell');
  }
  $('useBtn').onclick = doUse;
  $('bellBtn').onclick = doBell;

  // ---------- chat sheet ----------
  function makeChips(el, list, send) {
    el.innerHTML = '';
    list.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.textContent = t;
      b.onclick = () => send(t);
      el.appendChild(b);
    });
  }
  function say(text) {
    text = String(text || '').trim();
    if (!text) return;
    socket.emit('say', text);
  }
  makeChips($('qChips'), PLAY_CHIPS, t => { say(t); closeSheet(); });
  makeChips($('mChips'), MEET_CHIPS, t => say(t));
  function openSheet() {
    if (!S.room || S.room.phase !== 'playing') return;
    $('chatSheet').classList.remove('hidden');
    if (window.matchMedia('(pointer: fine)').matches) $('qInput').focus();
  }
  function closeSheet() { $('chatSheet').classList.add('hidden'); $('qInput').blur(); }
  $('chatBtn').onclick = openSheet;
  $('sheetClose').onclick = closeSheet;
  $('qForm').onsubmit = e => { e.preventDefault(); say($('qInput').value); $('qInput').value = ''; closeSheet(); };
  $('mForm').onsubmit = e => { e.preventDefault(); say($('mInput').value); $('mInput').value = ''; };

  // ---------- meeting ----------
  function sysMsg(html) {
    const d = document.createElement('div');
    d.className = 'msg sys'; d.innerHTML = html;
    $('mLog').appendChild(d); $('mLog').scrollTop = 1e9;
  }
  function addLog(m, mine) {
    const d = document.createElement('div');
    d.className = 'msg' + (mine ? ' mine' : '') + (m.ghost ? ' ghost' : '');
    d.innerHTML = `<b style="color:${esc(m.color)}">${esc(m.name)}${m.ghost ? ' 👻' : ''}</b>${esc(m.text)}`;
    const log = $('mLog');
    log.appendChild(d);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = 1e9;
  }
  function renderMeeting() {
    const v = S.room, me = S.me;
    $('mCaller').textContent = 'Called by ' + v.meeting.caller + (me.alive ? '' : ' · ghosts can\'t vote');
    const grid = $('mGrid');
    grid.innerHTML = '';
    v.players.filter(p => !p.left).forEach(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tile pcard' + (!p.alive ? ' dead' : '') + (S.voteSel === p.id ? ' sel' : '') +
        (p.id === me.id ? ' me' : '') + (iAmSpy() && p.spy ? ' spyteam' : '');
      const cv = document.createElement('canvas');
      b.appendChild(cv);
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name; b.appendChild(nm);
      const st = document.createElement('span'); st.className = 'st';
      st.textContent = !p.alive ? '👻' : p.voted ? '✓ voted' : (!p.connected ? 'offline' : '');
      b.appendChild(st);
      b.onclick = () => {
        if (!me.alive || me.vote || !p.alive) return;
        S.voteSel = S.voteSel === p.id ? null : p.id;
        SFX.pop(); renderMeeting();
      };
      grid.appendChild(b);
      paintBean(cv, p.color, { ghost: !p.alive, alpha: 0.8, glasses: iAmSpy() && p.spy }, 34);
    });
    const voted = !!me.vote;
    const vb = $('voteBtn'), sb = $('skipBtn');
    vb.disabled = !me.alive || voted || !S.voteSel;
    sb.disabled = !me.alive || voted;
    const selP = playerById(S.voteSel);
    vb.textContent = voted && me.vote !== 'skip' ? 'Voted ✓' : selP ? 'Vote ' + selP.name : 'Tap a player';
    sb.textContent = me.vote === 'skip' ? 'Skipped ✓' : 'Skip vote';
  }
  $('voteBtn').onclick = () => { if (S.voteSel) { socket.emit('vote', S.voteSel); vibrate(30); } };
  $('skipBtn').onclick = () => { socket.emit('vote', 'skip'); vibrate(30); };

  // ---------- result ----------
  let resT = null;
  function renderResult() {
    const r = S.room.result;
    const bean = $('resultBean');
    const sub = $('resultSub');
    clearTimeout(resT);
    sub.className = ''; sub.textContent = '';
    const prog = $('resultProg').parentElement;
    prog.classList.remove('run'); void prog.offsetWidth; prog.classList.add('run');
    if (r.ejected) {
      bean.classList.remove('hidden');
      paintBean(bean, r.ejected.color, {}, 90);
      bean.classList.remove('fly'); void bean.offsetWidth; bean.classList.add('fly');
      $('resultTitle').textContent = 'Sending ' + r.ejected.name + ' to detention...';
      resT = setTimeout(() => {
        $('resultTitle').textContent = r.ejected.name + ' was sent to detention.';
        sub.className = r.ejected.wasSpy ? 'spy' : 'notspy';
        sub.textContent = r.ejected.wasSpy ? r.ejected.name + ' WAS a spy! 🕶️' : r.ejected.name + ' was NOT a spy. 😬';
        r.ejected.wasSpy ? SFX.done() : SFX.alert();
      }, 1700);
    } else {
      bean.classList.add('hidden');
      $('resultTitle').textContent = 'Nobody was sent to detention.';
      sub.textContent = r.reason || '';
    }
    $('resultLeft').textContent = r.spiesLeft + (r.spiesLeft === 1 ? ' spy remains' : ' spies remain');
  }

  // ---------- game over ----------
  function renderOver() {
    const g = S.room.gameOver;
    const h = $('overTitle');
    const spiesWon = g.winner === 'spies';
    h.textContent = spiesWon ? 'SPIES WIN!' : 'STUDENTS WIN!';
    h.className = g.winner;
    const won = spiesWon === iAmSpy();
    $('overWinTitle').textContent = spiesWon ? 'LUNCH.EXE - Fatal Error' : 'SPY.EXE - Terminated';
    $('overIcon').innerHTML = R.sprite(spiesWon ? 'error' : 'info', { px: 2 });
    $('overReason').textContent = (spiesWon
      ? 'LUNCH.EXE has performed an illegal operation and will be shut down. '
      : 'SPY.EXE was caught and closed by the students. ') + g.reason + (won ? ' You won!' : ' You lost.');
    renderBoard($('overLb'), S.room.scores, S.me.id);
    const row = $('overSpies');
    row.innerHTML = '';
    g.spies.forEach(s => {
      const d = document.createElement('div');
      const cv = document.createElement('canvas');
      d.appendChild(cv);
      d.appendChild(document.createTextNode(s.name));
      row.appendChild(d);
      paintBean(cv, s.color, { glasses: true }, 64);
    });
    won ? SFX.done() : SFX.alert();
    vibrate(won ? [60, 40, 60, 40, 200] : 300);
    renderOverButtons();
  }
  function renderOverButtons() {
    const isHost = S.room.hostId === S.me.id;
    $('againBtn').classList.toggle('hidden', !isHost);
    $('overWait').classList.toggle('hidden', isHost);
  }
  $('againBtn').onclick = () => socket.emit('playAgain');
  $('overLeave').onclick = leaveRoom;

  // ---------- map overlay ----------
  function openMap() {
    if (!S.room || S.room.phase !== 'playing') return;
    $('mapView').classList.remove('hidden');
    drawMap();
  }
  function closeMap() { $('mapView').classList.add('hidden'); }
  $('mapBtn').onclick = openMap;
  $('mapView').onclick = closeMap;

  function drawMap() {
    const cv = $('mapCv');
    const availW = Math.min(window.innerWidth - 40, 880);
    const appH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || window.innerHeight;
    const availH = appH - 110;
    const rotate = availH > availW * 1.15;
    let s, cw, ch;
    if (rotate) { s = Math.min(availW / M.H, availH / M.W); cw = M.H * s; ch = M.W * s; }
    else { s = Math.min(availW / M.W, availH / M.H); cw = M.W * s; ch = M.H * s; }
    const r = 1; // 1 canvas pixel per CSS pixel: stays crunchy on hi-dpi phones
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    cv.width = cw * r; cv.height = ch * r;
    const c = cv.getContext('2d');
    if (rotate) c.setTransform(0, r * s, -r * s, 0, cw * r, 0);
    else c.setTransform(r * s, 0, 0, r * s, 0, 0);
    const now = performance.now();
    drawWorld(c, now, { x: 0, y: 0, w: M.W, h: M.H }, true);
    drawMarkers(c, now, 1.6);
    // me
    c.fillStyle = (playerById(S.me.id) || {}).color || '#fff';
    c.strokeStyle = '#fff'; c.lineWidth = 8;
    c.beginPath(); c.arc(S.pos.x, S.pos.y, 26, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#1a1026';
    c.font = '700 40px ' + UI_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.save(); c.translate(S.pos.x, S.pos.y - 60); if (rotate) c.rotate(-Math.PI / 2);
    c.lineWidth = 8; c.strokeStyle = '#fff'; c.strokeText('YOU', 0, 0); c.fillText('YOU', 0, 0);
    c.restore();
  }

  // ---------- joystick + keyboard ----------
  const joy = { id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
  const JOY_R = 50;
  const cv = $('cv');
  cv.addEventListener('pointerdown', e => {
    if (joy.id !== null || !S.room || S.room.phase !== 'playing') return;
    if (S.revealOpen) { closeReveal(); return; }
    if (R.settings.controls === 'dpad') return;
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.dx = 0; joy.dy = 0;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    const el = $('joy');
    el.style.left = e.clientX + 'px'; el.style.top = e.clientY + 'px';
    el.querySelector('.knob').style.transform = '';
    el.classList.remove('hidden');
    e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (e.pointerId !== joy.id) return;
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
    joy.dx = dx; joy.dy = dy;
    $('joy').querySelector('.knob').style.transform = `translate(${dx}px, ${dy}px)`;
    e.preventDefault();
  });
  function joyEnd(e) {
    if (e.pointerId !== joy.id) return;
    joy.id = null; joy.dx = 0; joy.dy = 0;
    $('joy').classList.add('hidden');
  }
  cv.addEventListener('pointerup', joyEnd);
  cv.addEventListener('pointercancel', joyEnd);
  cv.addEventListener('contextmenu', e => e.preventDefault());

  const keys = new Set();
  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (!S.room || S.room.phase !== 'playing') return;
    if (k === 'e' || k === ' ') { e.preventDefault(); doUse(); }
    else if (k === 'b') doBell();
    else if (k === 'enter') { e.preventDefault(); openSheet(); $('qInput').focus(); }
    else if (k === 'm') { $('mapView').classList.contains('hidden') ? openMap() : closeMap(); }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  // D-pad: one touch area, 8 directions from where the finger is (so diagonals work)
  const dpad = { id: null, x: 0, y: 0 };
  const dpadEl = $('dpad');
  const dpadBtns = [...dpadEl.querySelectorAll('.dpad-btn')];
  dpadBtns.forEach(b => {
    const arrow = { up: ['...#...', '..###..', '.#####.', '#######'], down: ['#######', '.#####.', '..###..', '...#...'],
      left: ['...#', '..##', '.###', '####', '.###', '..##', '...#'], right: ['#...', '##..', '###.', '####', '###.', '##..', '#...'] }[b.dataset.d];
    b.innerHTML = R.sprite(arrow, { px: 3 });
  });
  function dpadSet(e) {
    const r = dpadEl.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const dead = r.width * 0.14;
    dpad.x = Math.abs(dx) > dead ? Math.sign(dx) : 0;
    dpad.y = Math.abs(dy) > dead ? Math.sign(dy) : 0;
    if (Math.abs(dx) > Math.abs(dy) * 2.2) dpad.y = 0;
    if (Math.abs(dy) > Math.abs(dx) * 2.2) dpad.x = 0;
    dpadBtns.forEach(b => {
      const d = b.dataset.d;
      b.classList.toggle('pressed', (d === 'up' && dpad.y < 0) || (d === 'down' && dpad.y > 0) || (d === 'left' && dpad.x < 0) || (d === 'right' && dpad.x > 0));
    });
  }
  dpadEl.addEventListener('pointerdown', e => {
    if (S.revealOpen) { closeReveal(); return; }
    dpad.id = e.pointerId;
    try { dpadEl.setPointerCapture(e.pointerId); } catch (err) {}
    dpadSet(e); vibrate(8); e.preventDefault();
  });
  dpadEl.addEventListener('pointermove', e => { if (e.pointerId === dpad.id) dpadSet(e); });
  const dpadEnd = e => { if (e.pointerId !== dpad.id) return; dpad.id = null; dpad.x = 0; dpad.y = 0; dpadBtns.forEach(b => b.classList.remove('pressed')); };
  dpadEl.addEventListener('pointerup', dpadEnd);
  dpadEl.addEventListener('pointercancel', dpadEnd);

  function inputVector() {
    if (dpad.id !== null && (dpad.x || dpad.y)) { const m = Math.hypot(dpad.x, dpad.y); return { x: dpad.x / m, y: dpad.y / m }; }
    if (joy.id !== null) return { x: joy.dx / JOY_R, y: joy.dy / JOY_R };
    let x = 0, y = 0;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    if (keys.has('w') || keys.has('arrowup')) y -= 1;
    if (keys.has('s') || keys.has('arrowdown')) y += 1;
    const m = Math.hypot(x, y);
    return m > 0 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
  }

  // ---------- update loop ----------
  let lastSend = 0;
  function update(dt, now) {
    const v = S.room;
    if (v && v.phase === 'playing' && !S.revealOpen && $('chatSheet').classList.contains('hidden')) {
      const iv = inputVector();
      const mag = Math.hypot(iv.x, iv.y);
      if (mag > 0.18) {
        if (S.action) { socket.emit('cancel'); S.action = null; }
        const sp = M.SPEED * Math.min(1, mag) * dt;
        const dx = iv.x / mag * sp, dy = iv.y / mag * sp;
        if (amAlive()) {
          const r = M.moveCircle(S.pos.x, S.pos.y, dx, dy);
          S.pos.x = r.x; S.pos.y = r.y;
        } else {
          S.pos.x = clamp(S.pos.x + dx, 40, M.W - 40);
          S.pos.y = clamp(S.pos.y + dy, 40, M.H - 40);
        }
        if (Math.abs(iv.x) > 0.1) S.dir = iv.x > 0 ? 1 : -1;
        S.moving = true; S.dirty = true;
      } else if (S.moving) {
        S.moving = false; S.dirty = true;
      }
    } else if (S.moving) { S.moving = false; S.dirty = true; }

    if (S.dirty && now - lastSend > 60 && v && v.phase === 'playing') {
      lastSend = now;
      socket.emit('move', { x: Math.round(S.pos.x * 10) / 10, y: Math.round(S.pos.y * 10) / 10, dir: S.dir, m: S.moving ? 1 : 0, t: S.tpSeq });
      S.dirty = S.moving;
    }

    const k = 1 - Math.exp(-dt * 12);
    for (const o of S.others.values()) {
      o.x += (o.tx - o.x) * k;
      o.y += (o.ty - o.y) * k;
    }
    S.alerts = S.alerts.filter(a => a.until > now);
  }

  // ---------- world drawing ----------
  const ctx = cv.getContext('2d');
  const cv2 = $('cv2');
  const ctx2 = cv2.getContext('2d');
  let CW = 0, CH = 0, DPR = 1, SCALE = 1;
  function resize() {
    // Retro look: render at CSS resolution (or half of it) and upscale with nearest-neighbour.
    // Also much cheaper on phones than rendering at 3x.
    DPR = R.settings.pixel ? 0.5 : 1;
    CW = cv.clientWidth; CH = cv.clientHeight;
    cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
    cv2.width = cv.width; cv2.height = cv.height;
    SCALE = clamp(Math.sqrt(CW * CH) / 600, 0.7, 1.4);
  }

  const FLOORS = {
    dining:   { a: '#f2e3c4', b: '#ead5ab', ts: 60 },
    kitchen:  { a: '#e3ebee', b: '#d0dce1', ts: 40 },
    serving:  { a: '#efdcb8', b: '#e4cc9f', ts: 50 },
    office:   { a: '#b8875a', b: '#a8784d', ts: 0 },
    bathroom: { a: '#d4eef5', b: '#bfe2eb', ts: 30 }
  };
  const TABLE_FOOD = [['🍕', '🧃'], ['🍎', '🥪'], ['🍔', '🥛'], ['🌮', '🍪'], ['🥗', '🍌'], ['🍟', '🧁']];

  function drawWorld(c, now, view, isMap) {
    const vx0 = view.x - 60, vy0 = view.y - 60, vx1 = view.x + view.w + 60, vy1 = view.y + view.h + 60;
    // floors
    for (const r of M.rooms) {
      const f = FLOORS[r.floor];
      c.fillStyle = f.a;
      c.fillRect(r.x, r.y, r.w, r.h);
      c.fillStyle = f.b;
      if (f.ts) {
        const x0 = Math.max(r.x, Math.floor(vx0 / f.ts) * f.ts), x1 = Math.min(r.x + r.w, vx1);
        const y0 = Math.max(r.y, Math.floor(vy0 / f.ts) * f.ts), y1 = Math.min(r.y + r.h, vy1);
        for (let x = Math.floor(x0 / f.ts) * f.ts; x < x1; x += f.ts) {
          for (let y = Math.floor(y0 / f.ts) * f.ts; y < y1; y += f.ts) {
            if (((x / f.ts) + (y / f.ts)) % 2 === 0) continue;
            const ax = Math.max(x, r.x), ay = Math.max(y, r.y);
            const aw = Math.min(x + f.ts, r.x + r.w) - ax, ah = Math.min(y + f.ts, r.y + r.h) - ay;
            if (aw > 0 && ah > 0) c.fillRect(ax, ay, aw, ah);
          }
        }
      } else {
        for (let y = r.y + 22; y < r.y + r.h; y += 22) c.fillRect(r.x, y, r.w, 2);
      }
    }
    // room labels
    c.fillStyle = 'rgba(60,30,10,.09)';
    c.font = '700 40px ' + UI_FONT;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const r of M.rooms) c.fillText(r.label, r.lx, r.ly);

    // station spots (subtle)
    for (const s of M.stations) {
      c.fillStyle = 'rgba(255,255,255,.35)';
      c.beginPath(); c.ellipse(s.x, s.y + 4, 22, 9, 0, 0, Math.PI * 2); c.fill();
    }

    // props
    let ti = 0;
    for (const p of M.props) {
      if (p.x > vx1 || p.x + p.w < vx0 || p.y > vy1 || p.y + p.h < vy0) { if (p.type === 'table') ti++; continue; }
      drawProp(c, p, now, p.type === 'table' ? ti++ : 0);
    }
    // walls
    for (const w of M.walls) {
      if (w.x > vx1 || w.x + w.w < vx0 || w.y > vy1 || w.y + w.h < vy0) continue;
      c.fillStyle = '#3d2f5c';
      c.fillRect(w.x, w.y, w.w, w.h);
      c.fillStyle = '#56437f';
      c.fillRect(w.x, w.y, w.w, Math.min(8, w.h));
    }
  }

  function drawProp(c, p, now, idx) {
    const { x, y, w, h } = p;
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(30,20,45,.55)';
    switch (p.type) {
      case 'table': {
        c.fillStyle = '#8a5a3c';
        rr(c, x + 10, y, w - 20, 14, 6); c.fill(); c.stroke();
        rr(c, x + 10, y + h - 14, w - 20, 14, 6); c.fill(); c.stroke();
        c.fillStyle = '#5fb3c4';
        rr(c, x, y + 16, w, h - 32, 9); c.fill(); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.28)';
        rr(c, x + 8, y + 20, w - 16, 5, 2.5); c.fill();
        const f = TABLE_FOOD[idx % TABLE_FOOD.length];
        emo(c, f[0], x + w * 0.3, y + h / 2, 22);
        emo(c, f[1], x + w * 0.7, y + h / 2, 20);
        break;
      }
      case 'counter': {
        c.fillStyle = '#93a1ab'; rr(c, x, y, w, h, 6); c.fill(); c.stroke();
        c.fillStyle = '#c9d3d9'; rr(c, x + 4, y + 4, w - 8, 18, 4); c.fill();
        c.fillStyle = 'rgba(170,225,255,.55)'; c.fillRect(x + 10, y - 6, w - 20, 5);
        ['🍕', '🥗', '🍝', '🍗', '🌭', '🥦'].forEach((e, i) => emo(c, e, x + 40 + i * ((w - 80) / 5), y + 14, 22));
        break;
      }
      case 'stove': {
        c.fillStyle = '#3b3b46'; rr(c, x, y, w, h, 6); c.fill(); c.stroke();
        [0.2, 0.8].forEach(fx => {
          c.fillStyle = '#1e1e26'; c.beginPath(); c.arc(x + w * fx, y + h / 2, 16, 0, 7); c.fill();
          c.strokeStyle = 'rgba(255,90,40,' + (0.5 + 0.3 * Math.sin(now / 300 + fx * 9)) + ')';
          c.lineWidth = 3; c.beginPath(); c.arc(x + w * fx, y + h / 2, 11, 0, 7); c.stroke();
        });
        emo(c, '🍲', x + w / 2, y + h / 2, 36);
        break;
      }
      case 'freezer': {
        c.fillStyle = '#eef7fb'; rr(c, x, y, w, h, 6); c.fill(); c.stroke();
        c.strokeStyle = '#9bb4c0'; c.beginPath(); c.moveTo(x + w / 2, y + 6); c.lineTo(x + w / 2, y + h - 6); c.stroke();
        c.fillStyle = '#9bb4c0'; c.fillRect(x + w / 2 - 12, y + 26, 5, 18); c.fillRect(x + w / 2 + 7, y + 26, 5, 18);
        emo(c, '🧊', x + w / 2, y + h - 2, 22);
        break;
      }
      case 'steel': {
        c.fillStyle = '#b8c2c9'; rr(c, x, y, w, h, 6); c.fill(); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(x + 6, y + 6, w - 12, 5);
        emo(c, '🥕', x + 40, y + h / 2 + 4, 20); emo(c, '🔪', x + 100, y + h / 2 + 4, 20); emo(c, '🧅', x + 160, y + h / 2 + 4, 20);
        break;
      }
      case 'ksink': {
        c.fillStyle = '#cfd8dc'; rr(c, x, y, w, h, 6); c.fill(); c.stroke();
        c.fillStyle = '#90a4ae'; rr(c, x + 14, y + 10, w - 28, h - 20, 6); c.fill();
        emo(c, '🍽️', x + w / 2, y + h / 2, 20);
        break;
      }
      case 'easel': {
        c.fillStyle = '#7a4e2d'; rr(c, x - 4, y - 4, w + 8, h + 8, 5); c.fill(); c.stroke();
        c.fillStyle = '#2f5d46'; c.fillRect(x, y, w, h);
        c.fillStyle = 'rgba(255,255,255,.8)';
        c.fillRect(x + 8, y + 9, w - 16, 3); c.fillRect(x + 8, y + 18, w - 22, 3); c.fillRect(x + 8, y + 27, w - 18, 3);
        emo(c, '📋', x + w / 2, y - 16, 20);
        break;
      }
      case 'desk': {
        c.fillStyle = '#8a5a3c'; rr(c, x, y, w, h, 6); c.fill(); c.stroke();
        c.fillStyle = '#a8714a'; rr(c, x + 5, y + 5, w - 10, h - 10, 4); c.fill();
        emo(c, '💻', x + 60, y + h / 2, 26); emo(c, '☕', x + 140, y + h / 2, 20);
        break;
      }
      case 'safe': {
        c.fillStyle = '#4a4f5c'; rr(c, x, y, w, h, 6); c.fill(); c.stroke();
        c.fillStyle = '#c0c4cc'; c.beginPath(); c.arc(x + w / 2, y + h / 2, 14, 0, 7); c.fill();
        c.strokeStyle = '#4a4f5c'; c.lineWidth = 3; c.beginPath(); c.moveTo(x + w / 2, y + h / 2); c.lineTo(x + w / 2 + 9, y + h / 2 - 6); c.stroke();
        break;
      }
      case 'fountain': {
        c.fillStyle = '#dfe8ee'; rr(c, x, y, w, h, 6); c.fill(); c.stroke();
        c.fillStyle = '#7cc3e6'; rr(c, x + 8, y + 14, w - 16, h - 28, 5); c.fill();
        emo(c, '🥤', x + w / 2 + 2, y + h / 2, 22);
        break;
      }
      case 'vending': {
        const mw = w / 2 - 4;
        [['#e63946', 0], ['#3a86ff', mw + 8]].forEach(([col, off]) => {
          c.fillStyle = col; rr(c, x + off, y, mw, h, 6); c.fill(); c.stroke();
          c.fillStyle = '#d7ecff'; rr(c, x + off + 8, y + 8, mw - 26, h - 16, 4); c.fill();
          c.fillStyle = '#ffd166'; c.fillRect(x + off + mw - 14, y + 14, 6, 10);
        });
        emo(c, '🍫', x + 34, y + h / 2, 20); emo(c, '🍬', x + mw + 42, y + h / 2, 20);
        break;
      }
      case 'trash': {
        ['#43a047', '#1e88e5', '#616161'].forEach((col, i) => {
          const bx = x + i * (w / 3) + 4, bw = w / 3 - 8;
          c.fillStyle = col; rr(c, bx, y + 6, bw, h - 6, 6); c.fill(); c.stroke();
          c.fillStyle = shade(col, 0.25); rr(c, bx - 2, y, bw + 4, 10, 4); c.fill(); c.stroke();
        });
        emo(c, '♻️', x + w / 2, y + h / 2 + 4, 18);
        break;
      }
      case 'sink': {
        c.fillStyle = '#ffffff'; rr(c, x, y, w, h, 8); c.fill(); c.stroke();
        c.fillStyle = '#a7d8ea'; rr(c, x + 12, y + 8, w - 24, h - 16, 6); c.fill();
        emo(c, '🚰', x + w / 2, y - 2, 20);
        break;
      }
      case 'stall': {
        c.fillStyle = '#9fb8c8'; rr(c, x, y, w, h, 4); c.fill(); c.stroke();
        c.strokeStyle = '#6e8a9c'; c.beginPath(); c.moveTo(x + 10, y + 10); c.lineTo(x + w - 10, y + 10); c.stroke();
        emo(c, '🚽', x + w / 2, y + h / 2 + 6, 34);
        break;
      }
      case 'bell': {
        const ready = performance.now() >= S.bellReady;
        c.fillStyle = '#9c6a0c'; c.beginPath(); c.arc(x + w / 2, y + h / 2, 22, 0, 7); c.fill(); c.stroke();
        c.fillStyle = '#ffcf4a'; c.beginPath(); c.arc(x + w / 2, y + h / 2 - 3, 18, 0, 7); c.fill();
        c.save(); c.translate(x + w / 2, y - 6);
        if (ready) c.rotate(Math.sin(now / 160) * 0.18);
        emo(c, '🔔', 0, 0, 34);
        c.restore();
        break;
      }
      case 'plant': {
        c.fillStyle = '#b5643c'; rr(c, x + 6, y + 18, w - 12, h - 18, 5); c.fill(); c.stroke();
        emo(c, '🪴', x + w / 2, y + 10, 36);
        break;
      }
    }
  }

  function drawMarkers(c, now, sz) {
    sz = sz || 1;
    if (!S.me) return;
    const pulse = Math.sin(now / 250) * 4;
    const targets = [];
    S.me.missions.forEach(m => { if (!m.done && S.me.alive) targets.push([m.id, '#ff4d6d']); });
    S.me.tasks.forEach(t => { if (!t.done && (S.me.alive || !iAmSpy())) targets.push([t.id, '#ffc83d']); });
    for (const [id, col] of targets) {
      const s = stationById[id];
      c.strokeStyle = col; c.lineWidth = 4 * sz;
      c.beginPath(); c.ellipse(s.x, s.y + 4, (26 + pulse) * sz, (12 + pulse / 2) * sz, 0, 0, Math.PI * 2); c.stroke();
      if (sz > 1) emo(c, s.emoji, s.x, s.y - 40, 44);
    }
    for (const a of S.alerts) {
      const s = stationById[a.station];
      c.fillStyle = 'rgba(255,77,109,' + (0.35 + 0.25 * Math.sin(now / 120)) + ')';
      c.beginPath(); c.arc(s.x, s.y, 40 * sz, 0, 7); c.fill();
      emo(c, '❗', s.x, s.y - 50 * sz, 30 * sz);
    }
    return targets;
  }

  function wrapText(c, text, maxW) {
    const words = text.split(' '), lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, 4);
  }

  function render(now) {
    if (!$('game').classList.contains('active') || !S.me) return;
    if (cv.clientWidth !== CW || cv.clientHeight !== CH) resize();
    if (!CW || !CH) return;
    const s = SCALE;
    const vw = CW / s, vh = CH / s;
    let camX = S.pos.x - vw / 2, camY = S.pos.y - vh / 2;
    camX = vw >= M.W ? (M.W - vw) / 2 : clamp(camX, -80, M.W - vw + 80);
    camY = vh >= M.H ? (M.H - vh) / 2 : clamp(camY, -80, M.H - vh + 80);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#120c22';
    ctx.fillRect(0, 0, CW, CH);
    ctx.setTransform(DPR * s, 0, 0, DPR * s, -camX * s * DPR, -camY * s * DPR);
    drawWorld(ctx, now, { x: camX, y: camY, w: vw, h: vh });
    const targets = drawMarkers(ctx, now);
    renderTop(now, camX, camY, s, targets);
  }

  // Top layer: players, names, fog, bubbles, arrows. Never theme-filtered,
  // so player colours stay readable on the LCD/bitmap worlds.
  function renderTop(now, camX, camY, s, targets) {
    const ctx = ctx2;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    ctx.setTransform(DPR * s, 0, 0, DPR * s, -camX * s * DPR, -camY * s * DPR);

    // characters
    const alive = amAlive();
    const spyView = iAmSpy();
    const ents = [];
    for (const [id, o] of S.others) {
      const p = playerById(id);
      if (!p) continue;
      if (alive && !o.alive) continue;
      if (alive && dist(o, S.pos) > 360) continue;
      ents.push({ id, x: o.x, y: o.y, dir: o.dir, moving: o.moving, busy: o.busy, ghost: !o.alive, color: p.color, name: p.name, spy: p.spy });
    }
    const meP = playerById(S.me.id);
    if (meP) ents.push({ id: meP.id, me: true, x: S.pos.x, y: S.pos.y, dir: S.dir, moving: S.moving, busy: !!S.action, ghost: !alive, color: meP.color, name: meP.name, spy: meP.spy });
    ents.sort((a, b) => a.y - b.y);
    const t = now / 1000;
    for (const e of ents) {
      drawBean(ctx, e.x, e.y, 1, e.color, { dir: e.dir, t, moving: e.moving, ghost: e.ghost, glasses: spyView && e.spy });
      ctx.font = '600 15px ' + UI_FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,10,30,.85)';
      ctx.strokeText(e.name, e.x, e.y - 66);
      ctx.fillStyle = spyView && e.spy ? '#ff8fa3' : '#fff';
      ctx.fillText(e.name, e.x, e.y - 66);
      if (e.busy) {
        if (e.me && S.action) {
          const frac = clamp((now - S.action.start) / S.action.duration, 0, 1);
          ctx.fillStyle = 'rgba(0,0,0,.6)'; rr(ctx, e.x - 26, e.y - 88, 52, 9, 4.5); ctx.fill();
          ctx.fillStyle = S.action.type === 'mission' ? '#ff4d6d' : '#ffc83d';
          rr(ctx, e.x - 26, e.y - 88, 52 * frac, 9, 4.5); ctx.fill();
        } else {
          ctx.fillStyle = '#fff'; rr(ctx, e.x + 14, e.y - 98, 34, 20, 10); ctx.fill();
          ctx.fillStyle = '#3d2f5c';
          for (let i = 0; i < 3; i++) {
            const a = Math.sin(now / 150 - i) > 0 ? 1 : 0.35;
            ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(e.x + 22 + i * 9, e.y - 88, 3, 0, 7); ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
      e.sx = (e.x - camX) * s; e.sy = (e.y - camY) * s;
    }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // vision fog for the living
    if (alive) {
      const cx = (S.pos.x - camX) * s, cy = (S.pos.y - 25 - camY) * s;
      const VR = 330 * s;
      const g = ctx.createRadialGradient(cx, cy, VR * 0.6, cx, cy, VR);
      g.addColorStop(0, 'rgba(10,6,22,0)');
      g.addColorStop(1, 'rgba(10,6,22,0.88)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CW, CH);
    }

    // speech bubbles
    ctx.font = '500 14px ' + UI_FONT;
    for (const e of ents) {
      const b = S.bubbles.get(e.id);
      if (!b) continue;
      if (b.until < now) { S.bubbles.delete(e.id); continue; }
      const lines = wrapText(ctx, b.text, 160);
      const lh = 18;
      const bw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 20;
      const bh = lines.length * lh + 12;
      const bx = clamp(e.sx - bw / 2, 6, CW - bw - 6);
      const by = e.sy - 82 * s - bh;
      ctx.fillStyle = e.ghost ? 'rgba(220,215,240,.9)' : '#fff';
      rr(ctx, bx, by, bw, bh, 12); ctx.fill();
      ctx.beginPath(); ctx.moveTo(e.sx - 7, by + bh - 1); ctx.lineTo(e.sx + 7, by + bh - 1); ctx.lineTo(e.sx, by + bh + 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1d1433'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, by + 6 + lh / 2 + i * lh));
    }

    // arrows to off-screen tasks
    if (targets && S.room.phase === 'playing') {
      const m = 34, top = 150, bottom = 230;
      for (const [id, col] of targets) {
        const st = stationById[id];
        const sx = (st.x - camX) * s, sy = (st.y - camY) * s;
        if (sx > m && sx < CW - m && sy > top && sy < CH - bottom) continue;
        const cx = CW / 2, cy = CH / 2;
        const ang = Math.atan2(sy - cy, sx - cx);
        const ex = clamp(sx, m, CW - m), ey = clamp(sy, top, CH - bottom);
        ctx.save();
        ctx.translate(ex, ey);
        ctx.fillStyle = col; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fill();
        ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(14, -8); ctx.lineTo(14, 8); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
        emo(ctx, st.emoji, ex, ey + 1, 18);
      }
    }
  }

  // ---------- meeting timer ticker ----------
  function updateTimers(now) {
    if (S.room && S.room.phase === 'meeting') {
      const secs = String(Math.max(0, Math.ceil((S.meetingEnds - now) / 1000))).padStart(2, '0');
      const el = $('mTimer');
      if (el.textContent !== secs) el.textContent = secs;
      el.classList.toggle('low', secs <= 10);
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      update(dt, now);
      render(now);
      if (S.room && S.room.phase !== 'lobby') updateButtons(now);
      updateTimers(now);
    } catch (err) { console.error(err); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // =====================================================================
  //  SHELL: desktop, start menu, context menu, settings, boot, stickers
  // =====================================================================
  R.onDialog = icon => { icon === 'error' ? SFX.alert() : SFX.pop(); };

  // pixel icons on buttons and desktop
  document.querySelectorAll('.dicon[data-icon], .start-ico[data-icon], .tray-ico[data-icon]').forEach(el => {
    el.insertBefore(R.pixEmoji(el.dataset.icon, 16, el.classList.contains('dicon') ? 32 : 20), el.firstChild);
  });
  setPix($('chatBtn'), '💬', 16, 30);
  setPix($('mapBtn'), '🗺️', 16, 24);
  setPix($('gearBtn'), '⚙️', 16, 24);
  setPix($('useIcon'), '✋', 16, 40);
  $('bootIco').innerHTML = R.sprite('info', { px: 2, cls: 'dicon' });

  // stickers: dithered single-colour sprites scattered around the menus
  const STICKERS = [
    { name: 'star', x: '6%', y: '9%', px: 4, r: -8, bob: true },
    { name: 'sparkle', x: '88%', y: '4%', px: 4, blink: true },
    { name: 'smiley', x: '84%', y: '62%', px: 4, r: 10, color: '--sticker-2', bob: true, delay: 0.6 },
    { name: 'butterfly', x: '3%', y: '58%', px: 4, r: -12, bob: true, delay: 0.3 },
    { name: 'balloon', x: '90%', y: '30%', px: 3, r: 6, color: '--sticker-2' },
    { name: 'heart', x: '12%', y: '86%', px: 4, r: 8, blink: true },
    { name: 'sparkle', x: '70%', y: '90%', px: 3, blink: true, delay: 0.5 },
    { name: 'star', x: '46%', y: '2%', px: 2, r: 14 }
  ];
  R.scatter($('homeStickers'), STICKERS);
  R.scatter($('lobbyStickers'), STICKERS.slice(2).map((s, i) => Object.assign({}, s, { x: ['5%', '90%', '4%', '88%', '50%', '10%'][i], y: ['14%', '12%', '76%', '84%', '96%', '45%'][i] })));

  // windows that the user "closes"
  $('mainWin').addEventListener('win-close', () => R.Win.dialog({
    title: 'Lunch Spy', icon: 'warn', message: "You can't close lunch.<br>Lunch is the most important meal of the school day."
  }));
  $('readmeWin').addEventListener('win-close', () => $('readmeWin').classList.add('min'));
  document.querySelector('.deco-nokia').addEventListener('win-close', e => e.currentTarget.classList.add('hidden'));
  $('lobbyWin').addEventListener('win-close', async () => {
    const ok = await R.Win.dialog({ title: 'Leave room?', icon: 'warn', message: 'Leave room <b>' + esc(S.code || '') + '</b>?',
      buttons: [{ label: 'Leave', value: true }, { label: 'Stay', value: false, default: true, cancel: true }] });
    if (ok) leaveRoom();
  });
  $('mapWin').addEventListener('win-close', closeMap);
  $('overX').addEventListener('click', () => { if (S.room && S.room.hostId === S.me.id) $('againBtn').click(); });

  function showReadme() {
    const w = $('readmeWin');
    w.classList.remove('min', 'hidden', 'flash'); void w.offsetWidth; w.classList.add('flash');
    R.Win.focus(w);
    w.scrollIntoView({ block: 'nearest' });
  }
  const ACTIONS = {
    newgame() { nameIn.focus(); if (nameIn.value.trim()) doJoin(null); },
    join() { codeIn.focus(); },
    readme: showReadme,
    settings: openSettings,
    bin() {
      R.Win.dialog({ title: 'Recycle Bin', icon: 'info', message: 'The Recycle Bin contains <b>3</b> items:<br>half a pizza, a juice box, and someone\'s alibi.',
        buttons: [{ label: 'Empty', value: 1 }, { label: 'OK', value: 0, default: true }] }).then(v => { if (v) toast('🗑️ Recycle Bin emptied.'); });
    },
    about() {
      R.Win.dialog({ title: 'About Lunch Spy', icon: 'info', message: '<b>Lunch Spy 95</b><br>Version 1.0<br>A social deduction game for 3 to 10 friends.<br><span class="cap">Made with Claude</span>' });
    },
    shutdown() {
      $('shutdown').classList.remove('hidden');
    }
  };
  $('shutdown').onclick = () => $('shutdown').classList.add('hidden');
  document.querySelectorAll('.dicon').forEach(b => b.addEventListener('click', () => ACTIONS[b.dataset.act] && ACTIONS[b.dataset.act]()));

  function startMenu(btn) {
    const r = btn.getBoundingClientRect();
    const inLobby = S.room && S.room.phase === 'lobby';
    R.menu([
      inLobby ? { label: 'Share room code', icon: '🔗', action: () => $('codeBox').click() } : { label: 'New Game', icon: '🍱', action: ACTIONS.newgame },
      inLobby ? { label: 'Leave room', icon: '🚪', action: leaveRoom } : { label: 'Join a Room...', icon: '🔑', action: ACTIONS.join },
      '-',
      { label: 'Settings', icon: '🖥️', action: openSettings },
      { label: 'How to Play', icon: '📄', action: inLobby ? () => R.Win.dialog({ title: 'README.TXT', icon: 'info', message: $('readmeWin').querySelector('.notepad').textContent.replace(/\n/g, '<br>') }) : showReadme },
      { label: 'About', icon: '🕶️', action: ACTIONS.about },
      '-',
      { label: 'Shut Down...', icon: '🔌', action: ACTIONS.shutdown }
    ], r.left, r.top - 2, { cls: 'start', side: 'Lunch<i>95</i>', anchorBottom: true });
    SFX.pop();
  }
  $('startMenuBtn').onclick = e => startMenu(e.currentTarget);
  document.querySelectorAll('[data-start]').forEach(b => { b.onclick = e => startMenu(e.currentTarget); });

  // right-click / long-press on the desktop
  [$('homeDesk')].forEach(el => R.onContext(el, (x, y) => R.menu([
    { label: 'Arrange Icons', icon: '🗂️', action: () => toast('Icons are already perfect.') },
    { label: 'Refresh', icon: '🔄', action: () => { R.scatter($('homeStickers'), STICKERS.map(s => Object.assign({}, s, { x: Math.round(Math.random() * 90) + '%', y: Math.round(Math.random() * 90) + '%' }))); } },
    '-',
    { label: 'New Game', icon: '🍱', action: ACTIONS.newgame },
    { label: 'Properties', icon: '🖥️', action: openSettings }
  ], x, y)));

  // ---------- settings dialog ----------
  let setSnapshot = null;
  const setWin = $('setWin');
  function syncSettingsForm() {
    const s = R.settings;
    setWin.querySelectorAll('input[name=theme]').forEach(i => { i.checked = i.value === s.theme; });
    setWin.querySelectorAll('input[name=controls]').forEach(i => { i.checked = i.value === s.controls; });
    ['crt', 'grain', 'pixel', 'vibrate'].forEach(k => { setWin.querySelector(`input[name=${k}]`).checked = !!s[k]; });
    setWin.querySelector('input[name=volume]').value = s.volume;
    $('volOut').textContent = String(s.volume).padStart(2, '0');
  }
  function openSettings() {
    setSnapshot = Object.assign({}, R.settings);
    syncSettingsForm();
    $('settings').classList.remove('hidden');
    SFX.pop();
  }
  function closeSettings(keep) {
    if (!keep && setSnapshot) R.saveSettings(setSnapshot);
    $('settings').classList.add('hidden');
  }
  setWin.addEventListener('input', e => {
    const t = e.target;
    if (!t.name) return;
    const patch = {};
    if (t.type === 'radio') patch[t.name] = t.value;
    else if (t.type === 'checkbox') patch[t.name] = t.checked;
    else if (t.type === 'range') { patch.volume = +t.value; $('volOut').textContent = String(t.value).padStart(2, '0'); }
    R.saveSettings(patch); // live preview, Cancel reverts
    if (t.type === 'range') tone(660, 0.05, 'square', 0.08);
  });
  setWin.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    setWin.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t === tab));
    setWin.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
  }));
  $('setOk').onclick = () => closeSettings(true);
  $('setApply').onclick = () => { setSnapshot = Object.assign({}, R.settings); toast('Settings applied.'); };
  $('setCancel').onclick = () => closeSettings(false);
  setWin.addEventListener('win-close', () => closeSettings(false));
  $('gearBtn').onclick = openSettings;
  window.addEventListener('retro-settings', () => {
    resize(); S.useKey = ''; S.bellKey = '';
    if (S.room && S.room.phase !== 'lobby') renderHud();
  });

  // ---------- boot loader (progress bar until the socket connects) ----------
  const BOOT_STEPS = ['Loading lunch trays', 'Warming up the soup', 'Hiding the secret recipe', 'Recruiting spies', 'Ringing the bell'];
  let bootPct = 0, bootDone = false;
  const bootStart = Date.now();
  const bootT = setInterval(() => {
    if (!socket.connected && Date.now() - bootStart > 5000) {
      $('bootStep').textContent = 'Waking up the server, this can take 30s';
      return;
    }
    const cap = socket.connected ? 100 : 82;
    bootPct = Math.min(cap, bootPct + 9);
    const bar = $('bootProg'), track = bar.parentElement.clientWidth - 6;
    const blocks = Math.floor(Math.max(0, track) / 15);
    bar.style.width = Math.round(bootPct / 100 * blocks) * 15 + 'px';
    $('bootStep').textContent = BOOT_STEPS[Math.min(BOOT_STEPS.length - 1, Math.floor(bootPct / 21))];
    if (bootPct >= 100 && !bootDone) {
      bootDone = true; clearInterval(bootT);
      setTimeout(() => $('boot').classList.add('hidden'), 150);
    }
  }, 110);

  R.tickClocks();

  // Auto-rejoin after a refresh
  const saved = sess.get('ls_room');
  if (saved) S.code = saved;
})();
