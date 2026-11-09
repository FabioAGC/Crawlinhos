/**
 * Mercado Livre — API oficial (api.mercadolibre.com), exige token OAuth de um app
 * criado em developers.mercadolivre.com.br. As páginas públicas bloqueiam robôs
 * (redirecionam para /gz/account-verification), então não há modo "scraping".
 *
 * Credenciais (uma das duas formas):
 *   A) ML_CLIENT_ID + ML_CLIENT_SECRET + ML_REFRESH_TOKEN  -> renova o access_token sozinho
 *      (POST /oauth/token, grant_type=refresh_token). O refresh_token é de uso único:
 *      cada renovação devolve um novo, que fica em data/ml-token.json.
 *   B) ML_ACCESS_TOKEN direto (dura 6h; serve para teste manual).
 *
 * Busca (ML_SEARCH_MODE):
 *   items   -> GET /sites/MLB/search?q=            (anúncios, já vem com preço)
 *   catalog -> GET /products/search?site_id=MLB&q= + GET /products/{id} (catálogo; preço em buy_box_winner)
 *   auto    -> tenta items; se a API recusar com 403, tenta catalog   (padrão)
 * O modo catalog foi escrito a partir da documentação, sem resposta real para conferir.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, SourceError, http, sleep, readJSON } = require('../util');

const API = 'https://api.mercadolibre.com';
const SITE = 'MLB';
const MAX_LIMIT = 50; // limite documentado de `limit` em /sites/{site}/search
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** Ajustáveis nos testes. */
const config = { api: API, retryDelayMs: 2000 };

const tokenFile = () => process.env.ML_TOKEN_FILE || path.join(ROOT, 'data/ml-token.json');
const fingerprint = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};

function fixImage(u) {
  if (!u || typeof u !== 'string') return null;
  // thumbnail vem como http:// e em tamanho "I" (pequeno); "O" é a variante de 500px.
  return u.replace(/^http:/, 'https:').replace(/-I\.(jpg|jpeg|webp|png)$/i, '-O.$1');
}

/** Item de /sites/MLB/search -> produto normalizado (ou null se faltar o essencial). */
function normalize(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.currency_id && r.currency_id !== 'BRL') return null;
  const sale = r.sale_price && typeof r.sale_price === 'object' ? r.sale_price : null;
  const price = num(r.price) ?? num(sale && sale.amount);
  const url = typeof r.permalink === 'string' && /^https?:\/\//.test(r.permalink) ? r.permalink : null;
  if (!r.id || !r.title || !price || !url) return null;
  const list = num(r.original_price) ?? num(sale && sale.regular_amount);
  return {
    source: 'mercadolivre',
    sourceId: String(r.id),
    title: String(r.title),
    price,
    listPrice: list && list > price ? list : null,
    image: fixImage(r.thumbnail || r.secure_thumbnail),
    url,
    rating: null, // a busca não devolve avaliações
    reviews: null,
    sold: num(r.sold_quantity),
    freeShipping: !!(r.shipping && r.shipping.free_shipping),
  };
}

/** Produto de catálogo (GET /products/{id}) -> produto normalizado. Preço vem do buy_box_winner. */
function normalizeCatalog(p) {
  if (!p || typeof p !== 'object') return null;
  const w = p.buy_box_winner && typeof p.buy_box_winner === 'object' ? p.buy_box_winner : null;
  if (!w) return null; // sem oferta ativa no momento
  if (w.currency_id && w.currency_id !== 'BRL') return null;
  const price = num(w.price);
  if (!p.id || !p.name || !price) return null;
  const list = num(w.original_price);
  const pic = Array.isArray(p.pictures) && p.pictures[0] ? p.pictures[0].url || p.pictures[0].secure_url : null;
  const url = typeof p.permalink === 'string' && /^https?:\/\//.test(p.permalink)
    ? p.permalink
    : `https://www.mercadolivre.com.br/p/${encodeURIComponent(p.id)}`;
  return {
    source: 'mercadolivre',
    sourceId: String(p.id),
    title: String(p.name),
    price,
    listPrice: list && list > price ? list : null,
    image: fixImage(pic),
    url,
    rating: null,
    reviews: null,
    sold: null,
    freeShipping: !!(w.shipping && w.shipping.free_shipping),
  };
}

// ---------------------------------------------------------------- token OAuth

let refreshing = null; // evita duas renovações simultâneas (o refresh_token é de uso único)

function refreshCreds() {
  const { ML_CLIENT_ID: id, ML_CLIENT_SECRET: secret, ML_REFRESH_TOKEN: seed } = process.env;
  return id && secret && seed ? { id: id.trim(), secret: secret.trim(), seed: seed.trim() } : null;
}

/** Estado salvo; descartado se o ML_REFRESH_TOKEN do .env mudou (dono reautorizou o app). */
function loadState(creds) {
  const st = readJSON(tokenFile(), null);
  if (!st || typeof st !== 'object' || !st.refresh_token) return null;
  if (st.client_id && st.client_id !== creds.id) return null;
  if (st.seed && st.seed !== fingerprint(creds.seed)) return null;
  return st;
}

function saveState(state) {
  const f = tokenFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

async function doRefresh(creds) {
  const saved = loadState(creds);
  const refreshToken = (saved && saved.refresh_token) || creds.seed;
  const res = await http(`${config.api}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.id,
      client_secret: creds.secret,
      refresh_token: refreshToken,
    }).toString(),
  });
  const j = res.json || {};
  if (res.status === 429) throw new SourceError('HTTP', 'Mercado Livre: limite de requisições ao renovar o token (429)');
  if (res.status >= 500) throw new SourceError('HTTP', `Mercado Livre: erro ${res.status} ao renovar o token`);
  if (res.status !== 200 || !j.access_token) {
    // 400 invalid_grant = refresh_token usado/expirado/revogado; invalid_client = id/secret errados.
    const why = [j.error, j.message || j.error_description].filter(Boolean).join(': ') || `HTTP ${res.status}`;
    throw new SourceError('NO_CREDENTIALS',
      `Mercado Livre recusou a renovação do token (${why}). Refaça a autorização do app e atualize ML_REFRESH_TOKEN.`);
  }
  const ttl = num(j.expires_in) || 21600;
  const state = {
    access_token: j.access_token,
    // Se a resposta não trouxer refresh_token novo, mantém o atual.
    refresh_token: j.refresh_token || refreshToken,
    expires_at: Date.now() + ttl * 1000,
    obtained_at: new Date().toISOString(),
    client_id: creds.id,
    seed: fingerprint(creds.seed),
    user_id: j.user_id ?? null,
  };
  try {
    saveState(state);
  } catch (e) {
    // Sem gravar o refresh_token rotacionado a próxima execução falha: melhor avisar já.
    throw new SourceError('HTTP', `Mercado Livre: token renovado mas não foi possível gravar ${tokenFile()}: ${e.message}`);
  }
  return state.access_token;
}

/** Devolve um access_token válido. `force` ignora o cache (usado depois de um 401). */
async function getAccessToken({ force = false } = {}) {
  const creds = refreshCreds();
  const direct = (process.env.ML_ACCESS_TOKEN || '').trim();
  if (!creds) {
    if (direct) return { token: direct, renewable: false };
    throw new SourceError('NO_CREDENTIALS',
      'Defina ML_CLIENT_ID + ML_CLIENT_SECRET + ML_REFRESH_TOKEN (ou ML_ACCESS_TOKEN) — app em developers.mercadolivre.com.br');
  }
  if (!force) {
    const st = loadState(creds);
    if (st && st.access_token && st.expires_at - EXPIRY_MARGIN_MS > Date.now()) return { token: st.access_token, renewable: true };
  }
  if (!refreshing) refreshing = doRefresh(creds).finally(() => { refreshing = null; });
  try {
    return { token: await refreshing, renewable: true };
  } catch (e) {
    // Renovação recusada: se houver ML_ACCESS_TOKEN manual, tenta com ele antes de desistir.
    if (e.code === 'NO_CREDENTIALS' && direct && !force) return { token: direct, renewable: false };
    throw e;
  }
}

// ---------------------------------------------------------------- chamadas

function apiError(res, what) {
  const j = res.json || {};
  const detail = [j.code || j.error, j.message].filter(Boolean).join(': ');
  const suffix = detail ? ` — ${detail}` : '';
  if (res.status === 403) return new SourceError('BLOCKED', `API do Mercado Livre recusou ${what} (403)${suffix}`);
  if (res.status === 429) return new SourceError('HTTP', `Mercado Livre: limite de requisições em ${what} (429)`);
  return new SourceError('HTTP', `Mercado Livre HTTP ${res.status} em ${what}${suffix}`);
}

/** GET autenticado: renova o token uma vez em 401 e espera/repete uma vez em 429. */
async function apiGet(pathAndQuery) {
  let auth = await getAccessToken();
  let retried429 = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await http(`${config.api}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${auth.token}`, Accept: 'application/json' },
    });
    if (res.status === 401) {
      if (auth.renewable && !auth.forced) {
        auth = { ...(await getAccessToken({ force: true })), forced: true };
        continue;
      }
      throw new SourceError('NO_CREDENTIALS', auth.renewable
        ? 'Mercado Livre recusou o token recém-renovado (401): confira o app e as permissões'
        : 'ML_ACCESS_TOKEN inválido ou expirado (dura 6h): configure ML_CLIENT_ID/ML_CLIENT_SECRET/ML_REFRESH_TOKEN para renovar sozinho');
    }
    if (res.status === 429 && !retried429) {
      retried429 = true;
      await sleep(config.retryDelayMs);
      continue;
    }
    return res;
  }
  throw new SourceError('HTTP', 'Mercado Livre: tentativas esgotadas');
}

async function searchItems(query, limit) {
  const res = await apiGet(`/sites/${SITE}/search?q=${encodeURIComponent(query)}&limit=${limit}&offset=0`);
  if (res.status !== 200 || !res.json) throw apiError(res, '/sites/MLB/search');
  const results = Array.isArray(res.json.results) ? res.json.results : [];
  return results.map(normalize).filter(Boolean);
}

async function searchCatalog(query, limit) {
  const res = await apiGet(`/products/search?status=active&site_id=${SITE}&q=${encodeURIComponent(query)}&limit=${limit}&offset=0`);
  if (res.status !== 200 || !res.json) throw apiError(res, '/products/search');
  const ids = (Array.isArray(res.json.results) ? res.json.results : []).map((r) => r && r.id).filter(Boolean).slice(0, limit);
  const out = [];
  for (const id of ids) {
    const d = await apiGet(`/products/${encodeURIComponent(id)}`);
    if (d.status === 404) continue;
    if (d.status !== 200 || !d.json) {
      if (out.length) break; // devolve o que já conseguiu
      throw apiError(d, '/products/{id}');
    }
    const p = normalizeCatalog(d.json);
    if (p) out.push(p);
  }
  return out;
}

async function search({ query, limit = 12 }) {
  const n = Math.max(1, Math.min(parseInt(limit, 10) || 12, MAX_LIMIT));
  const mode = (process.env.ML_SEARCH_MODE || 'auto').trim().toLowerCase();
  if (mode === 'catalog') return (await searchCatalog(query, n)).slice(0, n);
  try {
    return (await searchItems(query, n)).slice(0, n);
  } catch (e) {
    if (mode !== 'auto' || e.code !== 'BLOCKED') throw e;
    try {
      return (await searchCatalog(query, n)).slice(0, n);
    } catch (e2) {
      if (e2.code === 'BLOCKED')
        throw new SourceError('BLOCKED', `${e.message}; /products/search também recusou. O app precisa de permissão de leitura de catálogo/busca.`);
      throw e2;
    }
  }
}

module.exports = {
  id: 'mercadolivre',
  label: 'Mercado Livre',
  search,
  normalize,
  normalizeCatalog,
  getAccessToken,
  _config: config,
};
