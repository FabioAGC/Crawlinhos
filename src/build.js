#!/usr/bin/env node
/**
 * Gera o site estático em dist/ a partir de data/products/*.json.
 * HTML já sai com os produtos (bom para SEO e para hospedar em qualquer CDN).
 *
 * LINK_MODE=redirect (padrão): links passam por /go/<id> (conta cliques; exige src/server.js)
 * LINK_MODE=direct: link de afiliado direto no HTML (hospedagem 100% estática)
 */
const fs = require('fs');
const path = require('path');
const { ROOT, loadEnv, readJSON, writeJSON, esc } = require('./util');

loadEnv();

const THEMES = { acon: require('./themes/acon'), apot: require('./themes/apot') };
const SORTS = [
  { id: 'destaque', label: 'Destaque' },
  { id: 'desconto', label: 'Maior desconto' },
  { id: 'menor_preco', label: 'Menor preço' },
  { id: 'maior_preco', label: 'Maior preço' },
  { id: 'popularidade', label: 'Popularidade' },
  { id: 'recentes', label: 'Recentes' },
];
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const DISCLOSURE =
  'Este site participa de programas de afiliados (Amazon Associados, Mercado Livre, Shopee e Magalu): podemos receber comissão pelas compras feitas a partir dos nossos links, sem custo adicional para você. Como participante do Programa de Associados da Amazon, somos remunerados pelas compras qualificadas efetuadas.';

function jsonLd(niche, products, baseUrl) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${niche.title} — ofertas do dia`,
    itemListElement: products.slice(0, 30).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.title,
        image: p.image || undefined,
        offers: { '@type': 'Offer', price: p.price.toFixed(2), priceCurrency: 'BRL', availability: 'https://schema.org/InStock', url: p.url },
      },
    })),
  }).replace(/</g, '\\u003c');
}

function buildNiche(nicheId, niche, opts) {
  const data = readJSON(path.join(ROOT, `data/products/${nicheId}.json`), null);
  if (!data) {
    console.warn(`[build] sem dados para ${nicheId} — rode "npm run crawl" antes`);
    return null;
  }
  const theme = THEMES[niche.theme];
  const products = data.products;
  const cats = [{ id: 'all', label: 'Tudo' }, ...niche.categories.filter((c) => products.some((p) => p.cat === c.id))];
  const catLabel = (id) => niche.categories.find((c) => c.id === id)?.label || id;
  const gen = new Date(data.generatedAt);
  const stores = [...new Set(products.map((p) => p.store))];
  const meta = {
    edition: `${String(gen.getUTCDate()).padStart(2, '0')} ${MONTHS[gen.getUTCMonth()]} ${gen.getUTCFullYear()}`,
    updatedLabel: `em ${gen.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`,
    year: gen.getUTCFullYear(),
    stores,
    storeCount: stores.length,
    disclosure: DISCLOSURE,
  };
  const h = {
    catLabel,
    href: (p) => (opts.linkMode === 'direct' ? p.affiliateUrl : `/go/${encodeURIComponent(p.id)}`),
    linkAttrs: 'target="_blank" rel="sponsored nofollow noopener"',
    dataAttrs: (p) =>
      `data-id="${esc(p.id)}" data-cat="${esc(p.cat)}" data-store="${esc(p.store)}" data-price="${p.price}" data-disc="${p.discount}" data-score="${p.score}" data-pop="${p.reviews || p.sold || 0}" data-first="${esc(p.firstSeen)}" data-title="${esc(p.title)}"`,
  };
  const css = fs.readFileSync(path.join(__dirname, `themes/${theme.id}.css`), 'utf8');
  const body = theme.render({ products, cats, sorts: SORTS, meta, h });
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(niche.title)} — ofertas do dia (${esc(meta.edition)})</title>
<meta name="description" content="${esc(theme.description)}">
<meta property="og:title" content="${esc(niche.title)} — ofertas do dia">
<meta property="og:description" content="${esc(theme.description)}">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${theme.fonts}&display=swap">
<style>${css}${theme.extraCss}</style>
<script type="application/ld+json">${jsonLd(niche, products)}</script>
</head>
<body>
${body}
<script src="../assets/app.js" defer></script>
</body>
</html>`;
  const out = path.join(ROOT, `dist/${nicheId}/index.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`[build] dist/${nicheId}/index.html — ${products.length} produtos, ${(html.length / 1024).toFixed(0)} KB`);
  return { nicheId, title: niche.title, total: products.length, generatedAt: data.generatedAt, description: theme.description };
}

function buildHub(built) {
  const cards = built
    .map((b) => `<a class="hub-card" href="./${b.nicheId}/"><h2>${esc(b.title)}</h2><p>${esc(b.description)}</p><span>${b.total} ofertas hoje →</span></a>`)
    .join('\n');
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Radar — ofertas do dia</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#FAF7F4;color:#2A1F2A;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 16px;box-sizing:border-box}
h1{font-weight:400;font-size:44px;margin:0 0 8px;letter-spacing:.04em}p.sub{color:#6b5f6b;margin:0 0 36px;text-align:center}
.hub{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;width:100%;max-width:760px}
.hub-card{background:#fff;border:1px solid rgba(42,31,42,.1);border-radius:6px;padding:26px;text-decoration:none;color:inherit;transition:transform .2s,box-shadow .2s}
.hub-card:hover{transform:translateY(-3px);box-shadow:0 18px 40px rgba(42,31,42,.08)}
.hub-card h2{margin:0 0 8px;font-weight:500;font-size:22px}.hub-card p{margin:0 0 18px;font-size:14px;line-height:1.55;color:#4F4350}.hub-card span{font-size:13px;font-weight:600;color:#8A6E94}
footer{margin-top:40px;font-size:12px;color:#9A8E9A}footer a{color:inherit}</style></head>
<body><h1>RADAR</h1><p class="sub">Ofertas reais, atualizadas todos os dias.</p><div class="hub">${cards}</div>
<footer><a href="./status.html">status da coleta</a></footer></body></html>`;
  fs.writeFileSync(path.join(ROOT, 'dist/index.html'), html);
}

function buildStatus() {
  const st = readJSON(path.join(ROOT, 'data/status.json'), null);
  if (!st) return;
  const color = { OK: '#2e7d32', PARTIAL: '#b26a00', NO_CREDENTIALS: '#b26a00', BLOCKED: '#c62828', EMPTY: '#c62828' };
  const rows = Object.entries(st.niches)
    .flatMap(([n, v]) =>
      Object.entries(v.sources).map(
        ([s, x]) =>
          `<tr><td>${esc(n)}</td><td>${esc(s)}</td><td style="color:${color[x.status] || '#c62828'};font-weight:600">${esc(x.status)}</td><td>${x.count}</td><td>${x.tagged ?? 0}</td><td>${esc(x.errors[0]?.message || '')}</td></tr>`
      )
    )
    .join('\n');
  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Status da coleta</title><style>body{font-family:system-ui,sans-serif;margin:32px 16px;color:#222}main{max-width:980px;margin:0 auto}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #e5e5e5}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#666}</style></head>
<body><main><h1>Status da coleta</h1><p>Última execução: ${esc(new Date(st.generatedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))} (Brasília)</p>
<div class="wrap"><table><tr><th>Nicho</th><th>Fonte</th><th>Status</th><th>Produtos</th><th>Com link de afiliado</th><th>Detalhe</th></tr>${rows}</table></div>
<p><a href="./">← voltar</a></p></main></body></html>`;
  fs.writeFileSync(path.join(ROOT, 'dist/status.html'), html);
}

function build() {
  const niches = readJSON(path.join(ROOT, 'config/niches.json'), {});
  const opts = { linkMode: process.env.LINK_MODE === 'direct' ? 'direct' : 'redirect' };
  fs.mkdirSync(path.join(ROOT, 'dist/assets'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'client.js'), path.join(ROOT, 'dist/assets/app.js'));
  const built = Object.entries(niches).map(([id, n]) => buildNiche(id, n, opts)).filter(Boolean);
  buildHub(built);
  buildStatus();
  // Mapa id -> link de afiliado, usado pelo redirecionador /go/<id>
  const links = {};
  for (const b of built)
    for (const p of readJSON(path.join(ROOT, `data/products/${b.nicheId}.json`), { products: [] }).products)
      links[p.id] = p.affiliateUrl;
  writeJSON(path.join(ROOT, 'data/links.json'), links);
  return built;
}

if (require.main === module) build();
module.exports = { build };
