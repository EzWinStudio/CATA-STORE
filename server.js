const fs = require('fs'), path = require('path');
// .env dosyasını oku (host'ta çalışma klasörü farklı olsa bile doğru yerden okur)
try { fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch {}
const express = require('express');
const PIN = String(process.env.ADMIN_PIN || '8564').trim();
const HOOK = process.env.DISCORD_WEBHOOK;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');   // Host'ta kalıcı bir klasör verin
fs.mkdirSync(DIR, { recursive: true });
const FILE = path.join(DIR, 'store.json');
let DB = { state: null, orders: [] };
try { DB = { ...DB, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(DB)); fs.renameSync(FILE + '.tmp', FILE); };

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const admin = r => String(r.get('x-admin-pin') || '').trim() === PIN;

// PIN deneme sınırı: IP başına 15 dakikada 10 hatalı deneme
const fails = new Map();
app.post('/api/admin/login', (q, s) => {
  const ip = q.ip, now = Date.now(), f = (fails.get(ip) || []).filter(t => now - t < 9e5);
  if (f.length >= 10) return s.status(429).json({ error: 'Çok fazla deneme, 15 dk sonra tekrar deneyin' });
  const ok = String((q.body && q.body.pin) || '').trim() === PIN;
  if (!ok) { f.push(now); fails.set(ip, f); }
  s.json({ ok });
});
app.get('/api/state', (q, s) => s.json(DB.state));
app.put('/api/state', (q, s) => { if (!admin(q)) return s.sendStatus(401); DB.state = q.body; save(); s.json({ ok: true }); });

app.post('/api/orders', (q, s) => {
  const st = DB.state; if (!st) return s.status(400).json({ error: 'Site henüz yapılandırılmadı' });
  if (st.maintenance || !st.inStock) return s.status(400).json({ error: 'Satış kapalı' });
  const { username, robux, paymentMethod } = q.body || {};
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username || '') || username.startsWith('_') || username.endsWith('_')) return s.status(400).json({ error: 'Geçersiz kullanıcı adı' });
  if (!['Papara', 'Discord'].includes(paymentMethod)) return s.status(400).json({ error: 'Geçersiz ödeme yöntemi' });
  if (!Number.isInteger(robux) || robux < 100 || robux > st.totalStock) return s.status(400).json({ error: 'Geçersiz miktar / stok yetersiz' });
  const pkg = (st.packages || []).find(p => p.amount === robux);
  const price = pkg ? pkg.price : +(robux * st.rate / 1000).toFixed(2);
  let id; do { id = 'CATA-' + Math.floor(10000 + Math.random() * 90000); } while (DB.orders.some(o => o.id === id));
  const o = { id, date: new Date().toISOString().slice(0, 16).replace('T', ' '), username, robux, price, paymentMethod, status: 'Beklemede' };
  DB.orders.unshift(o); st.totalStock -= robux; save();
  if (HOOK && typeof fetch === 'function') fetch(HOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `🛒 ${id} | ${username} | ${robux} R$ | ${price} ₺ | ${paymentMethod}` }) }).catch(() => {});
  s.json({ id, price });
});
app.get('/api/orders/:id', (q, s) => {
  const o = DB.orders.find(x => x.id === q.params.id.toUpperCase()); if (!o) return s.sendStatus(404);
  s.json({ id: o.id, robux: o.robux, price: o.price, status: o.status });
});
app.get('/api/admin/orders', (q, s) => admin(q) ? s.json(DB.orders) : s.sendStatus(401));
app.patch('/api/admin/orders/:id', (q, s) => {
  if (!admin(q)) return s.sendStatus(401);
  const o = DB.orders.find(x => x.id === q.params.id); if (!o) return s.sendStatus(404);
  o.status = q.body.status; save(); s.json(o);
});
app.delete('/api/admin/orders', (q, s) => { if (!admin(q)) return s.sendStatus(401); DB.orders = []; save(); s.json({ ok: true }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CATA STORE çalışıyor | port: ' + PORT + ' | veri: ' + FILE + ' | PIN: ' + (process.env.ADMIN_PIN ? '.env/ortam' : '8564 (varsayılan)')));
