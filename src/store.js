// store.js — GoldenBay's tiny "database".
//
// For the hackathon demo we persist everything to one JSON file on disk.
// This module is deliberately shaped like a real database layer (get/insert/update
// by collection), so later we can swap it for PostgreSQL without touching the
// rest of the code. That boundary is called a "data access layer".

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// In-memory copy of the whole database. Reads are instant; writes are
// flushed to disk shortly after (debounced) so rapid updates don't hammer the disk.
let db = { profiles: [], emergencies: [], hospitals: [], labReports: [] };
let saveTimer = null;

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      console.error('[store] db.json was corrupt, starting fresh:', err.message);
    }
  }
  for (const key of ['profiles', 'emergencies', 'hospitals', 'labReports']) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), (err) => {
      if (err) console.error('[store] failed to save db.json:', err.message);
    });
  }, 200);
}

// crypto.randomUUID gives us globally-unique, non-guessable IDs.
const { randomUUID } = require('crypto');

module.exports = {
  load,

  all(collection) {
    return db[collection];
  },

  find(collection, id) {
    return db[collection].find((item) => item.id === id) || null;
  },

  insert(collection, item) {
    const record = { id: randomUUID(), createdAt: new Date().toISOString(), ...item };
    db[collection].push(record);
    scheduleSave();
    return record;
  },

  update(collection, id, changes) {
    const record = this.find(collection, id);
    if (!record) return null;
    Object.assign(record, changes, { updatedAt: new Date().toISOString() });
    scheduleSave();
    return record;
  },

  remove(collection, id) {
    const i = db[collection].findIndex((item) => item.id === id);
    if (i === -1) return false;
    db[collection].splice(i, 1);
    scheduleSave();
    return true;
  },

  // Replace an entire collection (used by seeding).
  setAll(collection, items) {
    db[collection] = items;
    scheduleSave();
  },
};