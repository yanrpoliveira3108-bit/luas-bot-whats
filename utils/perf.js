'use strict';

const counters = new Map();
const recent = [];
const CAP = 200;
let enabled = true;

function setEnabled(v) { enabled = !!v; }
function add(key, n = 1) { if (enabled) counters.set(key, (counters.get(key) || 0) + n); }
function count(key, n = 1) { add(key, n); }
function timing(key, ms) {
  if (!enabled) return;
  const value = Math.max(0, Number(ms) || 0);
  const k = `time:${key}`;
  const entry = counters.get(k) || { sum: 0, n: 0 };
  entry.sum += value; entry.n += 1; counters.set(k, entry);
  if (key === 'command') { recent.push({ at: Date.now(), totalMs: value }); if (recent.length > CAP) recent.shift(); }
}
function avg(key) { const e = counters.get(`time:${key}`); return e && e.n ? Math.round(e.sum / e.n) : 0; }
function get(key) { return counters.get(key) || 0; }
function percentile(values, p) {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  return Math.round(a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))]);
}
function responseStats() {
  const values = recent.map((x) => x.totalMs);
  return { count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: values.length ? Math.max(...values) : 0 };
}
function snapshot() {
  return { enabled, messages: get('messages'), commands: get('commands'), errors: get('errors'), downloads: get('downloads'), cacheHits: get('cache:hits'), cacheMisses: get('cache:misses'), avgResponseMs: avg('command'), pingMs: avg('ping'), groups: get('groups'), response: responseStats() };
}
function reset() { counters.clear(); recent.length = 0; }
module.exports = { setEnabled, add, count, timing, avg, get, snapshot, responseStats, reset };
