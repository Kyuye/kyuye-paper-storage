const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3333;

// DB setup
const DB_PATH = path.join(__dirname, 'paperhub.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#e8829a',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    folder TEXT DEFAULT NULL,
    journal TEXT DEFAULT '',
    date TEXT DEFAULT '',
    title TEXT NOT NULL,
    authors TEXT DEFAULT '',
    doi TEXT DEFAULT '',
    abstract TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    intro TEXT DEFAULT '',
    results TEXT DEFAULT '',
    methods TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS figures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    description TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    image BLOB,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
  );
`);

// Seed default folders if empty
const folderCount = db.prepare('SELECT COUNT(*) as cnt FROM folders').get().cnt;
if (folderCount === 0) {
  const insert = db.prepare('INSERT INTO folders (id, name, color) VALUES (?, ?, ?)');
  insert.run('f1', 'Chimeric GPCR', '#e8829a');
  insert.run('f2', 'GPCR chemical', '#a8d8c8');
  insert.run('f3', 'bAmyloid', '#c8b8e8');
  console.log('Default folders created');
}

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ========== FOLDERS ==========
app.get('/api/folders', (req, res) => {
  const rows = db.prepare('SELECT * FROM folders ORDER BY created_at').all();
  res.json(rows);
});

app.post('/api/folders', (req, res) => {
  const { id, name, color } = req.body;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT OR REPLACE INTO folders (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, color || '#e8829a', now, now);
  res.json({ ok: true });
});

app.put('/api/folders/:id', (req, res) => {
  const { name, color } = req.body;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE folders SET name=?, color=?, updated_at=? WHERE id=?').run(name, color, now, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/folders/:id', (req, res) => {
  db.prepare('UPDATE papers SET folder="" WHERE folder=?').run(req.params.id);
  db.prepare('DELETE FROM folders WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ========== PAPERS ==========
app.get('/api/papers', (req, res) => {
  const papers = db.prepare('SELECT * FROM papers ORDER BY created_at DESC').all();
  const figStmt = db.prepare('SELECT id, paper_id, name, description, sort_order, CASE WHEN image IS NOT NULL THEN 1 ELSE 0 END as has_image FROM figures WHERE paper_id=? ORDER BY sort_order');
  papers.forEach(p => {
    p.figures = figStmt.all(p.id).map(f => ({
      id: f.id,
      name: f.name,
      desc: f.description,
      hasImage: !!f.has_image,
      imgKey: f.has_image ? `fig-db-${f.id}` : ''
    }));
  });
  res.json(papers);
});

app.post('/api/papers', (req, res) => {
  const p = req.body;
  const id = p.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5));

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`INSERT OR REPLACE INTO papers (id, folder, journal, date, title, authors, doi, abstract, summary, intro, results, methods, tags, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, p.folder || '', p.journal || '', p.date || '', p.title || '', p.authors || '',
    p.doi || '', p.abstract || '', p.summary || '', p.intro || '', p.results || '',
    p.methods || '', p.tags || '', p.notes || '', now, now
  );

  // Handle figures
  if (p.figures && p.figures.length) {
    db.prepare('DELETE FROM figures WHERE paper_id=?').run(id);
    const figInsert = db.prepare('INSERT INTO figures (paper_id, name, description, sort_order, image) VALUES (?, ?, ?, ?, ?)');
    p.figures.forEach((f, i) => {
      let imgBuf = null;
      if (f.imageData) {
        // base64 data URL -> buffer
        const base64 = f.imageData.replace(/^data:image\/\w+;base64,/, '');
        imgBuf = Buffer.from(base64, 'base64');
      }
      figInsert.run(id, f.name || '', f.desc || '', i, imgBuf);
    });
  }

  res.json({ ok: true, id });
});

app.delete('/api/papers/:id', (req, res) => {
  db.prepare('DELETE FROM figures WHERE paper_id=?').run(req.params.id);
  db.prepare('DELETE FROM papers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ========== FIGURE IMAGES ==========
app.get('/api/figures/:id/image', (req, res) => {
  const row = db.prepare('SELECT image FROM figures WHERE id=?').get(req.params.id);
  if (row && row.image) {
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(row.image);
  } else {
    res.status(404).send('No image');
  }
});

// ========== STATS ==========
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as cnt FROM papers').get().cnt;
  const journals = db.prepare("SELECT COUNT(DISTINCT journal) as cnt FROM papers WHERE journal != ''").get().cnt;
  const monthPrefix = new Date().toISOString().slice(0, 7) + '%';
  const thisMonth = db.prepare('SELECT COUNT(*) as cnt FROM papers WHERE date LIKE ?').get(monthPrefix).cnt;
  res.json({ total, journals, thisMonth });
});

app.listen(PORT, () => {
  console.log(`\n  🐰 KyuYe Paper Storage Server`);
  console.log(`  📂 Database: ${DB_PATH}`);
  console.log(`  🌐 Open: http://localhost:${PORT}\n`);
});
