# Radar — plano de negócio e próximos passos

Escrito em 09/11/2026, com base no que o protótipo mediu de verdade neste dia.
Valores de comissão e regras dos programas mudam com frequência: os números abaixo são
ordem de grandeza para você raciocinar, e cada um deve ser conferido no painel do programa
antes de virar premissa.

## 1. A conclusão primeiro

A ideia é viável, mas o desenho "robô raspa os sites → link de afiliado → lucro diário" tem
dois furos que precisam ser fechados antes de investir tempo em qualquer outra coisa:

1. **A coleta não pode depender de scraping.** Testei hoje: Mercado Livre, Magalu e Shopee
   bloqueiam robôs (verificação de conta, 403 e login obrigatório). Só a Amazon entregou
   páginas, e os termos do programa de Associados dela proíbem justamente exibir preço obtido
   fora da API oficial — o que pode custar a conta de afiliado, que é o ativo do negócio.
   O caminho sustentável são as **APIs e feeds oficiais de afiliado**, que entregam produto,
   preço e o link comissionado prontos. O protótipo já está estruturado assim: cada loja é um
   adaptador, e trocar a origem não muda o resto.
2. **O site sozinho não gera receita; tráfego gera.** Uma vitrine atualizada todo dia vale
   zero sem visitantes. O trabalho de verdade — e onde está a diferença entre R$ 0 e uma renda
   relevante — é distribuição. O robô resolve o custo de operar, não a demanda.

Com essas duas correções, o modelo que recomendo é: **curadoria de nicho + canais próprios de
distribuição + histórico de preço como diferencial**, monetizado por afiliação.

## 2. A conta que decide tudo

```
receita/dia = visitas × (% que clica para a loja) × (% que compra) × ticket médio × comissão
```

Cenário ilustrativo (premissas, não medições):

| Visitas/dia | Clique p/ loja | Conversão | Ticket | Comissão | Receita/dia | Receita/mês |
|---:|---:|---:|---:|---:|---:|---:|
| 300 | 35% | 3% | R$ 110 | 8% | ~R$ 28 | ~R$ 830 |
| 2.000 | 35% | 3% | R$ 110 | 8% | ~R$ 185 | ~R$ 5.500 |
| 10.000 | 35% | 3% | R$ 110 | 8% | ~R$ 925 | ~R$ 27.700 |

O que isso mostra: comissão e ticket você quase não controla; **visitas e taxa de clique**
sim. Por isso as fases abaixo são organizadas em torno de tráfego. O servidor do protótipo já
registra cada clique (`/go/<id>` → `data/clicks.jsonl`), então a taxa de clique real você mede
desde o primeiro dia.

## 3. Fontes de produto: o que cadastrar

| Loja | Como obter produtos e link | O que você precisa fazer | Estado no protótipo |
|---|---|---|---|
| **Amazon** | API de afiliados (PA-API / Creators API — confirme qual está vigente). Link: `?tag=seutag-20` | Cadastro no Amazon Associados. O acesso à API costuma exigir vendas qualificadas primeiro; a conta é encerrada se não houver vendas no prazo inicial | Coleta real funcionando por navegador; **usar só para validar o protótipo**, trocar pela API antes de divulgar |
| **Shopee** | Affiliate Open API (GraphQL): devolve oferta, % de comissão e `offerLink` pronto | Cadastro no Shopee Afiliados e pedido de acesso à Open API (appId + secret) | Adaptador escrito, sem credencial para validar |
| **Mercado Livre** | API oficial com OAuth; link gerado pelo programa de afiliados | App em developers.mercadolivre.com.br + cadastro no programa de Afiliados; confirmar no painel o formato do link | Adaptador escrito, sem credencial para validar |
| **Magalu** | Sem API pública de catálogo. Opções: vitrine Parceiro Magalu (Magazine Você) ou feed via rede de afiliados | Cadastro no Parceiro Magalu e/ou em rede de afiliados que represente o Magalu | Adaptador de página escrito; bloqueado a partir de datacenter |
| **Redes de afiliados** (Awin, Lomadee, Rakuten etc.) | Feed de produtos (CSV/XML) de dezenas de lojas, com deep link | Cadastro na rede e aprovação loja a loja | Não implementado — **recomendo como prioridade para Beleza** |

Por que as redes importam: em beleza, as lojas especializadas (perfumarias, marcas próprias,
farmácias) costumam pagar comissão maior que marketplace e têm ticket mais alto. Seu layout de
Beleza já previa "Sephora, Natura, Beleza na Web" no rodapé — essas vêm por rede de afiliados,
não por scraping.

## 4. De onde vem o tráfego (em ordem de retorno esperado)

1. **Canais de oferta (WhatsApp / Telegram / Instagram).** No Brasil, é assim que site de
   promoção cresce. A mesma coleta diária pode publicar automaticamente as 5–10 melhores
   ofertas do dia em um canal por nicho. Custo quase zero, efeito imediato, e o público é seu
   (não depende de algoritmo). É a próxima coisa que eu construiria.
2. **Histórico de preço como produto.** O protótipo já guarda o preço de cada item por dia
   (`data/history.json`). Em 2–4 semanas dá para exibir "menor preço em 30 dias" e marcar
   desconto falso. Isso é o que diferencia um radar de uma lista de links, gera confiança e
   conteúdo compartilhável — especialmente em Black Friday.
3. **Alertas de preço e lista do bebê.** Seus layouts já sugerem "+ Alertas" e "Lista". Alerta
   por e-mail/push traz a pessoa de volta no momento de compra; lista de enxoval é um ímã
   natural para grávidas (um público com 9 meses de compras previsíveis). Ambos constroem base
   própria de contatos.
4. **SEO de conteúdo, não de vitrine.** Página que só lista produtos de afiliado tende a ser
   tratada pelo Google como conteúdo raso. O que ranqueia são páginas úteis: "melhor fralda
   custo-benefício por tamanho", "preço por unidade de fralda hoje", comparativos. O dado da
   coleta alimenta essas páginas; o texto precisa de curadoria humana. Retorno em meses.
5. **Pinterest e vídeo curto.** Bebê e beleza são nichos visuais; funciona, mas exige produção
   constante. Deixe para depois de validar os itens 1–3.

Tráfego pago só depois de medir receita por clique: com comissão de um dígito, anúncio
raramente fecha a conta para afiliado iniciante.

## 5. Roteiro

**Black Friday é em 27/11/2026 — daqui a 18 dias.** É a semana de maior conversão do ano e
serve como teste real barato. O roteiro abaixo prioriza chegar lá com o mínimo no ar.

### Fase 0 — esta semana: destravar as contas
- Cadastrar-se em Amazon Associados, Shopee Afiliados (+ Open API), Mercado Livre Afiliados
  (+ app de desenvolvedor) e Parceiro Magalu. A aprovação leva dias; comece hoje.
- Registrar domínio e subir o site em um servidor simples (VPS de entrada resolve).
- Preencher `.env` conforme as credenciais chegam; cada fonte liga sozinha.
- **Critério de saída:** ao menos 2 lojas com link comissionado real e cliques sendo registrados.

### Fase 1 — até a Black Friday: primeiro canal
- Automação de postagem diária em canal de Telegram/WhatsApp por nicho.
- Escolher **um** nicho para começar (ver seção 6) e divulgar o canal em grupos e perfis do tema.
- Página "sobre / como ganhamos dinheiro" e aviso de afiliado (o protótipo já inclui no rodapé).
- **Critério de saída:** primeiras vendas comissionadas; medir clique→venda e receita por clique.

### Fase 2 — dezembro a fevereiro: diferencial e retenção
- Trocar a coleta da Amazon pela API oficial.
- Exibir histórico de preço e selo "menor preço em 30 dias"; alertas de preço por e-mail.
- Integrar uma rede de afiliados e 3–5 lojas especializadas.
- 10–20 páginas de conteúdo com curadoria.
- **Critério de saída:** receita mensal cobrindo custos com folga e crescimento de base própria
  (inscritos em canal/alertas) mês a mês.

### Fase 3 — escalar o que funcionou
- Novos nichos reaproveitando o motor (cada nicho é um bloco em `config/niches.json` + um tema).
- Só então: lista do bebê, app/PWA, negociação de comissão direta com marcas, espaço patrocinado.

## 6. Qual nicho primeiro

| | Radar Bebê | Radar Beleza |
|---|---|---|
| Recorrência | Alta (fralda, lenço, fórmula todo mês) | Média |
| Ticket | Baixo a médio; alto em passeio | Médio a alto (perfumaria) |
| Comissão típica | Menor em itens de mercado | Maior, sobretudo em lojas especializadas |
| Público | Muito engajado em grupos de mães; janela de ~3 anos | Amplo e permanente; muito concorrido |
| Diferencial possível | Preço por unidade de fralda, lista de enxoval | Histórico de preço de perfume |

Minha recomendação: **começar pelo Bebê**. A compra é recorrente e sensível a preço, o público
se organiza em grupos (distribuição barata) e "preço por fralda" é um diferencial claro que
quase ninguém entrega bem. Beleza entra na fase 2, junto com as redes de afiliados, que é onde
ela paga melhor.

## 7. Riscos e cuidados

- **Termos dos programas.** Exibir preço desatualizado ou obtido fora da API, omitir que o link
  é de afiliado ou usar marca da loja de forma indevida pode encerrar a conta. Leia as regras
  de cada programa; trate a conta de afiliado como o ativo principal.
- **Transparência.** Publicidade precisa ser identificável (CDC e CONAR): mantenha o aviso de
  afiliado visível no site e nas postagens de canal.
- **Preço errado.** Durante os testes o robô chegou a ler "preço por litro" como preço original
  e exibiu 75% de desconto falso; foi corrigido e há uma trava para descontos implausíveis.
  Serve de aviso: oferta falsa destrói confiança e pode gerar reclamação. O status da coleta
  (`/status.html`) e os testes automatizados existem por isso.
- **Dependência de terceiros.** Comissão e regras mudam sem aviso. Diversificar lojas e ter
  base própria (canal, e-mail) reduz o risco.
- **LGPD.** Ao coletar e-mail para alertas ou usar analytics com cookies, é preciso política de
  privacidade e consentimento.
- **Fiscal.** Comissões são renda tributável; vale abrir MEI/CNPJ cedo e confirmar com um
  contador a atividade adequada. Alguns programas pagam melhor ou só pagam para PJ.

## 8. Custos de operação (ordem de grandeza)

Domínio (~R$ 40/ano), servidor pequeno (~R$ 30–60/mês), e-mail transacional (gratuito no
início). A coleta por API não exige navegador nem proxy, então o custo não cresce com o número
de produtos. O investimento real é o seu tempo em distribuição e curadoria.

## 9. O que eu faria amanhã, em ordem

1. Abrir os quatro cadastros de afiliado.
2. Subir o protótipo em um domínio com `AMAZON_TAG` preenchido.
3. Pedir a automação de postagem no Telegram a partir de `data/products/*.json`.
4. Criar o canal do Radar Bebê e divulgá-lo antes da Black Friday.
5. Depois da Black Friday, olhar `data/clicks.jsonl` e os relatórios dos programas e decidir
   a fase 2 com números reais.
