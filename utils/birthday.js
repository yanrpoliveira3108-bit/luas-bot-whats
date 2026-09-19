/**
 * utils/birthday.js — aniversários (recurso global "Aniversário" do AutoBot).
 *
 * Os membros cadastram o próprio aniversário com `!aniversario dd/mm`. Quando
 * o recurso global está ligado, o bot felicita automaticamente no(s) grupo(s)
 * em que a pessoa está, UMA vez por dia (a data do último aviso fica no banco,
 * então reiniciar o bot não repete a mensagem).
 */

'use strict';

const { prepare } = require('../database/database');
const now = () => new Date().toISOString();

/** Valida e normaliza "dd/mm" (aceita também "dd/mm/aaaa" e "dd-mm"). */
function parseDate(input) {
  const m = String(input || '').trim().match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?:\s*[\/\-.]\s*\d{2,4})?$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (!Number.isFinite(day) || !Number.isFinite(month)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  // rejeita datas impossíveis (ex.: 31/02)
  const test = new Date(2024, month - 1, day); // 2024 é bissexto
  if (test.getDate() !== day || test.getMonth() !== month - 1) return null;
  return { day, month };
}

function set(jid, input) {
  const parsed = parseDate(input);
  if (!parsed) return null;
  prepare(
    'set_birthday',
    `INSERT INTO birthdays (user_id, day, month, created_at, last_announced)
     VALUES (?, ?, ?, ?, '')
     ON CONFLICT(user_id) DO UPDATE SET day = excluded.day, month = excluded.month`
  ).run(jid, parsed.day, parsed.month, now());
  return parsed;
}

function get(jid) {
  return prepare('get_birthday', `SELECT * FROM birthdays WHERE user_id = ?`).get(jid) || null;
}

function remove(jid) {
  return prepare('del_birthday', `DELETE FROM birthdays WHERE user_id = ?`).run(jid);
}

/** Quem faz aniversário hoje. */
function today(date = new Date()) {
  return prepare(
    'today_birthdays',
    `SELECT user_id, day, month, last_announced FROM birthdays WHERE day = ? AND month = ?`
  ).all(date.getDate(), date.getMonth() + 1);
}

/** Marca que o aviso de hoje já foi enviado (idempotente). */
function markAnnounced(jid, isoDay) {
  return prepare('mark_birthday', `UPDATE birthdays SET last_announced = ? WHERE user_id = ?`).run(isoDay, jid);
}

function canAnnounce(row, isoDay) {
  return !!row && row.last_announced !== isoDay;
}

function isToday(row, date = new Date()) {
  return !!row && row.day === date.getDate() && row.month === date.getMonth() + 1;
}

function count() {
  return prepare('count_birthdays', `SELECT COUNT(*) AS c FROM birthdays`).get().c;
}

module.exports = { parseDate, set, get, remove, today, markAnnounced, canAnnounce, isToday, count };
