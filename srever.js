const express = require('express'), Database = require('better-sqlite3');
const db = new Database('store.db');
db.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, data TEXT)`);
const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static('public'));
const PIN = process.env.ADMIN_PIN || '8564';       // Canlıda mutlaka ADMIN_PIN ortam değişkeni verin
const HOOK = process.env.DISCORD_WEBHOOK;          // Yeni webhook'u sadece burada tutun
const admin = r => r.get('x-admin-pin') === PIN;
const getS = () => { const r = db.prepare("SELECT v FROM kv WHERE k='state'").get(); return r ? JSON.parse(r.v) : null; };
const setS = s => db.prepare("INSERT OR REPLACE INTO kv VALUES('state',?)").run(JSON.stringify(s));

app.get('/api/state', (q, s) => s.json(getS()));
app.post('/api/admin/login', (q, s) => s.json({ ok: q.body.pin === PIN }));
app.put('/api/state', (q, s) => { if (!admin(q)) return s.sendStatus(401); setS(q.body); s.json({ ok: true }); });

app.post('/api/orders', (q, s) => {
  const st = getS(); if (!st) return s.status(400).json({ error: 'Site henüz yapılandırılmadı' });
  if (st.maintenance || !st.inStock) return s.status(400).json({ error: 'Satış kapalı' });
  const { username, robux, paymentMethod } = q.body;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username) || username.startsWith('_') || username.endsWith('_')) return s.status(400).json({ error: 'Geçersiz kullanıcı adı' });
  if (!['Papara', 'Discord'].includes(paymentMethod)) return s.status(400).json({ error: 'Geçersiz ödeme yöntemi' });
  if (!Number.isInteger(robux) || robux < 100 || robux > st.totalStock) return s.status(400).json({ error: 'Geçersiz miktar / stok yetersiz' });
  const pkg = (st.packages || []).find(p => p.amount === robux);
  const price = pkg ? pkg.price : +(robux * st.rate / 1000).toFixed(2);   // Fiyatı istemciden değil sunucudan hesapla
  const id = 'CATA-' + Math.floor(10000 + Math.random() * 90000);
  const o = { id, date: new Date().toISOString().slice(0, 16).replace('T', ' '), username, robux, price, paymentMethod, status: 'Beklemede' };
  db.prepare('INSERT INTO orders VALUES(?,?)').run(id, JSON.stringify(o));
  st.totalStock -= robux; setS(st);
  if (HOOK) fetch(HOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: `🛒 ${id} | ${username} | ${robux} R$ | ${price} ₺ | ${paymentMethod}` }) }).catch(() => {});
  s.json({ id, price });
});
app.get('/api/orders/:id', (q, s) => {
  const r = db.prepare('SELECT data FROM orders WHERE id=?').get(q.params.id.toUpperCase());
  if (!r) return s.sendStatus(404);
  const o = JSON.parse(r.data); s.json({ id: o.id, robux: o.robux, price: o.price, status: o.status });
});
app.get('/api/admin/orders', (q, s) => admin(q) ? s.json(db.prepare('SELECT data FROM orders ORDER BY rowid DESC').all().map(r => JSON.parse(r.data))) : s.sendStatus(401));
app.patch('/api/admin/orders/:id', (q, s) => {
  if (!admin(q)) return s.sendStatus(401);
  const r = db.prepare('SELECT data FROM orders WHERE id=?').get(q.params.id); if (!r) return s.sendStatus(404);
  const o = JSON.parse(r.data); o.status = q.body.status; db.prepare('UPDATE orders SET data=? WHERE id=?').run(JSON.stringify(o), o.id); s.json(o);
});
app.delete('/api/admin/orders', (q, s) => { if (!admin(q)) return s.sendStatus(401); db.exec('DELETE FROM orders'); s.json({ ok: true }); });
app.listen(process.env.PORT || 3000, () => console.log('CATA STORE çalışıyor'));
