/* =====================================================================
   LUNCH SPY · RETRO UI KIT
   Win (window component), pixel sprites, dialogs, menus, film grain,
   settings and clock. Exposes window.Retro.
   ===================================================================== */
(function () {
  'use strict';

  // ---------- pixel sprites ----------
  // '#' = main color, '+' = main color dithered (checkerboard),
  // 'k' black, 'w' white, 'r' red, 'b' navy, 'y' yellow, 'g' gray
  const PAL = { k: '#0a0a0a', w: '#ffffff', r: '#d4141c', b: '#000080', y: '#ffd800', g: '#808080' };

  const SPR = {
    star: [
      '.....#.....', '.....#.....', '....###....', '....#+#....', '####+++####',
      '.#+++++++#.', '..#+++++#..', '...#+++#...', '..#++#++#..', '..#+#.#+#..', '.##.....##.'
    ],
    sparkle: ['...#...', '...#...', '..#+#..', '##+#+##', '..#+#..', '...#...', '...#...'],
    smiley: [
      '....####....', '..##++++##..', '.#++++++++#.', '.#++#++#++#.', '#+++#++#+++#', '#++++++++++#',
      '#++++++++++#', '#+#++++++#+#', '.#+#++++#+#.', '.#++####++#.', '..##++++##..', '....####....'
    ],
    heart: ['.##...##.', '#++#.#++#', '#+++#+++#', '#+++++++#', '.#+++++#.', '..#+++#..', '...#+#...', '....#....'],
    balloon: [
      '..#####..', '.#+++++#.', '#+++++++#', '#++#++++#', '#+#+++++#', '#+++++++#', '.#+++++#.',
      '..#+++#..', '...###...', '....#....', '.....#...', '....#....', '...#.....', '....#....'
    ],
    butterfly: [
      '.##.......##.', '#++#.....#++#', '#+++#.#.#+++#', '#++++#.#++++#', '.#+++#.#+++#.',
      '..##.###.##..', '.#++#.#.#++#.', '#+++#.#.#+++#', '#++#.....#++#', '.##.......##.'
    ],
    glasses: ['############', '#++++##++++#', '#++++##++++#', '.####..####.'],
    gmin: ['........', '........', '........', '........', '........', '######..', '######..'],
    gmax: ['#########', '#########', '#.......#', '#.......#', '#.......#', '#.......#', '#########'],
    gx: ['##....##', '.##..##.', '..####..', '...##...', '..####..', '.##..##.', '##....##']
  };

  function gen(n, fn) {
    const rows = [];
    for (let y = 0; y < n; y++) {
      let s = '';
      for (let x = 0; x < n; x++) s += fn(x - (n - 1) / 2, y - (n - 1) / 2, x, y) || '.';
      rows.push(s);
    }
    return rows;
  }
  SPR.error = gen(16, (dx, dy) => {
    const d = Math.hypot(dx, dy);
    if (d > 7.6) return '.';
    if (d > 6.5) return 'k';
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1.05 && d < 4.9) return 'w';
    return 'r';
  });
  SPR.info = gen(16, (dx, dy, x, y) => {
    const d = Math.hypot(dx, dy);
    if (d > 7.6) return '.';
    if (d > 6.5) return 'k';
    if ((x === 7 || x === 8) && (y === 3 || y === 4 || (y >= 6 && y <= 12))) return 'w';
    if (y === 12 && (x === 6 || x === 9)) return 'w';
    return 'b';
  });
  SPR.warn = gen(16, (dx, dy, x, y) => {
    if (y < 1 || y > 14) return '.';
    const half = (y - 1) * 0.56 + 0.4;
    if (Math.abs(dx) > half) return '.';
    if (Math.abs(dx) > half - 1.2 || y === 14) return 'k';
    if ((x === 7 || x === 8) && ((y >= 5 && y <= 10) || y === 12 || y === 13)) return 'k';
    return 'y';
  });

  function sprite(name, opts) {
    opts = opts || {};
    const rows = Array.isArray(name) ? name : SPR[name];
    const h = rows.length, w = rows[0].length;
    const color = opts.color || 'currentColor';
    let rects = '';
    for (let y = 0; y < h; y++) {
      const r = rows[y];
      let x = 0;
      while (x < w) {
        const ch = r[x];
        if (ch === '.') { x++; continue; }
        if (ch === '+') {
          if ((x + y) % 2 === 0) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
          x++; continue;
        }
        let run = 1;
        while (x + run < w && r[x + run] === ch) run++;
        const fill = ch === '#' ? color : PAL[ch] || color;
        rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${fill}"/>`;
        x += run;
      }
    }
    const px = opts.px || 2;
    const cls = 'pix' + (opts.cls ? ' ' + opts.cls : '');
    const style = opts.style ? ` style="${opts.style}"` : '';
    return `<svg class="${cls}"${style} viewBox="0 0 ${w} ${h}" width="${w * px}" height="${h * px}" aria-hidden="true">${rects}</svg>`;
  }
  function spriteEl(name, opts) {
    const t = document.createElement('template');
    t.innerHTML = sprite(name, opts);
    return t.content.firstChild;
  }

  // Emoji drawn on a tiny canvas, then blown up with nearest-neighbour = instant pixel art
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  function pixEmoji(emoji, res, css) {
    res = res || 16; css = css || 32;
    const cv = document.createElement('canvas');
    cv.width = res; cv.height = res;
    cv.className = 'pix pixel';
    cv.style.width = css + 'px'; cv.style.height = css + 'px';
    const c = cv.getContext('2d');
    c.font = Math.round(res * 0.86) + 'px ' + EMOJI_FONT;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(emoji, res / 2, res / 2 + res * 0.06);
    return cv;
  }

  // ---------- Window component ----------
  let zTop = 30;
  const Win = {
    html({ title, icon, body = '', cls = '', id = '', min = true, max = true, close = true, drag = false, right = '' }) {
      return `<div class="win ${cls}" data-win ${id ? `id="${id}"` : ''} ${drag ? 'data-drag' : ''}>
        <div class="win-title">${icon ? `<span class="ico" data-icon="${icon}"></span>` : ''}<span class="tt">${title}</span>${right}
          <span class="win-ctrls">${min ? '<button class="mn" type="button" aria-label="Minimize"></button>' : ''}${max ? '<button class="mx" type="button" aria-label="Maximize"></button>' : ''}${close ? '<button class="x" type="button" aria-label="Close"></button>' : ''}</span>
        </div>${body}</div>`;
    },
    create(opts) {
      const t = document.createElement('template');
      t.innerHTML = Win.html(opts).trim();
      const el = t.content.firstChild;
      (opts.parent || document.getElementById('app')).appendChild(el);
      Win.enhance(el);
      return el;
    },
    enhance(root) {
      root = root || document;
      const wins = root.matches && root.matches('[data-win]') ? [root] : [...root.querySelectorAll('[data-win]')];
      wins.forEach(el => {
        if (el._win) return;
        el._win = true;
        const ico = el.querySelector(':scope > .win-title > .ico[data-icon]');
        if (ico && !ico.firstChild) ico.appendChild(pixEmoji(ico.dataset.icon, 16, 16));
        const mn = el.querySelector(':scope > .win-title .mn');
        const mx = el.querySelector(':scope > .win-title .mx');
        const x = el.querySelector(':scope > .win-title .x');
        if (mn && !mn.firstChild) mn.innerHTML = sprite('gmin', { px: 1 });
        if (mx && !mx.firstChild) mx.innerHTML = sprite('gmax', { px: 1 });
        if (x && !x.firstChild) x.innerHTML = sprite('gx', { px: 1 });
        if (mn) mn.addEventListener('click', e => { e.stopPropagation(); el.classList.toggle('min'); el.dispatchEvent(new CustomEvent('win-min')); });
        if (mx) mx.addEventListener('click', e => { e.stopPropagation(); el.classList.toggle('max'); el.dispatchEvent(new CustomEvent('win-max')); });
        if (x) x.addEventListener('click', e => { e.stopPropagation(); el.dispatchEvent(new CustomEvent('win-close', { cancelable: true })); });
        el.addEventListener('pointerdown', () => Win.focus(el), true);
        if (el.hasAttribute('data-drag')) Win.draggable(el);
      });
    },
    focus(el) {
      const group = el.parentElement;
      if (!group) return;
      group.querySelectorAll(':scope > [data-win]').forEach(w => w.classList.toggle('inactive', w !== el));
      if (el.hasAttribute('data-drag')) el.style.zIndex = ++zTop;
    },
    draggable(el) {
      const bar = el.querySelector(':scope > .win-title');
      let sx = 0, sy = 0, ox = 0, oy = 0, id = null;
      bar.addEventListener('pointerdown', e => {
        if (e.target.closest('button') || el.classList.contains('max')) return;
        id = e.pointerId; sx = e.clientX; sy = e.clientY;
        const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(el.style.transform || '');
        ox = m ? +m[1] : 0; oy = m ? +m[2] : 0;
        try { bar.setPointerCapture(id); } catch (err) {}
      });
      bar.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        // snap to a 4px grid: chunky, no smoothing
        const nx = Math.round((ox + e.clientX - sx) / 4) * 4, ny = Math.round((oy + e.clientY - sy) / 4) * 4;
        el.style.transform = `translate(${nx}px, ${ny}px)`;
      });
      const end = e => { if (e.pointerId === id) id = null; };
      bar.addEventListener('pointerup', end);
      bar.addEventListener('pointercancel', end);
      bar.addEventListener('dblclick', () => { el.style.transform = ''; });
    },
    // Fake Windows dialog. Resolves with the clicked button's value.
    dialog({ title = 'Lunch Spy', icon = 'info', message = '', buttons = [{ label: 'OK', value: true, default: true }], sound = true }) {
      return new Promise(resolve => {
        const veil = document.createElement('div');
        veil.className = 'dialog-veil';
        veil.innerHTML = Win.html({
          title, cls: 'dlg', min: false, max: false,
          body: `<div class="dialog">${sprite(icon, { px: 2, cls: 'dicon' })}<div class="dmsg">${message}</div></div>
                 <div class="dialog-btns">${buttons.map((b, i) => `<button class="btn95${b.default ? ' default' : ''}" data-i="${i}" type="button">${b.label}</button>`).join('')}</div>`
        });
        document.getElementById('app').appendChild(veil);
        const w = veil.firstElementChild;
        Win.enhance(w);
        const done = v => { veil.remove(); resolve(v); };
        w.addEventListener('win-close', () => done(buttons.find(b => b.cancel) ? buttons.find(b => b.cancel).value : false));
        w.querySelectorAll('.dialog-btns button').forEach(b => b.addEventListener('click', () => done(buttons[+b.dataset.i].value)));
        const def = w.querySelector('.btn95.default');
        if (def) setTimeout(() => def.focus({ preventScroll: true }), 0);
        if (sound && Retro.onDialog) Retro.onDialog(icon);
      });
    }
  };

  // ---------- menus (start menu, context menu) ----------
  let openMenu = null;
  function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
  function menu(items, x, y, opts) {
    closeMenu();
    opts = opts || {};
    const m = document.createElement('div');
    m.className = 'menu' + (opts.cls ? ' ' + opts.cls : '');
    m.setAttribute('role', 'menu');
    if (opts.side) m.innerHTML = `<div class="menu-side"><span>${opts.side}</span></div>`;
    const list = document.createElement('div');
    list.className = 'menu-items';
    items.forEach(it => {
      if (it === '-') { list.appendChild(document.createElement('hr')); return; }
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitem');
      if (it.icon) b.appendChild(pixEmoji(it.icon, 16, 20));
      b.appendChild(document.createTextNode(it.label));
      b.addEventListener('click', () => { closeMenu(); it.action && it.action(); });
      list.appendChild(b);
    });
    m.appendChild(list);
    document.getElementById('app').appendChild(m);
    const r = m.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    const left = opts.anchorBottom ? x : Math.min(x, W - r.width - 4);
    const top = opts.anchorBottom ? (y - r.height) : Math.min(y, H - r.height - 4);
    m.style.left = Math.max(4, left) + 'px';
    m.style.top = Math.max(4, top) + 'px';
    openMenu = m;
    setTimeout(() => {
      const off = e => { if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); } };
      document.addEventListener('pointerdown', off, true);
    }, 0);
    return m;
  }
  // right-click or long-press
  function onContext(el, fn) {
    el.addEventListener('contextmenu', e => { e.preventDefault(); fn(e.clientX, e.clientY); });
    let t = null, sx = 0, sy = 0;
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.target !== el) return;
      sx = e.clientX; sy = e.clientY;
      t = setTimeout(() => fn(sx, sy), 550);
    });
    const cancel = e => { if (t && (!e || e.type !== 'pointermove' || Math.hypot(e.clientX - sx, e.clientY - sy) > 10)) { clearTimeout(t); t = null; } };
    el.addEventListener('pointerup', cancel); el.addEventListener('pointercancel', cancel); el.addEventListener('pointermove', cancel);
  }

  // ---------- film grain (generated once, animated by CSS steps) ----------
  function makeNoise() {
    const n = 90, cv = document.createElement('canvas');
    cv.width = n; cv.height = n;
    const c = cv.getContext('2d');
    const img = c.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = Math.random() * 255 | 0;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = Math.random() < 0.5 ? 255 : 0;
    }
    c.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--noise-url', `url(${cv.toDataURL()})`);
  }

  // ---------- settings ----------
  const DEFAULTS = { theme: 'classic', crt: true, grain: true, pixel: false, controls: 'joy', volume: 70, vibrate: true };
  const settings = Object.assign({}, DEFAULTS);
  try { Object.assign(settings, JSON.parse(localStorage.getItem('ls_settings') || '{}')); } catch (e) {}
  function applySettings() {
    const root = document.documentElement;
    if (settings.theme === 'classic') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', settings.theme);
    root.classList.toggle('crt-off', !settings.crt);
    root.classList.toggle('grain-off', !settings.grain);
    root.classList.toggle('pixel-world', !!settings.pixel);
    root.classList.toggle('dpad-on', settings.controls === 'dpad');
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = settings.theme === 'nokia' ? '#0f380f' : settings.theme === 'bitmap' ? '#000000' : '#000080';
    window.dispatchEvent(new CustomEvent('retro-settings', { detail: settings }));
  }
  function saveSettings(patch) {
    Object.assign(settings, patch);
    try { localStorage.setItem('ls_settings', JSON.stringify(settings)); } catch (e) {}
    applySettings();
  }

  // ---------- clock ----------
  function clockText() {
    const d = new Date();
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${m} ${ap}`;
  }
  function tickClocks() { document.querySelectorAll('[data-clock]').forEach(el => { el.textContent = clockText(); }); }
  setInterval(tickClocks, 10000);

  // ---------- stickers ----------
  // places dithered single-color sprites inside a container at fixed spots
  function scatter(container, list) {
    container.innerHTML = '';
    list.forEach(s => {
      const el = spriteEl(s.name, { px: s.px || 3, cls: 'sticker' + (s.bob ? ' bob' : '') + (s.blink ? ' blink' : '') });
      el.style.cssText = `left:${s.x};top:${s.y};color:var(${s.color || '--sticker-1'});transform:rotate(${s.r || 0}deg);animation-delay:${s.delay || 0}s`;
      container.appendChild(el);
    });
  }

  const Retro = { Win, sprite, spriteEl, pixEmoji, menu, closeMenu, onContext, settings, saveSettings, applySettings, clockText, tickClocks, scatter, onDialog: null };
  window.Retro = Retro;

  makeNoise();
  applySettings();
  document.addEventListener('DOMContentLoaded', () => { Win.enhance(document); tickClocks(); });
})();
