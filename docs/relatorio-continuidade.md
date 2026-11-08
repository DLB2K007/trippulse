# Relatório de continuidade — TripPulse

> Atualizado em 2026-11-08, após os commits `29dca01` (métricas puras) e `8a85392` (endpoint de análise), com `main` **2 commits à frente de `origin/main`** (`54c1981`): o Dia 9 está commitado localmente e **ainda não publicado**. Cobre os **Dias 1 a 9**.
> Em 2026-11-08 o histórico foi reescrito para corrigir a autoria: todos os 14 commits agora são `DLB2K007 <danielbordini027@gmail.com>`. Os hashes citados neste relatório já são os novos; os antigos não existem mais na `main`.
> Documento de contexto oficial do projeto: **`docs/contexto.md`** (o usuário pode referir-se a ele por outros nomes, como "PROJECT_CONTEXT.md" — é sempre este arquivo).
> Versões anteriores deste relatório cobrem o estado até o Dia 5 (commit `9605f03`).

---

## 1. Resumo executivo

Em 9 dias incrementais, o TripPulse saiu de documento vazio para um **backend funcional ponta a ponta com suíte de testes**:

**Dia 1** — Repositório Git, Node.js com ES Modules, Fastify, variáveis de ambiente, `.gitignore`, README e `GET /health` (commit `66dc92f`).

**Dia 2** — PostgreSQL 17 em Docker (porta **5433**, por causa de um PostgreSQL nativo do Windows na 5432), Prisma ORM 7.10.1 com `prisma.config.ts` + driver adapter `@prisma/adapter-pg`, modelagem do `Trip` e primeira migration (`e926668`).

**Renomeação** — FareHunter AI → **TripPulse** em todo o doc, código, `/health` e README (`ab6cd3a`).

**Dia 3** — CRUD completo de viagens com separação rígida: formato validado no JSON Schema das rotas, regras de negócio no service (`a451867`).

**Dia 4** — Integração **simulada** de provedores de passagens: registro de provedores como "costura" para provedores reais, provedor simulado com dados brutos estilo API externa, normalizador para o padrão canônico e garantia de `SIMULATED` **imposta por construção** (`162258a`).

**Dia 5** — Persistência: models `FlightOffer` + `PriceHistory`, snapshot de preço a cada pesquisa, identidade por `externalKey` e histórico com tendências (`FIRST_OBSERVATION` / `DROPPED` / `ROSE` / `UNCHANGED`) e `best` (`9605f03`).

**Dia 6** — Suíte de testes automatizados construída com `node --test` + `app.inject()` — e os testes **encontraram um bug real** (`Invalid Date` em ~1/3 das ofertas do simulador), corrigido com teste de regressão (`e90a3d9`).

**Dia 7** — `prisma generate` automatizado (`postinstall` + cadeia no `db:migrate`, matando o único débito operacional recorrente) e endpoint consolidado de histórico por viagem `GET /trips/:tripId/offers/history` (`c525ac9`).

**Dia 8** — Integração contínua no GitHub Actions: workflow `.github/workflows/ci.yml` que roda os 24 testes a cada push na `main` e em pull requests, com PostgreSQL 17 efêmero como serviço, migrations aplicadas por `npm run db:deploy` e falha de teste derrubando o job (commit `f5555e6`; primeira execução verde: run `42419066310`, anterior à reescrita de autoria). Depois da reescrita, o commit `54c1981` foi validado pela run `42517712825` (verde). O mesmo commit corrigiu o fechamento documental: hash e contagem de testes, ressalva sobre branch protection e próximos passos de publicação. O ajuste final do workflow (script `db:deploy`) está em `54c1981`.

**Dia 9** — Análise de preços, em duas etapas commitadas localmente (`29dca01` e `8a85392`) e ainda **não publicadas**:

- **Passo 1 (aprovado)**: núcleo puro `modules/analysis/price-metrics.js` — séries de preço viram centavos inteiros, mediana calculada **apenas com observações anteriores**, mínimo de 3 anteriores (4 no total) para classificar, e classificação descritiva `INSUFFICIENT_DATA` / `OPPORTUNITY` / `FAIR` / `ABOVE_HISTORY`, independente de `trend` (`DROPPED` ≠ `OPPORTUNITY`). 33 testes unitários, sem banco (o último cobre histórico suficiente sem observação atual). Inclui teto de centavos seguros, escala decimal para meio centavo e média por decomposição inteira (verificada contra oráculo `BigInt`).
- **Passo 2**: `analysis.service.js` compõe o núcleo puro com os services existentes (`getTripById` + `listOfferHistoryForTrip`) e `analysis.routes.js` expõe `GET /trips/:tripId/analysis`, estritamente de leitura. 7 testes de integração com fixtures determinísticas.

---

## 2. Visão geral e estado por funcionalidade

| Funcionalidade (contexto `docs/contexto.md`) | Estado |
|---|---|
| Servidor Node.js + API REST (Fastify) | ✅ Implementado e testado (Dia 1) |
| Conexão ao PostgreSQL (Docker + Prisma 7) | ✅ Implementado e testado (Dia 2) |
| Cadastro e consulta de viagens (CRUD) | ✅ Implementado e testado (Dia 3) |
| Pesquisa **simulada** de ofertas de voos | ✅ Implementado e testado (Dia 4) |
| Persistência de ofertas + histórico de preços | ✅ Implementado e testado (Dias 5 e 7) |
| Documentação e **testes automatizados** dos fluxos | ✅ Implementado e testado (Dia 6) |
| CI no GitHub Actions (testes em push/PR) | ✅ Implementado (Dia 8) |
| Análise de preços por viagem (descritiva do histórico) | ✅ Implementado e testado (Dia 9; commits `29dca01` e `8a85392`, não publicados) |
| Integração **real** com provedores | ❌ Não iniciado (bloqueado por decisão de escopo do MVP) |
| Agente de IA / recomendações | ❌ Não iniciado |
| Monitoramento programado, notificações | ❌ Não iniciado |
| Hotéis, veículos, atividades; publicação | ❌ Não iniciado |

---

## 3. Arquitetura

### Stack e versões

- **JavaScript puro com ES Modules** (`"type": "module"`), Node.js v24 (mínimo `>=20.6.0` pelo `--env-file` nativo)
- **fastify** `^5.12.8` · **prisma** e **@prisma/client** `^7.10.1` (fixados deliberadamente — `latest` = `8.0.0-rc`) · **@prisma/adapter-pg** `^7.10.1` (driver adapter obrigatório no Prisma 7) · **dotenv** `^18.0.9`
- **PostgreSQL 17** (`postgres:17-alpine`) em Docker — Docker 29.9.2, Compose v5.6.1
- **Testes**: `node --test` nativo + `app.inject()` (zero dependências de teste)
- **GitHub**: `https://github.com/DLB2K007/trippulse.git`, branch `main`

### Estrutura de diretórios e responsabilidade de cada módulo

```text
trippulse/
├── apps/api/src/
│   ├── config/
│   │   ├── env.js            # carrega/valida PORT e HOST (defaults)
│   │   └── prisma.js         # instância única de PrismaClient (adapter-pg)
│   ├── modules/
│   │   ├── trips/            # CRUD de viagens
│   │   ├── flights/          # orquestra pesquisa → normalização → snapshot
│   │   ├── offers/           # domínio de ofertas: identidade, snapshot, histórico
│   │   └── analysis/         # price-metrics.js (puro) + service/rota de análise
│   ├── integrations/
│   │   └── flight-providers/
│   │       ├── index.js      # registro de provedores (único ponto de extensão)
│   │       ├── normalize.js  # bruto → padrão canônico + garantia SIMULATED
│   │       └── simulated/    # provedor externo simulado
│   ├── shared/
│   │   ├── errors.js         # HttpError(statusCode, message)
│   │   └── uuid.js           # isUuid()
│   ├── app.js                # monta Fastify + /health + plugins no prefixo /trips
│   └── server.js             # bootstrap
├── docs/ (contexto.md, relatorio-continuidade.md)
├── prisma/ (schema.prisma + 2 migrations)
├── prisma.config.ts          # conexão do CLI (tolerante a .env ausente)
├── tests/ (7 arquivos, 64 testes)
├── docker-compose.yml · .env.example · README.md · package.json
```

### Endpoints (todos validados por testes)

| Método | Rota | Sucesso | Responsável |
|---|---|---|---|
| `GET` | `/health` | 200 | app.js |
| `POST` / `GET` | `/trips`, `/trips/:id` | 201/200/400/404 | trips.routes |
| `PUT` / `DELETE` | `/trips/:id` | 200/400/404 · 204 | trips.routes |
| `GET` | `/trips/:tripId/flights` | 200/404 | flights.routes (escreve snapshot) |
| `GET` | `/trips/:tripId/offers/history` | 200/400/404 | offers.routes (só leitura) |
| `GET` | `/trips/:tripId/analysis` | 200/400/404 | analysis.routes (só leitura) |

### Fluxo principal

```
GET /trips/:tripId/flights
  → trips.service? não: flights.service busca Trip (404 se ausente)
  → query = { destination, departureDate, returnDate } + variationSeed
  → registro de provedores → simulated-airways.search() → ofertas BRUTAS
  → normalizeFlightOffer() → ofertas CANÔNICAS (SIMULATED obrigatória)
  → modules/offers.persistOfferSnapshot()
      find-or-create FlightOffer por (tripId, externalKey)
      + 1 linha PriceHistory (total/base/taxes/observedAt)
      + tendência vs. observação anterior real
  → resposta com history por oferta

GET /trips/:tripId/offers/history
  → leitura EXCLUSIVA do banco: série completa + current/previous/best/trend

GET /trips/:tripId/analysis
  → trips.getTripById (400/404) + offers.listOfferHistoryForTrip (leitura)
  → analyzePriceSeries por oferta (núcleo puro, sem I/O)
  → resumo + qualidade dos dados + explicação por oferta + limitações
  → nenhuma escrita, nenhum carimbo de tempo: mesma resposta para o mesmo estado
```

**Padrão canônico de oferta** (definido em `normalize.js`): `{ provider, isSimulated, dataClassification, type, route, dates, flight, price, relatedQuery }` + `history: { observedAt, current, previous, best, trend }`.

---

## 4. Banco de dados

```text
trips (Trip)
  id uuid pk · name · destination · start_date date · end_date date · created_at · updated_at
  └─< flight_offers (FlightOffer) [trip_id FK, CASCADE]  @@unique(trip_id, external_key)
        id · trip_id · provider · data_classification · type · origin · destination ·
        departure_date · arrival_date · airline · flight_number · stops · cabin_class ·
        baggage_pieces · refundable · external_key · created_at · updated_at
        └─< price_history (PriceHistory) [offer_id FK, CASCADE] @@index(offer_id, observed_at)
              id · offer_id · currency · total · base · taxes · observed_at
```

**Migrations aplicadas**: `20261107211054_init_create_trips` (trips) e `20261107214055_add_flight_offers_and_price_history` (flight_offers, price_history, FKs, índices).

**Ambiente local**: container `trippulse-db` (postgres:17-alpine, healthcheck, volume nomeado). Porta **5433 no host** → 5432 no container. `DATABASE_URL=postgresql://trippulse:trippulse@localhost:5433/trippulse?schema=public`.

---

## 5. Implementações por dia (arquivos modificados/criados)

| Dia (commit) | Principais arquivos |
|---|---|
| 1 (`66dc92f`) | `package.json`, `apps/api/src/{app,server}.js`, `config/env.js`, `.gitignore`, `.env.example`, README |
| 2 (`e926668`) | `docker-compose.yml`, `prisma/schema.prisma`, `prisma.config.ts`, `config/prisma.js`, migration init, `.env`/`.env.example` (DATABASE_URL) |
| ren (`ab6cd3a`) | renomeação FareHunter→TripPulse em `app.js`, `package.json`, README, doc, `.env.example` |
| 3 (`a451867`) | `modules/trips/{trips.service,trips.routes}.js`, `shared/errors.js`, `app.js` (registro) |
| 4 (`162258a`) | `integrations/flight-providers/{index,normalize,simulated/simulated-flight-provider}.js`, `modules/flights/{flights.service,flights.routes}.js`, `app.js` |
| 5 (`9605f03`) | `schema.prisma` (+2 models), migration 2, `modules/offers/offers.service.js`, provider (variationSeed), `flights.service.js` |
| 6 (`e90a3d9`) | `tests/{api,normalize,offers-service,simulated-provider}.test.js`, **correção de bug em** `simulated-flight-provider.js` (`depart_at` com `padStart(2,'0')`), script `test` no `package.json` |
| 7 (`c525ac9`) | `modules/offers/{offers.routes,offers.service}.js` (endpoint history), `shared/uuid.js`, `prisma.config.ts` (tolerante), `package.json` (`postinstall`, `db:migrate` encadeado), `tests/offers-history.test.js`, refactor mínimo em `trips.service.js` |
| 8 (`f5555e6` → `54c1981`) | `.github/workflows/ci.yml` (novo): push na `main` + PRs → `npm ci` → `npm run db:deploy` → `npm test` com serviço `postgres:17-alpine` efêmero; README (badge, seção CI, próximos passos de publicação); este relatório |
| 9 (`29dca01`, `8a85392` — locais) | `modules/analysis/{price-metrics,analysis.service,analysis.routes}.js` (novos), `app.js` (registro da rota), `tests/{price-metrics,analysis-endpoint}.test.js` (novos), README (endpoint e contrato), este relatório. **Sem migration e sem dependência nova.** |

**Scripts npm atuais**: `start` · `dev` (`--watch`) · `start:no-env` · `db:migrate` (`migrate dev && generate`) · `db:deploy` (= `prisma migrate deploy`, também usado no CI) · `postinstall` (`prisma generate`) · `test` (`node --env-file=.env --test --test-force-exit`).

---

## 6. Testes

**64/64 passando** (execução ~1,4s), bucket atual revalidado em 2026-11-08 sobre o estado commitado (24 anteriores + 40 do Dia 9):

| Arquivo | Testes | O que protege |
|---|---|---|
| `tests/api.test.js` | 12 | `/health`; CRUD completo (201/400 schema/400 domínio/404/204); UUID inválido → 400; pesquisa persiste snapshot com `SIMULATED`; 2ª pesquisa compara com a anterior e dedupe de ofertas; cascade de exclusão |
| `tests/normalize.test.js` | 3 | padrão canônico completo; barreira anti-`REAL`; rejeição de oferta incompleta |
| `tests/simulated-provider.test.js` | 3 | 3–5 ofertas; **datas ISO válidas (regressão do bug T010)**; identidade estável × preço variável por semente |
| `tests/offers-service.test.js` | 2 | `externalKey`; snapshot: `FIRST_OBSERVATION` → `UNCHANGED`, dedupe, `best` |
| `tests/offers-history.test.js` | 4 | endpoint de histórico: 404/400; vazio pré-pesquisa; consolidação após 2 pesquisas; cascade |
| `tests/price-metrics.test.js` | 33 | núcleo puro: limiares (10%/-10 e 9,99%), mediana sem o preço atual, `DROPPED`≠`OPPORTUNITY`, `ROSE`≠`ABOVE_HISTORY`, moeda mista, observações inválidas, ordenação/imutabilidade, centavos e meio centavo, teto de inteiro seguro, média de somas grandes, validação de `options`, empates de `observedAt` |
| `tests/analysis-endpoint.test.js` | 7 | endpoint de análise com **fixtures determinísticas**: 400/404 e rejeição de querystring; viagem sem ofertas; histórico insuficiente (inclui oferta sem histórico e observação inválida); as três classificações; identificação de dados simulados × reais; moeda mista; repetibilidade + ausência de escrita + contrato de `/offers/history` preservado |

Histórico dos testes manuais (Dias 1–5) está documentado como superseded pela suíte. Falhas encontradas durante o desenvolvimento foram todas corrigidas e viraram regressões quando aplicável.

---

## 7. Decisões técnicas (resumo — detalhes em decisões anteriores)

1. **Prisma 7.10.1 estável** (8.x = RC) com `prisma.config.ts` + `@prisma/adapter-pg` — exigências da v7 ("Rust-free", URL fora do schema)
2. **Generator `prisma-client-js`** (deprecado) em vez do padrão v7 (`prisma-client`) — o novo emite **TypeScript**, incompatível com o projeto JS puro sem pipeline de build
3. **Porta 5433 do host** — o Windows já tem PostgreSQL nativo na 5432
4. **Validação de forma no JSON Schema do Fastify; regras de negócio nos services; zero consultas ao banco em rotas**
5. **`HttpError` próprio** em vez de `@fastify/sensible` (o Fastify já honra `err.statusCode`)
6. **Registro de provedores** como único ponto de extensão; `SIMULATED` classificada pelo registro (não pelos dados do provedor) + **barreira anti-`REAL`** no normalizador
7. **Identidade de oferta por `externalKey`** (provedor|rota|companhia|voo|partida) — permite preço variável ($variationSeed) com identidade estável, viabilizando tendências reais
8. **Archivo do histórico escreve+compara (`/flights`) sempre a partir de observações reais**; o endpoint novo (`/offers/history`) é leitura pura
9. **Núcleo de análise puro** (`price-metrics.js`): sem Prisma, sem relógio, sem I/O — testável com fixtures e sem `DATABASE_URL`. O `buildTrend` foi replicado de `offers.service` de propósito; importar o service traria o Prisma para o módulo puro
10. **Dinheiro em centavos inteiros** e um único ponto de arredondamento na saída; a classificação compara o percentual **já arredondado** a 2 casas, para o consumidor conferir na mão. Mediana de referência usa **só observações anteriores**, mínimo de 3 anteriores, e `trend` é independente de `classification`
11. **Análise é composição, não reimplementação**: `analysis.service` chama `getTripById` (400/404) e `listOfferHistoryForTrip` (série completa) e passa cada série pelo núcleo puro. Nenhuma consulta SQL nova, nenhuma escrita, nenhum `generatedAt` — a resposta é repetível e o teste compara duas chamadas. `dataQuality` conta `SIMULATED`, `REAL` e desconhecidas de forma **estrita pelo valor armazenado**: nada é inferido do preço e classificação desconhecida nunca é contada como real
12. **Ordem determinística das ofertas** por `externalKey` (único por viagem) + `id`, porque o service existente ordena só por `flightNumber`, que pode empatar entre provedores
13. **Sem prefixo `/api`**: o endpoint foi montado como `/trips/:tripId/analysis` porque **todas** as rotas do projeto já vivem em `/trips` (o prefixo `/api` não existe em `app.js`). Mudar o prefixo alteraria endpoints já concluídos e não foi feito
14. **Rota validada por uma única configuração de schema** (`params` + `querystring`): o endpoint não tem parâmetros e usa `maxProperties: 0` para recusar qualquer querystring com 400. `additionalProperties: false` não serve aqui porque o Ajv do Fastify roda com `removeAdditional: true` e **removeria** a chave em silêncio
15. **Indicadores de amostra e de resultado são eixos distintos**: `dataQuality.offersWithEnoughHistory` mede tamanho de série (≥ `minPreviousObservations` anteriores) e `summary.classifiedOfferCount` mede veredito. Uma oferta com amostra suficiente continua `INSUFFICIENT_DATA` se a moeda for mista, então os números podem divergir sem inconsistência

---

## 8. Pendências e riscos (estado atual)

**Débitos técnicos:**
- Sem linting/formatter
- **Dia 9 não publicado**: a `main` local está 2 commits à frente de `origin/main`; o CI ainda não executou os testes desses commits
- **Branch protection não confirmada**: o check do CI aparece no PR, mas exigir o job `Testes (Node 24 + PostgreSQL 17)` em Settings → Branches (para bloquear merge automaticamente) depende de configuração no GitHub não verificável por API sem autenticação
- Sem CORS/rate limit (API escuta em `0.0.0.0` no dev)
- Credenciais triviais do banco no compose (aceitável só para dev local)
- `docker-compose` sem limites de recurso

**Funcionalidades incompletas (planejadas, não implementadas):**
- Campo de **origem** no Trip (pesquisa usa origem fictícia do simulador)
- Análise limitada a uma oferta por vez, sem comparação entre ofertas/provedores, sem recorde/queda acumulada e sem janela temporal
- Monitoramento programado (execução periódica das pesquisas por viagem)
- Agente de IA, notificações, hotéis/veículos/atividades, provedores reais, publicação

**Limitações conhecidas da análise (documentadas na resposta):**
- `PriceHistory` não tem `createdAt` nem sequência: empates de `observedAt` não têm desempate cronológico real (a ordem de entrada decide)
- Série com moedas misturadas não é comparada: fica `INSUFFICIENT_DATA` + `MIXED_CURRENCY`
- Com 3 observações anteriores a mediana é um dos próprios valores; não há intervalo de confiança
- Preços do provedor simulado são independentes entre si: nenhum limiar pode ser calibrado com eles (a classificação é validada por fixtures)

**Bugs conhecidos:** nenhum aberto. O único bug real já registrado (datas `Invalid` no simulador) foi corrigido no Dia 6 com regressão.

---

## 9. Próximas etapas (ordem recomendada)

| Ordem | Tarefa | Dependência |
|---|---|---|
| 1 | Monitoramento programado (agendador que executa a pesquisa por viagem ativa usando a análise já existente) | Dia 9 |
| 2 | Campo de origem no Trip (migration + input + query) | nada |
| 3 | OpenAPI/Swagger formal | qualquer momento |
| 4 | Provedor real (remover barreira anti-`REAL` com decisão explícita) | 1–3 maduros + credenciais de provedor |
| 5 | Publicação da API (Dockerfile, env de produção, migrations no deploy, TLS/CORS/rate limit) | 1–4 + decisão de plataforma |

---

## 10. Instruções para retomada

**Leia antes de implementar**: `docs/contexto.md` (requisitos e regras) · `apps/api/src/app.js` · `modules/flights/flights.service.js` · `modules/offers/offers.service.js` · `modules/analysis/price-metrics.js` (cabeçalho com critérios, arredondamento e limitações) · `modules/analysis/analysis.service.js` · `integrations/flight-providers/index.js` + `normalize.js` · `prisma/schema.prisma`.

**Não alterar sem necessidade**: `docs/contexto.md` · porta 5433 (PostgreSQL nativo do Windows na 5432) · barreira anti-`REAL` · estado JS ESM puro (sem TS/tsx) · contrato de provedores.

**Preservar**: separação rota/service; nenhuma consulta ao banco em rotas; `SIMULATED` classificada no normalizador; provedor simulado puro (persistência em `modules/offers`); identidade por `externalKey`; tendências do banco; dependências mínimas justificadas; **`price-metrics.js` é núcleo puro aprovado** — não introduzir Prisma, relógio ou I/O nele; análise é somente leitura e não é recomendação de compra.

**Ambiente**:

```bash
npm install          # já roda prisma generate (postinstall)
docker compose up -d # banco na porta 5433
cp .env.example .env
npm test             # 64 testes, requer banco ativo
npm run dev          # servidor com recarga
curl http://localhost:3000/health → {"status":"ok","service":"trippulse-api"}
```

> **Snapshot atual**: API com 8 endpoints, 3 tabelas, 64 testes automatizados (40 do Dia 9 commitados em `29dca01`/`8a85392`, não publicados), 0 bugs abertos, próximos passos claros (monitoramento → origem no Trip → OpenAPI).
