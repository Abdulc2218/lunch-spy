// Shared map + collision code. Loaded by the server (require) and the browser (<script>).
(function (root) {
  const W = 1800, H = 1200, T = 30;

  const COLORS = [
    '#ef4444', '#3b82f6', '#22c55e', '#facc15', '#fb923c',
    '#a855f7', '#f472b6', '#22d3ee', '#a16207', '#f1f5f9'
  ];

  // Floors (drawn in order, later ones on top)
  const rooms = [
    { id: 'dining',   x: T,    y: T,   w: W - 2 * T, h: H - 2 * T, floor: 'dining',   label: 'DINING HALL', lx: 800,  ly: 1095 },
    { id: 'kitchen',  x: T,    y: T,   w: 570, h: 370, floor: 'kitchen',  label: 'KITCHEN',    lx: 315,  ly: 360 },
    { id: 'serving',  x: 630,  y: T,   w: 670, h: 370, floor: 'serving',  label: 'LUNCH LINE', lx: 975,  ly: 345 },
    { id: 'office',   x: 1330, y: T,   w: 440, h: 370, floor: 'office',   label: 'OFFICE',     lx: 1550, ly: 350 },
    { id: 'bathroom', x: 1590, y: 550, w: 180, h: 450, floor: 'bathroom', label: 'BATHROOM',   lx: 1640, ly: 790 }
  ];

  const walls = [
    // outer
    { x: 0, y: 0, w: W, h: T }, { x: 0, y: H - T, w: W, h: T },
    { x: 0, y: 0, w: T, h: H }, { x: W - T, y: 0, w: T, h: H },
    // kitchen
    { x: 600, y: 30, w: 30, h: 130 }, { x: 600, y: 270, w: 30, h: 160 },
    { x: 30, y: 400, w: 230, h: 30 }, { x: 370, y: 400, w: 260, h: 30 },
    // office
    { x: 1300, y: 30, w: 30, h: 120 }, { x: 1300, y: 260, w: 30, h: 170 },
    { x: 1300, y: 400, w: 470, h: 30 },
    // bathroom
    { x: 1560, y: 520, w: 210, h: 30 },
    { x: 1560, y: 520, w: 30, h: 180 }, { x: 1560, y: 810, w: 30, h: 220 },
    { x: 1560, y: 1000, w: 210, h: 30 }
  ];

  const tables = [];
  [380, 800, 1220].forEach(cx => [620, 900].forEach(cy => {
    tables.push({ type: 'table', x: cx - 120, y: cy - 45, w: 240, h: 90, solid: true });
  }));

  const props = [
    { type: 'ksink',   x: 40,   y: 40,   w: 100, h: 50, solid: true },
    { type: 'stove',   x: 220,  y: 40,   w: 160, h: 60, solid: true },
    { type: 'freezer', x: 440,  y: 40,   w: 120, h: 70, solid: true },
    { type: 'steel',   x: 120,  y: 230,  w: 220, h: 60, solid: true },
    { type: 'counter', x: 720,  y: 150,  w: 500, h: 50, solid: true },
    { type: 'easel',   x: 650,  y: 320,  w: 50,  h: 40, solid: true },
    { type: 'desk',    x: 1420, y: 110,  w: 200, h: 70, solid: true },
    { type: 'safe',    x: 1690, y: 40,   w: 70,  h: 70, solid: true },
    { type: 'fountain',x: 30,   y: 660,  w: 44,  h: 80, solid: true },
    { type: 'vending', x: 100,  y: 1105, w: 180, h: 65, solid: true },
    { type: 'trash',   x: 1300, y: 1115, w: 150, h: 55, solid: true },
    { type: 'sink',    x: 1680, y: 555,  w: 80,  h: 40, solid: true },
    { type: 'stall',   x: 1660, y: 880,  w: 110, h: 120, solid: true },
    { type: 'bell',    x: 782,  y: 742,  w: 36,  h: 36, solid: true },
    { type: 'plant',   x: 1490, y: 440,  w: 40,  h: 40, solid: true },
    { type: 'plant',   x: 40,   y: 440,  w: 40,  h: 40, solid: true },
    { type: 'plant',   x: 1345, y: 330,  w: 40,  h: 40, solid: true }
  ].concat(tables);

  // Every station has a normal student task. Some also hide a spy mission,
  // so a spy doing a mission looks exactly like a student doing a task.
  const stations = [
    { id: 'tray',     x: 790,  y: 235,  emoji: '🍱', name: 'Tray stack',     room: 'Lunch line', task: 'Grab a lunch tray' },
    { id: 'food',     x: 970,  y: 235,  emoji: '🍝', name: 'Food counter',   room: 'Lunch line', task: 'Get your food' },
    { id: 'register', x: 1160, y: 235,  emoji: '💰', name: 'Register',       room: 'Lunch line', task: 'Pay at the register',
      mission: 'Steal the lunch money', alert: '💰 The lunch money was stolen!' },
    { id: 'soup',     x: 300,  y: 140,  emoji: '🍲', name: 'Soup pot',       room: 'Kitchen', task: 'Taste the soup',
      mission: 'Spike the soup with hot sauce', alert: '🌶️ Someone spiked the soup!' },
    { id: 'freezer',  x: 500,  y: 150,  emoji: '🧊', name: 'Freezer',        room: 'Kitchen', task: 'Grab ice cream',
      mission: 'Unplug the freezer', alert: '🧊 The freezer was unplugged!' },
    { id: 'menu',     x: 690,  y: 395,  emoji: '📋', name: 'Menu board',     room: 'Lunch line', task: "Read today's menu",
      mission: 'Swap the menu board', alert: '📋 Someone swapped the menu!' },
    { id: 'office',   x: 1725, y: 150,  emoji: '🗄️', name: 'Office safe',    room: 'Office', task: 'Drop off a lost phone',
      mission: 'Steal the secret recipe', alert: '📜 The secret recipe is gone!' },
    { id: 'table',    x: 1220, y: 980,  emoji: '🍽️', name: 'Corner table',   room: 'Dining hall', task: 'Wipe the corner table',
      mission: 'Hide a bug under the corner table', alert: '🐞 A spy bug was planted under the corner table!' },
    { id: 'drink',    x: 110,  y: 700,  emoji: '🥤', name: 'Drink fountain', room: 'Dining hall', task: 'Refill your drink' },
    { id: 'snack',    x: 190,  y: 1070, emoji: '🍫', name: 'Vending machine',room: 'Dining hall', task: 'Buy a snack',
      mission: 'Hack the vending machine', alert: '🍫 The vending machine went haywire!' },
    { id: 'trash',    x: 1375, y: 1080, emoji: '🗑️', name: 'Trash bins',     room: 'Dining hall', task: 'Throw out your trash' },
    { id: 'sink',     x: 1720, y: 640,  emoji: '🚰', name: 'Bathroom sink',  room: 'Bathroom', task: 'Wash your hands',
      mission: 'Clog the bathroom sink', alert: '🚰 The bathroom sink is flooding!' }
  ];

  const bell = { x: 800, y: 760 };
  const PLAYER_R = 16;
  const USE_RANGE = 75;
  const BELL_RANGE = 85;
  const SPEED = 230; // world px per second

  const solids = walls.concat(props.filter(p => p.solid));

  function hits(x, y, r) {
    for (let i = 0; i < solids.length; i++) {
      const b = solids[i];
      if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
    }
    return false;
  }

  function moveCircle(x, y, dx, dy, r) {
    r = r || PLAYER_R;
    const nx = x + dx;
    if (!hits(nx, y, r)) x = nx;
    const ny = y + dy;
    if (!hits(x, ny, r)) y = ny;
    return { x: x, y: y };
  }

  function spawnPoint(i, n) {
    const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.round(bell.x + Math.cos(a) * 170), y: Math.round(bell.y + Math.sin(a) * 55) };
  }

  const MAP = { W, H, COLORS, rooms, walls, props, stations, bell, PLAYER_R, USE_RANGE, BELL_RANGE, SPEED, hits, moveCircle, spawnPoint };

  if (typeof module !== 'undefined' && module.exports) module.exports = MAP;
  else root.MAP = MAP;
})(this);
