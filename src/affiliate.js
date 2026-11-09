/**
 * Monta o link de afiliado de cada loja. `tagged: false` significa que a credencial
 * ainda não foi configurada (ou a URL do produto é inválida) e o link sai sem comissão
 * — isso aparece no status. Nenhuma função aqui lança: URL ruim devolve a URL original.
 */

/** Valor de variável de ambiente limpo: sem espaços, aspas em volta ou comentário "# ..." no fim. */
function envVal(v) {
  if (v == null) return '';
  let s = String(v).trim();
  const q = s.match(/^(["'])(.*)\1$/);
  if (q) return q[2].trim();
  s = s.replace(/\s+#.*$/, '').trim();
  return s;
}

/** URL http(s) válida -> objeto URL; senão null. */
function parseUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

const untagged = (p) => ({ url: p && typeof p.url === 'string' ? p.url : '', tagged: false });

/** Amazon Associados: ?tag=<tracking id>. Preserva a query existente e troca tag de terceiros. */
function amazon(p, env) {
  const tag = envVal(env.AMAZON_TAG);
  // "seutag-20" é o exemplo do .env.example, não uma tag real.
  if (!tag || tag === 'seutag-20' || !/^[A-Za-z0-9_-]+$/.test(tag)) return untagged(p);
  const u = parseUrl(p.url);
  if (!u || !/(^|\.)amazon\.com\.br$/i.test(u.hostname)) return untagged(p);
  u.searchParams.set('tag', tag);
  u.searchParams.set('linkCode', 'ogi');
  return { url: u.toString(), tagged: true };
}

/**
 * Mercado Livre: não há construtor público documentado, então o formato vem de um modelo
 * (ML_AFFILIATE_TEMPLATE) copiado de um link gerado no painel de afiliados.
 * {url} = URL do produto sem query/fragmento; {url_enc} = a mesma, url-encoded.
 */
function mercadolivre(p, env) {
  const tpl = envVal(env.ML_AFFILIATE_TEMPLATE);
  if (!tpl || /SEU_TOOL_ID/.test(tpl) || !/\{url(_enc)?\}/.test(tpl)) return untagged(p);
  const u = parseUrl(p.url);
  if (!u) return untagged(p);
  u.search = '';
  u.hash = '';
  const clean = u.toString();
  // Funções no replace: evita que "$&", "$1" etc. na URL sejam interpretados.
  const out = tpl.replace(/\{url_enc\}/g, () => encodeURIComponent(clean)).replace(/\{url\}/g, () => clean);
  return parseUrl(out) ? { url: out, tagged: true } : untagged(p);
}

/** Shopee: o offerLink devolvido pela Open API já é o link de afiliado. */
function shopee(p) {
  const u = parseUrl(p.affiliateUrl);
  return u ? { url: u.toString(), tagged: true } : untagged(p);
}

/** Magalu (Magazine Você): https://www.magazinevoce.com.br/magazine{LOJA}/{caminho do produto} */
function magalu(p, env) {
  // Aceita "minhaloja", "magazineminhaloja" ou a URL inteira da loja.
  let store = envVal(env.MAGALU_STORE)
    .replace(/^https?:\/\/(www\.)?magazinevoce\.com\.br\//i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/^magazine/i, '');
  if (!store || !/^[A-Za-z0-9_-]+$/.test(store)) return untagged(p);
  let path = typeof p.path === 'string' ? p.path : '';
  if (!path) {
    const u = parseUrl(p.url);
    if (u && /(^|\.)magazineluiza\.com\.br$/i.test(u.hostname)) path = u.pathname;
  }
  path = path.split('#')[0].split('?')[0].replace(/^\/+/, '');
  if (!path || /^https?:/i.test(path) || path.split('/').includes('..')) return untagged(p);
  return { url: `https://www.magazinevoce.com.br/magazine${store}/${encodeURI(decodeSafe(path))}`, tagged: true };
}

function decodeSafe(s) {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

const builders = { amazon, mercadolivre, shopee, magalu };

function affiliateLink(product, env = process.env) {
  const p = product || {};
  const b = Object.prototype.hasOwnProperty.call(builders, p.source) ? builders[p.source] : null;
  if (!b) return untagged(p);
  try {
    return b(p, env || {});
  } catch {
    return untagged(p);
  }
}

module.exports = { affiliateLink };
