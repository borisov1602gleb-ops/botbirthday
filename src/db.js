const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'birthdays.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS birthdays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    day INTEGER NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reminders_sent (
    chat_id INTEGER NOT NULL,
    birthday_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    sent_on TEXT NOT NULL,
    PRIMARY KEY (birthday_id, kind, sent_on)
  );

  CREATE TABLE IF NOT EXISTS greeting_overrides (
    chat_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (chat_id, idx)
  );

  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    first_name TEXT,
    username TEXT,
    PRIMARY KEY (chat_id, user_id)
  );
`);

function addBirthday(chatId, name, day, month, year) {
  const stmt = db.prepare(
    'INSERT INTO birthdays (chat_id, name, day, month, year) VALUES (?, ?, ?, ?, ?)'
  );
  const info = stmt.run(chatId, name, day, month, year);
  return info.lastInsertRowid;
}

function listBirthdays(chatId) {
  return db
    .prepare('SELECT * FROM birthdays WHERE chat_id = ? ORDER BY month, day')
    .all(chatId);
}

function removeBirthday(chatId, id) {
  const info = db
    .prepare('DELETE FROM birthdays WHERE chat_id = ? AND id = ?')
    .run(chatId, id);
  return info.changes > 0;
}

function getAllChats() {
  return db.prepare('SELECT DISTINCT chat_id FROM birthdays').all().map((r) => r.chat_id);
}

function wasReminderSent(birthdayId, kind, sentOn) {
  const row = db
    .prepare(
      'SELECT 1 FROM reminders_sent WHERE birthday_id = ? AND kind = ? AND sent_on = ?'
    )
    .get(birthdayId, kind, sentOn);
  return !!row;
}

function markReminderSent(chatId, birthdayId, kind, sentOn) {
  db.prepare(
    'INSERT OR IGNORE INTO reminders_sent (chat_id, birthday_id, kind, sent_on) VALUES (?, ?, ?, ?)'
  ).run(chatId, birthdayId, kind, sentOn);
}

function getGreetingOverrides(chatId) {
  const rows = db
    .prepare('SELECT idx, text FROM greeting_overrides WHERE chat_id = ?')
    .all(chatId);
  const map = {};
  for (const row of rows) map[row.idx] = row.text;
  return map;
}

function setGreetingOverride(chatId, idx, text) {
  db.prepare(
    `INSERT INTO greeting_overrides (chat_id, idx, text) VALUES (?, ?, ?)
     ON CONFLICT(chat_id, idx) DO UPDATE SET text = excluded.text`
  ).run(chatId, idx, text);
}

function resetGreetingOverride(chatId, idx) {
  const info = db
    .prepare('DELETE FROM greeting_overrides WHERE chat_id = ? AND idx = ?')
    .run(chatId, idx);
  return info.changes > 0;
}

function upsertChatMember(chatId, userId, firstName, username) {
  db.prepare(
    `INSERT INTO chat_members (chat_id, user_id, first_name, username) VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_id, user_id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`
  ).run(chatId, userId, firstName || null, username || null);
}

function listChatMembers(chatId) {
  return db.prepare('SELECT * FROM chat_members WHERE chat_id = ?').all(chatId);
}

module.exports = {
  addBirthday,
  listBirthdays,
  removeBirthday,
  getAllChats,
  wasReminderSent,
  markReminderSent,
  getGreetingOverrides,
  setGreetingOverride,
  resetGreetingOverride,
  upsertChatMember,
  listChatMembers,
};
