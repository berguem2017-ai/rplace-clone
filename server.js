const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

const CANVAS_SIZE = 100;
const COOLDOWN_MS = 1000;
const STATE_FILE = path.join(__dirname, 'canvas.bin');
const META_FILE = path.join(__dirname, 'canvas_meta.json');

let canvasBuffer = Buffer.alloc(CANVAS_SIZE * CANVAS_SIZE * 3, 255);
let pixelMeta = new Array(CANVAS_SIZE * CANVAS_SIZE).fill(null);
const activityFeed = [];
const userStats = new Map();
let activeCount = 0;
let totalPixels = 0;

if (fs.existsSync(STATE_FILE)) {
  try {
    const saved = fs.readFileSync(STATE_FILE);
    if (saved.length === canvasBuffer.length) canvasBuffer = Buffer.from(saved);
  } catch (e) {}
}

if (fs.existsSync(META_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
    if (Array.isArray(data.pixelMeta)) pixelMeta = data.pixelMeta;
    if (data.userStats) {
      for (const [k, v] of Object.entries(data.userStats)) {
        userStats.set(k, v);
        totalPixels += v;
      }
    }
  } catch (e) {}
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function getTopUsers(n = 10) {
  return [...userStats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([alias, count]) => ({ alias, count }));
}

setInterval(() => {
  fs.writeFile(STATE_FILE, canvasBuffer, () => {});
  fs.writeFile(META_FILE, JSON.stringify({ pixelMeta, userStats: Object.fromEntries(userStats) }), () => {});
}, 30000);

const cooldowns = new Map();

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  activeCount++;
  io.emit('active', activeCount);

  socket.emit('canvas', canvasBuffer);
  socket.emit('meta', pixelMeta);
  socket.emit('feed', activityFeed.slice(0, 20));
  socket.emit('rankings', getTopUsers());
  socket.emit('total', totalPixels);

  socket.on('place', ({ x, y, r, g, b, alias, message }) => {
    if (
      typeof x !== 'number' || typeof y !== 'number' ||
      x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE ||
      !Number.isInteger(x) || !Number.isInteger(y) ||
      typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number' ||
      r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255
    ) return;

    const now = Date.now();
    const last = cooldowns.get(socket.id) || 0;
    if (now - last < COOLDOWN_MS) {
      socket.emit('cooldown', COOLDOWN_MS - (now - last));
      return;
    }
    cooldowns.set(socket.id, now);

    const cleanAlias = (typeof alias === 'string' ? alias.trim().slice(0, 32) : '') || 'Anon';
    const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 100) : '';
    const hex = rgbToHex(r, g, b);

    const idx = (y * CANVAS_SIZE + x) * 3;
    canvasBuffer[idx] = r;
    canvasBuffer[idx + 1] = g;
    canvasBuffer[idx + 2] = b;

    const meta = { alias: cleanAlias, hex, message: cleanMessage, ts: now };
    pixelMeta[y * CANVAS_SIZE + x] = meta;

    const feedItem = { x, y, ...meta };
    activityFeed.unshift(feedItem);
    if (activityFeed.length > 50) activityFeed.pop();

    userStats.set(cleanAlias, (userStats.get(cleanAlias) || 0) + 1);
    totalPixels++;

    io.emit('pixel', { x, y, r, g, b, ...meta });
    io.emit('feed_item', feedItem);
    io.emit('rankings', getTopUsers());
    io.emit('total', totalPixels);
  });

  socket.on('disconnect', () => {
    activeCount = Math.max(0, activeCount - 1);
    cooldowns.delete(socket.id);
    io.emit('active', activeCount);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`r/place running at http://localhost:${PORT}`));
