# Radar — agregador diário de ofertas com link de afiliado

Dois sites (Radar Bebê e Radar Beleza) gerados todo dia a partir de uma coleta em
Amazon, Mercado Livre, Shopee e Magalu. Plano de negócio em [PLANO.md](PLANO.md).

## Rodar

```bash
npm install            # só precisa do playwright (fonte Amazon)
cp .env.example .env   # preencha as credenciais que tiver
npm run daily          # coleta + gera o site em dist/
npm run serve          # http://localhost:8080
npm test
```

Coleta automática todo dia: `TZ=America/Sao_Paulo node src/server.js --schedule 06:00`
(agendador embutido; usa a hora local do servidor, por isso o `TZ`), ou
`deploy/crontab.example`, ou `.github/workflows/daily.yml`.

Os testes do navegador precisam encontrar o Playwright: se ele estiver instalado globalmente,
rode `NODE_PATH=$(npm root -g) npm test`.

## Como funciona

```
config/niches.json     nichos, categorias e termos de busca
src/sources/*.js       um adaptador por loja  → search({query, limit}) devolve produtos normalizados
src/affiliate.js       monta o link de afiliado de cada loja
src/pipeline.js        coleta → normaliza → link → histórico de preço → data/products/<nicho>.json
src/build.js           gera dist/ (HTML estático, produtos já no HTML, JSON-LD)
src/themes/            os dois layouts (Aconchego e Apothecary)
src/server.js          serve dist/, /go/<id> (redireciona e conta cliques), /api/*, agendador
```

Uma fonte sem credencial ou bloqueada é pulada e aparece em `/status.html`; as outras seguem.
Se a coleta de um nicho vier vazia, a vitrine do dia anterior é mantida.

## Estado das fontes

| Fonte | Modo | Precisa de |
|---|---|---|
| Amazon | página de busca em navegador — funcionou em 09/11, bloqueada a partir de 10/11 a partir de datacenter; trocar pela API oficial | `AMAZON_TAG` para comissionar |
| Mercado Livre | API oficial, com renovação automática do token | `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REFRESH_TOKEN` + `ML_AFFILIATE_TEMPLATE` |
| Shopee | Affiliate Open API | `SHOPEE_APP_ID`, `SHOPEE_SECRET` |
| Magalu | página de busca (bloqueia IP de datacenter) | `MAGALU_STORE` para comissionar |

## Novo nicho

Adicione um bloco em `config/niches.json` (título, tema, categorias com buscas) e rode
`npm run daily`. Para um visual próprio, crie um tema em `src/themes/` seguindo `acon.js`.

## O que foi testado e o que não foi

- 106 testes automatizados (`npm test`): coleta, histórico, links de afiliado, servidor
  (redirecionador, path traversal, agendador) e o site no navegador (filtros, ordenação, busca,
  layout de 390 a 1440 px).
- Amazon: extração testada em HTML real da busca. Mercado Livre, Shopee e Magalu: testados só
  com respostas de exemplo escritas a partir da documentação (`test/fixtures/`, cada uma marcada);
  precisam ser conferidos com credenciais reais.
- `data/products/*.json` é a coleta real de 09/11/2026, anterior a algumas correções da Amazon
  (títulos de roupas, desconto Pix, idade); a próxima coleta já sai corrigida.
