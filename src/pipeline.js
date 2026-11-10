#!/usr/bin/env node
/**
 * Coleta diária: para cada nicho > categoria > busca > loja, coleta produtos,
 * normaliza, gera link de afiliado, atualiza histórico de preço e grava
 * data/products/<nicho>.json + data/status.json.
 *
 * Uso: node src/pipeline.js [--niche bebe] [--sources amazon,shopee] [--limit 12]
 */
const path = require('path');
const { ROOT, loadEnv, readJSON, writeJSON, fold } = require('./util');
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

/**
 * Faixa etária a partir do título (selo do tema Bebê). "m" solto só vale com "+" ("6m+", "+4m"):
 * sem isso "Visão Noturna 10M" e "1,20m" viravam idade.
 */
function ageFromTitle(t) {
  if (/rec[eé]m[- ]nascido|\bRN\b/i.test(t)) return '0+';
  const m =
    t.match(/(\d{1,2})\s*(?:a|á|à|-|–)\s*\d{1,2}\s*(?:meses|m\b)/i) ||
    t.match(/(\d{1,2})\s*(?:meses|m[eê]s)(?![a-zà-ú])/i) ||
    t.match(/(?<![\d,.x])(\d{1,2})\s*m\s*\+/i) ||
    t.match(/\+\s*(\d{1,2})\s*m\b/i);
  return m && +m[1] <= 36 ? `${+m[1]}m+` : null;
}

/** Nota de destaque 0-100: desconto real pesa mais; avaliações e popularidade desempatam. */
function score(p) {
  const disc = Math.min(Math.max(p.discount || 0, 0), 70) / 70;
  // Nota com menos de 10 avaliações não é confiável (5,0 com 1 review): trata como "sem nota".
  const rated = p.rating && (p.reviews == null || p.reviews >= 10);
  const rating = rated ? Math.min(Math.max(0, (p.rating - 3.5) / 1.5), 1) : 0.4;
  const pop = Math.min(Math.log10((p.reviews || p.sold || 0) + 1) / 4, 1);
  return Math.round((disc * 0.5 + rating * 0.2 + pop * 0.3) * 100);
}

/** Título contém algum termo de exclusão (palavra inteira, sem acento/caixa)? */
function isExcluded(title, terms) {
  if (!terms || !terms.length) return false;
  const t = ` ${fold(title).replace(/[^a-z0-9]+/g, ' ')} `;
  return terms.some((term) => t.includes(` ${fold(term).replace(/[^a-z0-9]+/g, ' ').trim()} `));
}

/**
 * Variações do mesmo produto (cor/aroma/tamanho) não devem dominar a vitrine.
 * Recebe a lista já ordenada por score. Mesmo título na categoria -> fica 1.
 * Mesma "família" (a Amazon repete nota e nº de avaliações entre variações) -> ficam até `maxPerFamily`.
 */
function dedupeVariants(products, maxPerFamily = 2) {
  const titles = new Set();
  const families = new Map();
  return products.filter((p) => {
    const tk = `${p.source}|${p.cat}|${fold(p.title)}`;
    if (titles.has(tk)) return false;
    if (p.rating && p.reviews >= 10) {
      const fk = `${p.source}|${p.cat}|${p.rating}|${p.reviews}`;
      const n = families.get(fk) || 0;
      if (n >= maxPerFamily) return false;
      families.set(fk, n + 1);
    }
    titles.add(tk);
    return true;
  });
}

function finalize(raw, { niche, cat, today, history, env }) {
  const id = `${raw.source}:${raw.sourceId}`;
  const listPrice = raw.listPrice > raw.price ? raw.listPrice : null; // "De:" menor ou igual ao preço não é desconto
  const discount = listPrice ? Math.round((1 - raw.price / listPrice) * 100) : 0;
  const hist = (history[id] = history[id] || { firstSeen: today, prices: [] });
  const last = hist.prices[hist.prices.length - 1];
  if (!last || last.d !== today) hist.prices.push({ d: today, p: raw.price });
  else last.p = raw.price;
  hist.prices = hist.prices.slice(-90);
  const prev = hist.prices.length > 1 ? hist.prices[hist.prices.length - 2].p : null;
  const all = hist.prices.map((x) => x.p);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const link = affiliateLink(raw, env);
  const p = {
    id,
    niche,
    cat,
    source: raw.source,
    store: (SOURCES[raw.source] || {}).label || raw.source,
    title: raw.title.replace(/\s+/g, ' ').trim(),
    price: raw.price,
    listPrice,
    pixPrice: !!raw.pixPrice, // preço válido só à vista no Pix (Amazon)
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
    // Preço parado há 7 dias não é "menor preço": precisa já ter custado mais.
    lowestSeen: hist.prices.length >= 7 && raw.price <= min && raw.price < max,
  };
  p.score = score(p);
  return p;
}

const STALE_DAYS = 3;

/** Data local do Brasil (YYYY-MM-DD): em UTC a coleta das 21h+ cairia no dia seguinte. */
function localDate(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

/** Produtos da coleta anterior a reaproveitar: loja+categoria que falhou hoje, ainda não vistos, com até STALE_DAYS. */
function carryOver(previous, failedCats, byId, today) {
  const out = [];
  for (const old of (previous && previous.products) || []) {
    if (!failedCats[old.source] || !failedCats[old.source].has(old.cat) || byId.has(old.id)) continue;
    const staleSince = old.staleSince || String(previous.generatedAt || today).slice(0, 10);
    if ((Date.parse(today) - Date.parse(staleSince)) / 864e5 > STALE_DAYS) continue;
    out.push({ ...old, stale: true, staleSince, isNew: false, priceDropped: false, lowestSeen: false });
  }
  return out;
}

/**
 * opts (para testes): root (pasta com config/ e data/), sources (mapa id -> {label, search, close}),
 * niche, sourceIds, limit, today. Sem opts, usa argv/env como antes.
 */
async function run(opts = {}) {
  const root = opts.root || ROOT;
  const sources = opts.sources || SOURCES;
  const niches = readJSON(path.join(root, 'config/niches.json'), {});
  const onlyNiche = opts.niche || arg('niche');
  const sourceIds = (opts.sourceIds || arg('sources') || process.env.SOURCES || Object.keys(sources).join(','))
    .split(',').map((s) => s.trim()).filter((s) => sources[s]);
  const limit = opts.limit || parseInt(arg('limit') || process.env.LIMIT_PER_QUERY || '12', 10) || 12;
  const today = opts.today || localDate();
  const historyFile = path.join(root, 'data/history.json');
  const history = readJSON(historyFile, {});
  if (!history.__start) history.__start = today; // itens vistos no 1º dia não contam como "novo"
  const status = { generatedAt: new Date().toISOString(), niches: {} };

  for (const [nicheId, niche] of Object.entries(niches)) {
    if (onlyNiche && onlyNiche !== nicheId) continue;
    const byId = new Map();
    const srcStatus = Object.fromEntries(sourceIds.map((s) => [s, { status: 'OK', count: 0, queries: 0, errors: [] }]));
    const disabled = new Set();
    const failedCats = Object.fromEntries(sourceIds.map((s) => [s, new Set()]));

    for (const cat of niche.categories) {
      for (const query of cat.queries) {
        for (const sid of sourceIds) {
          if (disabled.has(sid)) {
            if (srcStatus[sid].status === 'BLOCKED') failedCats[sid].add(cat.id);
            continue;
          }
          const st = srcStatus[sid];
          try {
            const items = (await sources[sid].search({ query, limit })) || [];
            st.queries++;
            const exclude = [...(niche.exclude || []), ...(cat.exclude || [])];
            for (const raw of items) {
              // Item malformado ou fora do nicho não pode derrubar a busca inteira nem sujar o histórico.
              if (!raw || !raw.sourceId || !raw.title || !(raw.price > 0)) continue;
              if (isExcluded(raw.title, exclude)) continue;
              if (byId.has(`${raw.source}:${raw.sourceId}`)) continue; // já visto em outra busca/categoria
              const p = finalize(raw, { niche: nicheId, cat: cat.id, today, history, env: process.env });
              byId.set(p.id, p);
            }
            console.log(`[${nicheId}] ${sid.padEnd(13)} "${query}" -> ${items.length}`);
          } catch (e) {
            const code = e.code || 'ERROR';
            st.errors.push({ query, code, message: e.message });
            if (code !== 'NO_CREDENTIALS') failedCats[sid].add(cat.id);
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

    const outFile = path.join(root, `data/products/${nicheId}.json`);
    const previous = readJSON(outFile, null);
    // Loja bloqueada/com erro no meio da coleta: reaproveita (por até STALE_DAYS) os produtos de ontem
    // dessa loja nas categorias que falharam, em vez de publicar a vitrine pela metade.
    for (const old of carryOver(previous, failedCats, byId, today)) byId.set(old.id, old);

    const products = dedupeVariants([...byId.values()].sort((a, b) => b.score - a.score));
    for (const sid of sourceIds) {
      const st = srcStatus[sid];
      st.count = products.filter((p) => p.source === sid && !p.stale).length;
      st.stale = products.filter((p) => p.source === sid && p.stale).length;
      st.tagged = products.filter((p) => p.source === sid && p.affiliateTagged).length;
      if (st.status === 'OK' && st.count === 0) st.status = st.errors.length ? st.errors[0].code : 'EMPTY';
      else if (st.status === 'OK' && st.errors.length) st.status = 'PARTIAL';
    }

    if (!products.length && previous && previous.products?.length) {
      // Coleta zerada: mantém a vitrine de ontem em vez de publicar página vazia.
      console.warn(`[${nicheId}] coleta vazia — mantendo ${previous.products.length} produtos anteriores`);
      status.niches[nicheId] = { total: previous.products.length, stale: true, staleSince: previous.generatedAt, sources: srcStatus };
      continue;
    }
    writeJSON(outFile, { niche: nicheId, generatedAt: status.generatedAt, sources: srcStatus, products });
    status.niches[nicheId] = { total: products.length, stale: false, sources: srcStatus };
  }

  // Fechar navegador não pode impedir a gravação do histórico.
  for (const s of Object.values(sources)) if (s.close) await Promise.resolve().then(() => s.close()).catch((e) => console.warn(`close: ${e.message}`));
  writeJSON(historyFile, history);
  // Com --niche, preserva o status dos outros nichos em vez de apagá-los.
  const statusFile = path.join(root, 'data/status.json');
  if (onlyNiche) status.niches = { ...(readJSON(statusFile, {}).niches || {}), ...status.niches };
  writeJSON(statusFile, status);

  console.log('\nResumo:');
  for (const [n, st] of Object.entries(status.niches))
    console.log(`  ${n}: ${st.total} produtos | ` +
      Object.entries(st.sources || {}).map(([k, v]) => `${k}=${v.status}(${v.count})`).join(' '));
  return status;
}

if (require.main === module) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { run, finalize, score, ageFromTitle, isExcluded, dedupeVariants, carryOver, localDate };
