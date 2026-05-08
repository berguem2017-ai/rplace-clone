/* ── Constants ── */
const CANVAS_SIZE = 100;
const COLORS = [
  '#ffffff','#e4e4e4','#888888','#222222',
  '#ffa7d1','#e50000','#e59500','#a06a42',
  '#e5d900','#94e044','#02be01','#00d3dd',
  '#0083c7','#0000ea','#cf6ee4','#820080',
];
const MEDALS = ['👑','🥇','🥈','🥉'];
const BADGES = [
  { min: 1,   label: '🔷', title: 'Primer píxel' },
  { min: 10,  label: '🔶', title: '10 píxeles' },
  { min: 50,  label: '💎', title: '50 píxeles' },
  { min: 100, label: '⭐', title: '100 píxeles' },
];

/* ── State ── */
const socket = io();
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
canvas.width = CANVAS_SIZE;
canvas.height = CANVAS_SIZE;

const imgData = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
const pixels = imgData.data;

let scale = 1, offsetX = 0, offsetY = 0;
let isDragging = false, hasDragged = false;
let dragStart = {x:0,y:0}, dragOrigin = {x:0,y:0};
let selectedColor = COLORS[1];
let cooldownEnd = 0, cdInterval = null;
let pixelMetaArr = new Array(CANVAS_SIZE * CANVAS_SIZE).fill(null);
let soundEnabled = true;
let audioCtx = null;

/* ── Alias management ── */
function generateAlias() {
  const adj  = ['Neon','Pixel','Cyber','Retro','Glitch','Turbo','Hyper','Ultra','Void','Arc'];
  const noun = ['Fox','Panda','Wolf','Eagle','Tiger','Dragon','Phoenix','Cat','Hawk','Lynx'];
  return adj[Math.floor(Math.random()*adj.length)] + noun[Math.floor(Math.random()*noun.length)] + (Math.floor(Math.random()*99)+1);
}
const aliasInput   = document.getElementById('alias-input');
const messageInput = document.getElementById('message-input');
const savedAlias   = localStorage.getItem('rplace_alias') || generateAlias();
aliasInput.value   = savedAlias;
aliasInput.addEventListener('input', () => localStorage.setItem('rplace_alias', aliasInput.value.trim() || generateAlias()));

/* ── Palette ── */
const paletteEl = document.getElementById('palette');
const previewEl = document.getElementById('selected-preview');
previewEl.style.background = selectedColor;
COLORS.forEach(hex => {
  const sw = document.createElement('div');
  sw.className = 'pswatch' + (hex === selectedColor ? ' sel' : '');
  sw.style.background = hex;
  sw.addEventListener('click', () => {
    document.querySelectorAll('.pswatch').forEach(s => s.classList.remove('sel'));
    sw.classList.add('sel');
    selectedColor = hex;
    previewEl.style.background = hex;
  });
  paletteEl.appendChild(sw);
});

/* ── Sound ── */
document.getElementById('sound-toggle').addEventListener('change', e => soundEnabled = e.target.checked);
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playPlace() {
  if (!soundEnabled) return;
  try {
    const ac = getAudio();
    const o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = 'square';
    o.frequency.setValueAtTime(440, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(880, ac.currentTime + .05);
    g.gain.setValueAtTime(.05, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .12);
    o.start(ac.currentTime); o.stop(ac.currentTime + .12);
  } catch(e) {}
}
function playReady() {
  if (!soundEnabled) return;
  try {
    const ac = getAudio();
    [523.25, 783.99].forEach((freq, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(ac.destination);
      o.type = 'square';
      const t = ac.currentTime + i * .1;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(.04, t);
      g.gain.exponentialRampToValueAtTime(.001, t + .1);
      o.start(t); o.stop(t + .1);
    });
  } catch(e) {}
}

/* ── Canvas helpers ── */
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n>>16)&255, g: (n>>8)&255, b: n&255 };
}
function setPixel(x, y, r, g, b) {
  const i = (y * CANVAS_SIZE + x) * 4;
  pixels[i]=r; pixels[i+1]=g; pixels[i+2]=b; pixels[i+3]=255;
}
function render() { ctx.putImageData(imgData, 0, 0); }

/* ── Viewport ── */
const viewport = document.getElementById('viewport');
function applyTransform() {
  canvas.style.transform = `translate(${offsetX}px,${offsetY}px) scale(${scale})`;
  canvas.style.transformOrigin = '0 0';
}
function centerCanvas() {
  const r = viewport.getBoundingClientRect();
  scale = Math.min(r.width, r.height) / CANVAS_SIZE;
  offsetX = Math.round((r.width  - CANVAS_SIZE * scale) / 2);
  offsetY = Math.round((r.height - CANVAS_SIZE * scale) / 2);
  applyTransform();
}
function viewportToCanvas(vx, vy) {
  const r = viewport.getBoundingClientRect();
  return { x: Math.floor((vx - r.left - offsetX) / scale), y: Math.floor((vy - r.top - offsetY) / scale) };
}
function zoomAt(vx, vy, factor) {
  const r = viewport.getBoundingClientRect();
  const mx = vx - r.left, my = vy - r.top;
  const ns = Math.min(80, Math.max(0.5, scale * factor));
  offsetX = mx - (mx - offsetX) * (ns / scale);
  offsetY = my - (my - offsetY) * (ns / scale);
  scale = ns;
  applyTransform();
}

/* ── Mouse interaction ── */
viewport.addEventListener('mousedown', e => {
  if (e.button === 0) {
    isDragging = true; hasDragged = false;
    dragStart = {x:e.clientX, y:e.clientY};
    dragOrigin = {x:offsetX, y:offsetY};
  }
});
viewport.addEventListener('mousemove', e => {
  const {x, y} = viewportToCanvas(e.clientX, e.clientY);
  if (x >= 0 && x < CANVAS_SIZE && y >= 0 && y < CANVAS_SIZE)
    document.getElementById('coords').textContent = `x: ${x}  y: ${y}`;
  if (isDragging) {
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasDragged = true;
    offsetX = dragOrigin.x + dx; offsetY = dragOrigin.y + dy;
    applyTransform();
  }
});
viewport.addEventListener('mouseup', e => {
  if (e.button !== 0) return;
  isDragging = false;
  if (!hasDragged) placePixelAt(e.clientX, e.clientY);
});
viewport.addEventListener('contextmenu', e => {
  e.preventDefault();
  const {x, y} = viewportToCanvas(e.clientX, e.clientY);
  if (x >= 0 && x < CANVAS_SIZE && y >= 0 && y < CANVAS_SIZE) showPixelInfo(x, y);
});
viewport.addEventListener('wheel', e => { e.preventDefault(); }, { passive: false });

document.getElementById('btn-reset').addEventListener('click', centerCanvas);

/* ── Touch ── */
let lastDist = null;
viewport.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    isDragging = true; hasDragged = false;
    dragStart = {x:e.touches[0].clientX, y:e.touches[0].clientY};
    dragOrigin = {x:offsetX, y:offsetY};
  }
  if (e.touches.length === 2) lastDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
}, {passive:true});
viewport.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && isDragging) {
    const dx = e.touches[0].clientX - dragStart.x, dy = e.touches[0].clientY - dragStart.y;
    if (Math.abs(dx)>3||Math.abs(dy)>3) hasDragged = true;
    offsetX = dragOrigin.x+dx; offsetY = dragOrigin.y+dy; applyTransform();
  }
  if (e.touches.length === 2 && lastDist !== null) {
    const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    zoomAt((e.touches[0].clientX+e.touches[1].clientX)/2, (e.touches[0].clientY+e.touches[1].clientY)/2, d/lastDist);
    lastDist = d;
  }
}, {passive:false});
viewport.addEventListener('touchend', e => {
  if (e.touches.length < 2) lastDist = null;
  if (e.touches.length === 0) {
    isDragging = false;
    if (!hasDragged && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      placePixelAt(t.clientX, t.clientY);
    }
  }
});

/* ── Place pixel ── */
function placePixelAt(cx, cy) {
  const {x, y} = viewportToCanvas(cx, cy);
  if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) return;
  if (Date.now() < cooldownEnd) { startCooldown(cooldownEnd - Date.now()); return; }
  const {r,g,b} = hexToRgb(selectedColor);
  const alias   = aliasInput.value.trim() || generateAlias();
  const message = messageInput.value.trim();
  socket.emit('place', {x, y, r, g, b, alias, message});
  setPixel(x, y, r, g, b);
  pixelMetaArr[y * CANVAS_SIZE + x] = { alias, hex: selectedColor, message, ts: Date.now() };
  render();
  playPlace();
  startCooldown(1000);
}

/* ── Cooldown UI ── */
function startCooldown(ms) {
  cooldownEnd = Date.now() + ms;
  if (cdInterval) clearInterval(cdInterval);
  const fill = document.getElementById('cooldown-bar-fill');
  const text = document.getElementById('cooldown-text');
  cdInterval = setInterval(() => {
    const left = cooldownEnd - Date.now();
    if (left <= 0) {
      clearInterval(cdInterval);
      fill.style.width = '0%';
      text.textContent = 'Listo ✓';
      playReady();
    } else {
      fill.style.width = ((1 - left/1000) * 100) + '%';
      text.textContent = (left/1000).toFixed(1) + 's';
    }
  }, 40);
}

/* ── Socket events ── */
socket.on('canvas', buf => {
  const data = new Uint8Array(buf);
  for (let i = 0; i < CANVAS_SIZE * CANVAS_SIZE; i++) {
    pixels[i*4]=data[i*3]; pixels[i*4+1]=data[i*3+1]; pixels[i*4+2]=data[i*3+2]; pixels[i*4+3]=255;
  }
  render();
});
socket.on('meta', arr => { pixelMetaArr = arr; });
socket.on('pixel', ({x, y, r, g, b, alias, hex, message, ts}) => {
  setPixel(x, y, r, g, b);
  pixelMetaArr[y * CANVAS_SIZE + x] = {alias, hex, message, ts};
  render();
});
socket.on('feed', items => items.forEach(it => addFeedItem(it, false)));
socket.on('feed_item', item => { addFeedItem(item); addContrib(item); showToast(item); });
socket.on('rankings', list => renderRankings(list));
socket.on('active', n => {
  document.getElementById('stat-active').textContent  = n;
  document.getElementById('hero-active').textContent  = n;
  document.getElementById('nav-active').textContent   = n;
});
socket.on('total', n => {
  document.getElementById('stat-total').textContent = n;
  document.getElementById('hero-total').textContent = n;
});
socket.on('cooldown', ms => startCooldown(ms));

/* ── Activity feed ── */
const feedEl = document.getElementById('activity-feed');
function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000)   return Math.floor(d/1000) + 's';
  if (d < 3600000) return Math.floor(d/60000) + 'min';
  return Math.floor(d/3600000) + 'h';
}
function addFeedItem(item, animate = true) {
  const el = document.createElement('div');
  el.className = 'feed-item';
  if (!animate) el.style.animation = 'none';
  el.innerHTML = `
    <div class="fi-dot" style="background:${item.hex}"></div>
    <div class="fi-info">
      <div class="fi-alias">${escHtml(item.alias)}</div>
      <div class="fi-meta">(${item.x},${item.y}) · ${timeAgo(item.ts)}</div>
    </div>`;
  feedEl.prepend(el);
  while (feedEl.children.length > 15) feedEl.lastChild.remove();
}

/* ── Contributions grid ── */
const contribEl = document.getElementById('contributions-grid');
const recentItems = [];
function addContrib(item) {
  recentItems.unshift(item);
  if (recentItems.length > 12) recentItems.pop();
  renderContribs();
}
function renderContribs() {
  contribEl.innerHTML = '';
  recentItems.forEach(item => {
    const card = document.createElement('div');
    card.className = 'contrib-card reveal visible';
    card.innerHTML = `
      <div class="cc-color" style="background:${item.hex}"></div>
      <div class="cc-body">
        <div class="cc-alias">${escHtml(item.alias)}</div>
        <div class="cc-coords">(${item.x}, ${item.y})</div>
        ${item.message ? `<div class="cc-msg">${escHtml(item.message)}</div>` : ''}
        <div class="cc-time">${timeAgo(item.ts)}</div>
      </div>`;
    contribEl.appendChild(card);
  });
}

/* ── Rankings ── */
const rankingsEl = document.getElementById('rankings-list');
function getBadge(count) {
  for (let i = BADGES.length-1; i >= 0; i--) if (count >= BADGES[i].min) return BADGES[i].label;
  return '';
}
function renderRankings(list) {
  const max = list[0]?.count || 1;
  rankingsEl.innerHTML = '';
  list.forEach((u, i) => {
    const el = document.createElement('div');
    el.className = 'rank-item reveal visible';
    const numClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
    el.innerHTML = `
      <div class="rank-num ${numClass}">${i < 4 ? MEDALS[i] : '#' + (i+1)}</div>
      <div class="rank-alias">${escHtml(u.alias)}</div>
      <div class="rank-bar-wrap"><div class="rank-bar" style="width:${Math.round(u.count/max*100)}%"></div></div>
      <div class="rank-count pf">${u.count}px ${getBadge(u.count)}</div>`;
    rankingsEl.appendChild(el);
  });
}

/* ── Pixel info modal ── */
function showPixelInfo(x, y) {
  const meta = pixelMetaArr[y * CANVAS_SIZE + x];
  const modal = document.getElementById('modal-pixel');
  if (!meta) {
    document.getElementById('pi-swatch').style.background = '#222';
    document.getElementById('pi-alias').textContent  = 'Píxel vacío';
    document.getElementById('pi-msg').textContent    = 'Nadie lo ha reclamado aún.';
    document.getElementById('pi-coords').textContent = `x: ${x}  y: ${y}`;
    document.getElementById('pi-time').textContent   = '';
  } else {
    document.getElementById('pi-swatch').style.background = meta.hex;
    document.getElementById('pi-alias').textContent  = meta.alias;
    document.getElementById('pi-msg').textContent    = meta.message || '';
    document.getElementById('pi-coords').textContent = `x: ${x}  y: ${y}  ·  ${meta.hex}`;
    document.getElementById('pi-time').textContent   = 'hace ' + timeAgo(meta.ts);
  }
  modal.style.display = 'flex';
}
document.getElementById('modal-close-pixel').addEventListener('click', () => { document.getElementById('modal-pixel').style.display = 'none'; });
document.getElementById('modal-pixel').addEventListener('click', e => { if (e.target === document.getElementById('modal-pixel')) document.getElementById('modal-pixel').style.display = 'none'; });


/* ── FAQ accordion ── */
document.querySelectorAll('.faq-q').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.parentElement;
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(f => f.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  });
});

/* ── Scroll reveal ── */
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

/* ── Global scroll helper ── */
window.scrollTo = function(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
};

/* ── Navbar scroll effect ── */
window.addEventListener('scroll', () => {
  document.getElementById('navbar').style.borderBottomColor = window.scrollY > 40 ? 'var(--border)' : 'transparent';
});

/* ── Hero pixel animation ── */
(function initHeroAnim() {
  const hCanvas = document.getElementById('hero-canvas');
  const hero    = document.getElementById('hero');
  const CELL    = 14;
  const PAL     = ['#00D4FF','#B400FF','#39FF14','#FFE000','#FF4757','#ffffff'];
  let cols, rows, grid;

  function resize() {
    hCanvas.width  = hero.offsetWidth;
    hCanvas.height = hero.offsetHeight;
    cols = Math.ceil(hCanvas.width  / CELL);
    rows = Math.ceil(hCanvas.height / CELL);
    grid = Array.from({length: cols * rows}, () =>
      Math.random() < .18 ? PAL[Math.floor(Math.random() * PAL.length)] : null
    );
  }

  function draw() {
    const hCtx = hCanvas.getContext('2d');
    const updates = Math.max(1, Math.floor(cols * rows * .008));
    for (let i = 0; i < updates; i++) {
      const idx = Math.floor(Math.random() * grid.length);
      grid[idx] = Math.random() < .28 ? PAL[Math.floor(Math.random() * PAL.length)] : null;
    }
    hCtx.clearRect(0, 0, hCanvas.width, hCanvas.height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const color = grid[r * cols + c];
        if (!color) continue;
        hCtx.fillStyle = color;
        hCtx.globalAlpha = .35 + Math.random() * .3;
        hCtx.fillRect(c * CELL, r * CELL, CELL - 1, CELL - 1);
      }
    }
    hCtx.globalAlpha = 1;
  }

  resize();
  window.addEventListener('resize', resize);
  setInterval(draw, 90);
})();

/* ── Toast ── */
const toastContainer = document.getElementById('toast-container');
function showToast(item) {
  const el = document.createElement('div');
  el.className = 'toast';
  const sub = item.message
    ? `(${item.x},${item.y}) · "${escHtml(item.message)}"`
    : `(${item.x},${item.y}) · ${item.hex}`;
  el.innerHTML = `
    <div class="toast-dot" style="background:${item.hex}"></div>
    <div class="toast-body">
      <div class="toast-title">${escHtml(item.alias)} colocó un píxel</div>
      <div class="toast-sub">${sub}</div>
    </div>`;
  // remove any existing toast immediately
  [...toastContainer.children].forEach(c => c.remove());
  toastContainer.prepend(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, 3500);
}

/* ── HTML escape ── */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Init ── */
centerCanvas();
