#!/usr/bin/env node
/**
 * Coleta diária: para cada nicho > categoria > busca > loja, coleta produtos,
 * normaliza, gera link de afiliado, atualiza histórico de preço e grava
 * data/products/<nicho>.json + data/status.json.
 *
 * Uso: node src/pipeline.js [--niche bebe] [--sources amazon,shopee] [--limit 12]
 */
const path = require('path');
const { ROOT, loadEnv, readJSON, writeJSON } = require('./util');
const { affiliateLink } = require('./affiliate');

loadEnv();

const SOURCES = {
  amazon: require('./sources/amazon'),
  mercadolivre: require('./sources/mercadolivre'),
  shopee: require('./sources/shopee'),
  magalu: require('./sources/magalu'),
};

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

/** Faixa etária a partir do título (selo do tema Bebê). */
function ageFromTitle(t) {
  const m = t.match(/(\d{1,2})\s*(?:a|-|–)\s*(\d{1,2})\s*m(?:eses)?\b/i) || t.match(/\+?\s*(\d{1,2})\s*m(?:eses)?\b\+?/i);
  if (/rec[eé]m[- ]nascido|\bRN\b/i.test(t)) return '0+';
  if (m) return `${m[1]}m+`;
  return null;
}

/** Nota de destaque 0-100: desconto real pesa mais; avaliações e popularidade desempatam. */
function score(p) {
  const disc = Math.min(p.discount, 70) / 70;
  const rating = p.rating ? Math.max(0, (p.rating - 3.5) / 1.5) : 0.4;
  const pop = Math.min(Math.log10((p.reviews || p.sold || 0) + 1) / 4, 1);
  return Math.round((disc * 0.5 + rating * 0.2 + pop * 0.3) * 100);
}

function finalize(raw, { niche, cat, today, history, env }) {
  const id = `${raw.source}:${raw.sourceId}`;
  const discount = raw.listPrice ? Math.round((1 - raw.price / raw.listPrice) * 100) : 0;
  const hist = (history[id] = history[id] || { firstSeen: today, prices: [] });
  const last = hist.prices[hist.prices.length - 1];
  if (!last || last.d !== today) hist.prices.push({ d: today, p: raw.price });
  else last.p = raw.price;
  hist.prices = hist.prices.slice(-90);
  const prev = hist.prices.length > 1 ? hist.prices[hist.prices.length - 2].p : null;
  const min = Math.min(...hist.prices.map((x) => x.p));
  const link = affiliateLink(raw, env);
  const p = {
    id,
    niche,
    cat,
    source: raw.source,
    store: SOURCES[raw.source].label,
    title: raw.title.replace(/\s+/g, ' ').trim(),
    price: raw.price,
    listPrice: raw.listPrice || null,
    discount,
    image: raw.image || null,
    url: raw.url,
    affiliateUrl: link.url,
    affiliateTagged: link.tagged,
    rating: raw.rating || null,
    reviews: raw.reviews || null,
    sold: raw.sold || null,
    age: niche === 'bebe' ? ageFromTitle(raw.title) : null,
    firstSeen: hist.firstSeen,
    isNew: hist.firstSeen !== history.__start && (Date.parse(today) - Date.parse(hist.firstSeen)) / 864e5 < 3,
    priceDropped: prev != null && raw.price < prev,
    lowestSeen: hist.prices.length >= 7 && raw.price <= min,
  };
  p.score = score(p);
  return p;
}

async function run() {
  const niches = readJSON(path.join(ROOT, 'config/niches.json'), {});
  const onlyNiche = arg('niche');
  const sourceIds = (arg('sources') || process.env.SOURCES || Object.keys(SOURCES).join(','))
    .split(',').map((s) => s.trim()).filter((s) => SOURCES[s]);
  const limit = parseInt(arg('limit') || process.env.LIMIT_PER_QUERY || '12', 10);
  const today = new Date().toISOString().slice(0, 10);
  const historyFile = path.join(ROOT, 'data/history.json');
  const history = readJSON(historyFile, {});
  if (!history.__start) history.__start = today; // itens vistos no 1º dia não contam como "novo"
  const status = { generatedAt: new Date().toISOString(), niches: {} };

  for (const [nicheId, niche] of Object.entries(niches)) {
    if (onlyNiche && onlyNiche !== nicheId) continue;
    const byId = new Map();
    const srcStatus = Object.fromEntries(sourceIds.map((s) => [s, { status: 'OK', count: 0, queries: 0, errors: [] }]));
    const disabled = new Set();

    for (const cat of niche.categories) {
      for (const query of cat.queries) {
        for (const sid of sourceIds) {
          if (disabled.has(sid)) continue;
          const st = srcStatus[sid];
          try {
            const items = await SOURCES[sid].search({ query, limit });
            st.queries++;
            for (const raw of items) {
              const p = finalize(raw, { niche: nicheId, cat: cat.id, today, history, env: process.env });
              if (!byId.has(p.id)) byId.set(p.id, p);
            }
            console.log(`[${nicheId}] ${sid.padEnd(13)} "${query}" -> ${items.length}`);
          } catch (e) {
            const code = e.code || 'ERROR';
            st.errors.push({ query, code, message: e.message });
            console.warn(`[${nicheId}] ${sid.padEnd(13)} "${query}" FALHOU ${code}: ${e.message}`);
            // Sem credencial ou bloqueado: não adianta insistir nas próximas buscas.
            if (code === 'NO_CREDENTIALS' || code === 'BLOCKED') {
              st.status = code;
              disabled.add(sid);
            }
          }
        }
      }
    }

    const products = [...byId.values()].sort((a, b) => b.score - a.score);
    for (const sid of sourceIds) {
      const st = srcStatus[sid];
      st.count = products.filter((p) => p.source === sid).length;
      st.tagged = products.filter((p) => p.source === sid && p.affiliateTagged).length;
      if (st.status === 'OK' && st.count === 0) st.status = st.errors.length ? st.errors[0].code : 'EMPTY';
      else if (st.status === 'OK' && st.errors.length) st.status = 'PARTIAL';
    }

    const outFile = path.join(ROOT, `data/products/${nicheId}.json`);
    const previous = readJSON(outFile, null);
    if (!products.length && previous && previous.products?.length) {
      // Coleta zerada: mantém a vitrine de ontem em vez de publicar página vazia.
      console.warn(`[${nicheId}] coleta vazia — mantendo ${previous.products.length} produtos anteriores`);
      status.niches[nicheId] = { total: previous.products.length, stale: true, staleSince: previous.generatedAt, sources: srcStatus };
      continue;
    }
    writeJSON(outFile, { niche: nicheId, generatedAt: status.generatedAt, sources: srcStatus, products });
    status.niches[nicheId] = { total: products.length, stale: false, sources: srcStatus };
  }

  for (const s of Object.values(SOURCES)) if (s.close) await s.close();
  writeJSON(historyFile, history);
  writeJSON(path.join(ROOT, 'data/status.json'), status);

  console.log('\nResumo:');
  for (const [n, st] of Object.entries(status.niches))
    console.log(`  ${n}: ${st.total} produtos | ` +
      Object.entries(st.sources).map(([k, v]) => `${k}=${v.status}(${v.count})`).join(' '));
  return status;
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run, finalize, score, ageFromTitle };
