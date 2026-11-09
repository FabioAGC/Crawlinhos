const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Carrega .env simples (KEY=VALUE) sem dependências. Não sobrescreve variáveis já definidas. */
function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

/** Erro de fonte com código: BLOCKED | NO_CREDENTIALS | PARSE | HTTP */
class SourceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** "R$ 1.234,56" | "1234.56" | 1234.56 -> 1234.56 (ou null) */
function parseBRL(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  let s = String(v).replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const fmtBRL = (n) =>
  'R$ ' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/** fetch com timeout que devolve {status, text, json} e nunca lança por status HTTP. */
async function http(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, text, json, url: res.url };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { ROOT, loadEnv, SourceError, parseBRL, fmtBRL, esc, sleep, readJSON, writeJSON, http };
