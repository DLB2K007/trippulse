# Relatório de continuidade — TripPulse

> Atualizado em 2026-11-09. Cobre os **Dias 1 a 11.4**: o **Dia 11.3 está commitado em `46acf4a`**; o **Dia 11.4 está no working tree, sem commit** (não existe hash). `main` sincronizada com `origin/main` em `46acf4a`.
> O CI validou o Dia 9 em `fdfb7a7` (run `42520790068`, verde); os Dias 11.1/11.2/11.3 estão publicados em `origin/main` (11.3 em `46acf4a`). Apenas o Dia 11.4 ainda não tem commit.
> Em 2026-11-08 o histórico foi reescrito para corrigir a autoria: todos os 14 commits agora são `DLB2K007 <danielbordini027@gmail.com>`. Os hashes citados neste relatório já são os novos; os antigos não existem mais na `main`.
> Documento de contexto oficial do projeto: **`docs/contexto.md`** (o usuário pode referir-se a ele por outros nomes, como "PROJECT_CONTEXT.md" — é sempre este arquivo).
> Versões anteriores deste relatório cobrem o estado até o Dia 5 (commit `9605f03`).

---

## 1. Resumo executivo

Ao longo de 11 dias incrementais, o TripPulse saiu de documento vazio para um **backend funcional ponta a ponta com suíte de testes**:

**Dia 1** — Repositório Git, Node.js com ES Modules, Fastify, variáveis de ambiente, `.gitignore`, README e `GET /health` (commit `66dc92f`).

**Dia 2** — PostgreSQL 17 em Docker (porta **5433**, por causa de um PostgreSQL nativo do Windows na 5432), Prisma ORM 7.10.1 com `prisma.config.ts` + driver adapter `@prisma/adapter-pg`, modelagem do `Trip` e primeira migration (`e926668`).

**Renomeação** — FareHunter AI → **TripPulse** em todo o doc, código, `/health` e README (`ab6cd3a`).

**Dia 3** — CRUD completo de viagens com separação rígida: formato validado no JSON Schema das rotas, regras de negócio no service (`a451867`).

**Dia 4** — Integração **simulada** de provedores de passagens: registro de provedores como "costura" para provedores reais, provedor simulado com dados brutos estilo API externa, normalizador para o padrão canônico e garantia de `SIMULATED` **imposta por construção** (`162258a`).

**Dia 5** — Persistência: models `FlightOffer` + `PriceHistory`, snapshot de preço a cada pesquisa, identidade por `externalKey` e histórico com tendências (`FIRST_OBSERVATION` / `DROPPED` / `ROSE` / `UNCHANGED`) e `best` (`9605f03`).

**Dia 6** — Suíte de testes automatizados construída com `node --test` + `app.inject()` — e os testes **encontraram um bug real** (`Invalid Date` em ~1/3 das ofertas do simulador), corrigido com teste de regressão (`e90a3d9`).

**Dia 7** — `prisma generate` automatizado (`postinstall` + cadeia no `db:migrate`, matando o único débito operacional recorrente) e endpoint consolidado de histórico por viagem `GET /trips/:tripId/offers/history` (`c525ac9`).

**Dia 8** — Integração contínua no GitHub Actions: workflow `.github/workflows/ci.yml` que roda os 24 testes a cada push na `main` e em pull requests, com PostgreSQL 17 efêmero como serviço, migrations aplicadas por `npm run db:deploy` e falha de teste derrubando o job (commit `f5555e6`; primeira execução verde: run `42419066310`, anterior à reescrita de autoria). Depois da reescrita, o commit `54c1981` foi validado pela run `42517712825` (verde). O mesmo commit corrigiu o fechamento documental: hash e contagem de testes, ressalva sobre branch protection e próximos passos de publicação. O ajuste final do workflow (script `db:deploy`) está em `54c1981`.

**Dia 9** — Análise de preços, em duas etapas (`29dca01` e `8a85392`), publicadas em `fdfb7a7` e **validadas pelo CI** (run `42520790068`, verde):

- **Passo 1 (aprovado)**: núcleo puro `modules/analysis/price-metrics.js` — séries de preço viram centavos inteiros, mediana calculada **apenas com observações anteriores**, mínimo de 3 anteriores (4 no total) para classificar, e classificação descritiva `INSUFFICIENT_DATA` / `OPPORTUNITY` / `FAIR` / `ABOVE_HISTORY`, independente de `trend` (`DROPPED` ≠ `OPPORTUNITY`). 33 testes unitários, sem banco (o último cobre histórico suficiente sem observação atual). Inclui teto de centavos seguros, escala decimal para meio centavo e média por decomposição inteira (verificada contra oráculo `BigInt`).
- **Passo 2**: `analysis.service.js` compõe o núcleo puro com os services existentes (`getTripById` + `listOfferHistoryForTrip`) e `analysis.routes.js` expõe `GET /trips/:tripId/analysis`, estritamente de leitura. 7 testes de integração com fixtures determinísticas.

**Dia 10.1** — Identificação determinística de oportunidades (**commitado em `c3eb0c3`**): política pura `modules/opportunities/opportunity-policy.js` aplica portões de elegibilidade sobre a análise do Dia 9 sem recalcular mediana nem percentual — viagem com `startDate` não passado, somente `REAL`, moeda única com preço atual, no mínimo 5 observações anteriores em 2 dias distintos, observação com até 24 h, `classification = OPPORTUNITY` e diferença absoluta mínima de R$ 100,00. `opportunities.service.js` compõe `analyzeTripPrices` + `listOfferHistoryForTrip`, e `opportunities.routes.js` expõe `GET /trips/:tripId/opportunities` (leitura pura, sem querystring). Toda exclusão tem motivo de vocabulário fechado, o ranking e o piso são por moeda (sem câmbio) e `historicalDifference` é **diferença histórica observada**, não economia garantida. 26 testes unitários + 5 de integração. **Sem migration, sem dependência nova e sem persistência de oportunidade.**

**Dia 10.2** — Correções da auditoria independente do Dia 10.1 (6 achados baixos, todos tratados): piso de moeda agora é fail-closed (`Object.hasOwn` — chaves herdadas de prototype como `constructor` não mais passam o portão); dias distintos espelham a seleção do núcleo do Dia 9 (linhas válidas, `current` = última cronológica — a linha bruta final inválida não infla mais a cobertura de dias); `startDate` impossível ao calendário (`2027-13-45`, `2027-02-30`) é viagem não ativa (ida-e-volta UTC); `GET /flights` com id não-UUID agora responde 400 como os demais recursos (era 500 `P2007`); README alinhado (exemplo do `excludedByReason`, comparação UTC, semântica de `RANK_LIMIT_EXCEEDED`). 8 testes de regressão novos (2 na política, 5 na redução de dias, 1 de integração).

**Dia 11 — Monitoramento programado**, dividido em etapas:

- **11.1 — Núcleo puro (`908a851`)**: `modules/monitoring/monitoring-core.js` com `runMonitoringCycle({trips, search, opportunities, now})` — seleção de viagens monitoráveis **reutilizando** `evaluateTripActive` (export aditivo em `opportunity-policy.js`: a regra é uma só, nunca importada de memória), pesquisa + oportunidades sequenciais por viagem, falha isolada por viagem com estágio (`SEARCH`/`OPPORTUNITIES`), contabilização fechada, vocabulários congelados (`MONITORING_ITEM_STATUS`, `MONITORING_FAILURE_STAGE`, `MONITORING_SKIP_REASON`), sem banco/HTTP/relógio. 12 testes unitários sem banco.
- **11.2 — Execução manual (`34e9135`)**: `monitoring.service.js` (`startMonitoringRun` com lock in-process setado sincronicamente antes do primeiro `await` + liberação em `finally` + dependências injetáveis com defaults de produção) e `monitoring.routes.js` (`POST /monitoring/runs`, schema fechado verificado empiricamente no Fastify 5: POST sem body chega como `null` → body `object|null`, `maxProperties: 0`). Reutiliza integramente `searchFlightsForTrip`, `listTripOpportunities` e `listTrips` — nada duplicado. `GET` deliberadamente ausente (sem persistência ainda). 6 testes de integração. O script `test` ganhou `--test-concurrency=1`: causa raiz documentada de flakiness — arquivos de teste do node:test rodam em paralelo sobre o único PostgreSQL e a corrida entre arquivos (colisão com `opportunities-endpoint.test.js`) foi eliminada executando arquivos sequencialmente.
- **11.3 — Persistência de execuções (`46acf4a`)**: migration `20261109131507_add_monitoring_runs` (model `MonitoringRun` com índice parcial único no Postgres `monitoring_runs_one_running_key` em `status = 'RUNNING'` — árbitro de concorrência **entre processos**; o lock in-process permanece como fast path). `startMonitoringRun` cria a linha RUNNING (P2002 → 409 **só** quando comprovadamente deste índice; obtido em `meta.driverAdapterError.cause.constraint.index` no Prisma 7 + adapter-pg, pois `meta.target` clássico não vem),  executa o núcleo intocado e finaliza **sempre** no desfecho: `COMPLETED` (com contagens e itens do relatório) ou `FAILED` (ciclo abortou — falha global; falha por viagem segue sendo dado do relatório, não status). `POST /monitoring/runs` evoluiu para devolver o registro persistido (mudança de contrato documentada); `GET /monitoring/runs` devolve o histórico real (mais recentes primeiro, `limit` 1–100 default 20, sem dado fictício). 10 testes de integração/persistência (05 do 11.2 evoluídos + 4 novos).

**Dia 11.4 — Agendador automático (working tree, sem commit):**

- **Fase A — agendador + configuração**: `modules/monitoring/scheduler.js` com after-complete loop (nunca `setInterval`), primeiro ciclo só após o intervalo completo (D1), no máximo um timer e uma cadeia por instância, `stop()` durante ciclo em voo sem abortar o ciclo. `env.js` passa a expor `monitoringScheduler` com `MONITORING_SCHEDULER_ENABLED` estrito (default **OFF**) e `MONITORING_SCHEDULER_INTERVAL_MS` inteiro entre 60000 e 86400000 ms (default 900000), com fail-fast apenas quando o agendador está ativo. 18 testes do scheduler (17 unitários sem tempo real + 1 de integração com `trigger: SCHEDULED`) e 11 de ambiente.
- **Fase B — wiring ao bootstrap**: `server.js` ganhou `startServer(deps)` injetável; o scheduler é criado e iniciado **somente após** `listen()` bem-sucedido, handlers de sinal são registrados uma única vez e o shutdown idempotente executa `scheduler.stop()` → `await scheduler.idle()` → `await app.close()` → `terminate(0)`. `buildApp()` permanece intocado e nunca ativa o scheduler. 13 testes de bootstrap.
- **Fase B.1 — hardening da revisão independente**: M1 (stop→start com ciclo em voo não duplica timers; `cycleRunning` separado da promessa do `idle()` cobre também tick que falha antes do primeiro `await`), M2 (parsing estrito rejeita `60000abc`, `60000.9`, `60000 0`), M3 (helper de ambiente isola/restaura `PORT`, `HOST` e variáveis do scheduler), L1 (log de início dentro do `try`; falha de logger não mata a cadeia nem gera `unhandledRejection`), L2 (falha pós-listen executa `scheduler.stop()` + `app.close()` + exit 1 com log próprio, sem rotular como falha de listen) e L4 (config lida antes de criar a aplicação). 8 testes novos; suíte em 167.
- **Fase C — documentação, auditoria final e validação integrada**: README (agendador, defaults, D1, persistência e shutdown), `.env.example` (as duas variáveis, com scheduler desligado) e este relatório. Auditoria integral sem defeito funcional novo (duas imprecisões documentais corrigidas no código) e validação: **167/167 em 3 rodadas**, mais 2 rodadas com `PORT`/`HOST` poluídos; smoke OFF real (`/health` 200, sem scheduler) e smoke ON real com intervalo mínimo configurado de 60000 ms: o primeiro ciclo ocorreu **60.210 ms após o boot** (sessenta mil duzentos e dez milissegundos), equivalentes a **60,21 s** (1 minuto e 0,21 s) — nenhum ciclo antes dos 60 s, `MonitoringRun` persistido com `trigger: SCHEDULED`, shutdown gracioso e zero ciclos nos 65 s seguintes ao stop.

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
| Análise de preços por viagem (descritiva do histórico) | ✅ Implementado, testado e publicado (Dia 9, `fdfb7a7`) |
| Identificação determinística de oportunidades | ✅ Implementado e testado (Dias 10.1 e 10.2, commitados) |
| Monitoramento — núcleo puro do ciclo | ✅ Implementado e testado (Dia 11.1) |
| Monitoramento — execução manual (POST) | ✅ Implementado e testado, com persistência e histórico (Dias 11.2–11.3) |
| Monitoramento — agendador (execuções programadas) | ✅ Implementado e testado (Dia 11.4, working tree; OFF por padrão) |
| Integração **real** com provedores | ❌ Não iniciado (bloqueado por decisão de escopo do MVP) |
| Agente de IA / recomendações | ❌ Não iniciado |
| Notificações, hotéis, veículos, atividades; publicação | ❌ Não iniciado |

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
│   │   ├── env.js            # carrega/valida PORT, HOST e config do scheduler (defaults)
│   │   └── prisma.js         # instância única de PrismaClient (adapter-pg)
│   ├── modules/
│   │   ├── trips/            # CRUD de viagens
│   │   ├── flights/          # orquestra pesquisa → normalização → snapshot
│   │   ├── offers/           # domínio de ofertas: identidade, snapshot, histórico
│   │   ├── analysis/         # price-metrics.js (puro) + service/rota de análise
│   │   ├── opportunities/    # política pura + service/rota de oportunidades
│   │   └── monitoring/       # núcleo puro + service (lock+persistência)/rotas + scheduler.js (quando disparar)
│   ├── integrations/
│   │   └── flight-providers/
│   │       ├── index.js      # registro de provedores (único ponto de extensão)
│   │       ├── normalize.js  # bruto → padrão canônico + garantia SIMULATED
│   │       └── simulated/    # provedor externo simulado
│   ├── shared/
│   │   ├── errors.js         # HttpError(statusCode, message)
│   │   └── uuid.js           # isUuid()
│   ├── app.js                # monta Fastify + /health + plugins no prefixo /trips
│   └── server.js             # bootstrap: listen → scheduler → handlers → shutdown gracioso
├── docs/ (contexto.md, relatorio-continuidade.md)
├── prisma/ (schema.prisma + 3 migrations)
├── prisma.config.ts          # conexão do CLI (tolerante a .env ausente)
├── tests/ (15 arquivos, 167 testes)
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
| `GET` | `/trips/:tripId/opportunities` | 200/400/404 | opportunities.routes (só leitura) |
| `POST` | `/monitoring/runs` | 200/409 | monitoring.routes (executae persiste) |
| `GET` | `/monitoring/runs` | 200/400 | monitoring.routes (só leitura) |

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

POST /monitoring/runs
  → validações (now/trigger) → lock in-process (set síncrono; 409 em uso)
  → INSERT monitoring_runs (RUNNING) — P2002 do índice parcial → 409
  → runMonitoringCycle (núcleo puro do 11.1):
      para cada viagem: evaluateTripActive → skip | search (escreve histórico)
      → opportunities (só leitura) → item OK | FAILED(stage)
  → UPDATE sempre (finally): COMPLETED (contagens+itens) ou FAILED (aborto)
  → resposta: registro persistido (runId, status, contagens, itens)

GET /monitoring/runs?limit=20
  → leitura EXCLUSIVA do banco: execuções, mais recentes primeiro (limit 1–100)

Agendador (MONITORING_SCHEDULER_ENABLED=true)
  → start() SOMENTE após listen bem-sucedido: agenda o 1º tick APÓS o intervalo
  → tick: startMonitoringRun({ trigger: SCHEDULED }) → persistência do run
  → finally: somente então agenda o próximo (after-complete, sem sobreposição)
  → 409 de ciclo concorrente = skip com log .info; erro = log .error + reagenda

SIGTERM/SIGINT
  → scheduler.stop() (cancela o timer; nenhum ciclo NOVO)
  → await scheduler.idle() (ciclo em voo termina, não é abortado)
  → await app.close() → terminate(0); sinais repetidos = mesma promessa
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

monitoring_runs (MonitoringRun)  — sem FK: registro operacional, independente de viagens
  id uuid pk · status (RUNNING|COMPLETED|FAILED) · trigger (MANUAL|SCHEDULED) ·
  started_at · finished_at? · duration_ms? · trip_count · monitorable_count ·
  skipped_count · ok_count · failed_count · opportunity_count · items jsonb
  @@index(started_at)
  § índice parcial único: UNIQUE(status) WHERE status = 'RUNNING'  ← árbitro
```

**Migrations aplicadas**: `20261107211054_init_create_trips` (trips), `20261107214055_add_flight_offers_and_price_history` (flight_offers, price_history, FKs, índices) e `20261109131507_add_monitoring_runs` (monitoring_runs + índice parcial único escrita na mão — Prisma não modela índice parcial).

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
| 9 (`29dca01`, `8a85392`; publicado em `fdfb7a7`) | `modules/analysis/{price-metrics,analysis.service,analysis.routes}.js` (novos), `app.js` (registro da rota), `tests/{price-metrics,analysis-endpoint}.test.js` (novos), README (endpoint e contrato), este relatório. **Sem migration e sem dependência nova.** |
| 10.1 (`c3eb0c3`) | `modules/opportunities/{opportunity-policy,opportunities.service,opportunities.routes}.js` (novos), `app.js` (registro da rota), `tests/{opportunities-policy,opportunities-endpoint}.test.js` (novos), README (endpoint, política e motivos), este relatório. **Sem migration, sem dependência e sem persistência.** |
| 10.2 | **Correções da auditoria**: `opportunity-policy.js` (piso fail-closed com `Object.hasOwn`; `startDate` com ida-e-volta de calendário), `opportunities.service.js` (`distinctDaysBeforeCurrent` espelhando o núcleo, exportada pura), `flights.service.js` (400 para id não-UUID), `tests/{opportunities-policy,api}.test.js` (+3 regressões), `tests/opportunities-days.test.js` (novo, 5), README (3 alinhamentos), este relatório |
| 11.1 (`908a851`) | `modules/monitoring/monitoring-core.js` (novo), `tests/monitoring-core.test.js` (novo, 12), `opportunity-policy.js` (export aditivo de `evaluateTripActive`, +6/−1). **Sem migration e sem dependência nova.** |
| 11.2 (`34e9135`) | `modules/monitoring/{monitoring.service,monitoring.routes}.js` (novos), `app.js` (registro em `/monitoring`), `tests/monitoring-endpoint.test.js` (novo, 6), `package.json` (script `test` com `--test-concurrency=1`). **Sem migration e sem dependência nova.** |
| 11.3 (`46acf4a`) | `migration 20261109131507_add_monitoring_runs` (nova, com índice parcial único manual), `schema.prisma` (model `MonitoringRun`), `monitoring.service.js` (persistência + árbitro), `monitoring.routes.js` (GET + POST evoluído), `tests/monitoring-endpoint.test.js` (10 testes), README (seção `/monitoring`), este relatório. **Dependência nova: nenhuma.** |
| 11.4 (working tree, sem commit) | `modules/monitoring/scheduler.js` (novo), `config/env.js` (config do scheduler), `server.js` (startServer + wiring + shutdown; Fase B.1), `tests/{monitoring-scheduler,env,server-bootstrap}.test.js` (novos, 18/11/13), `README` (agendador), `.env.example` (2 variáveis), este relatório. **Sem migration, sem dependência nova e sem mudança de escopo do ciclo.** |

**Scripts npm atuais**: `start` · `dev` (`--watch`) · `start:no-env` · `db:migrate` (`migrate dev && generate`) · `db:deploy` (= `prisma migrate deploy`, também usado no CI) · `postinstall` (`prisma generate`) · `test` (`node --env-file=.env --test --test-force-exit --test-concurrency=1` — arquivos sequenciais porque todos compartilham o mesmo PostgreSQL).

---

## 6. Testes

**167/167 passando** (arquivos sequenciais — ver Decisão 22): estado do Dia 11.4 (working tree). Três rodadas completas e duas rodadas com `PORT`/`HOST` exportados no shell, todas verdes.

| Arquivo | Testes | O que protege |
|---|---|---|
| `tests/api.test.js` | 13 | `/health`; CRUD completo (201/400 schema/400 domínio/404/204); UUID inválido → 400; pesquisa persiste snapshot com `SIMULATED`; 2ª pesquisa compara com a anterior e dedupe de ofertas; cascade de exclusão; **regressão: `/flights` com id não-UUID é 400, não 500** |
| `tests/normalize.test.js` | 3 | padrão canônico completo; barreira anti-`REAL`; rejeição de oferta incompleta |
| `tests/simulated-provider.test.js` | 3 | 3–5 ofertas; **datas ISO válidas (regressão do bug T010)**; identidade estável × preço variável por semente |
| `tests/offers-service.test.js` | 2 | `externalKey`; snapshot: `FIRST_OBSERVATION` → `UNCHANGED`, dedupe, `best` |
| `tests/offers-history.test.js` | 4 | endpoint de histórico: 404/400; vazio pré-pesquisa; consolidação após 2 pesquisas; cascade |
| `tests/price-metrics.test.js` | 33 | núcleo puro: limiares (10%/-10 e 9,99%), mediana sem o preço atual, `DROPPED`≠`OPPORTUNITY`, `ROSE`≠`ABOVE_HISTORY`, moeda mista, observações inválidas, ordenação/imutabilidade, centavos e meio centavo, teto de inteiro seguro, média de somas grandes, validação de `options`, empates de `observedAt` |
| `tests/analysis-endpoint.test.js` | 7 | endpoint de análise com **fixtures determinísticas**: 400/404 e rejeição de querystring; viagem sem ofertas; histórico insuficiente (inclui oferta sem histórico e observação inválida); as três classificações; identificação de dados simulados × reais; moeda mista; repetibilidade + ausência de escrita + contrato de `/offers/history` preservado |
| `tests/opportunities-policy.test.js` | 28 | política pura: portões (viagem, dado, comparabilidade, amostra, recência, classificação, piso), motivos e precedência, limites exatos do piso (R$ 99,99 × R$ 100,00) e de 24 h, ranking e limite por moeda, determinismo, imutabilidade, contabilidade fechada e validação da política; **regressões: piso fail-closed contra chaves herdadas de prototype (`constructor`) e `startDate` impossível ao calendário (`2027-13-45`, `2027-02-30`)** |
| `tests/opportunities-endpoint.test.js` | 5 | endpoint com fixtures determinísticas: 400/404 e rejeição de querystring; viagem sem ofertas; real × simulada × sem queda (motivos e contagens); lista vazia quando só há simulados; repetibilidade, ausência de escrita e contratos de `/analysis` e `/offers/history` preservados |
| `tests/opportunities-days.test.js` | 5 | redução pura de dias distintos: regressão da linha final inválida (não conta o dia do `current` como histórico), linhas inutilizáveis descartadas antes de eleger o `current`, entrada nula/vazia/sem histórico, `observedAt` inválido em qualquer posição |
| `tests/monitoring-core.test.js` | 12 | núcleo puro do ciclo: viagem iniciando hoje/executável, futura, inativa sem chamadas, nenhuma monitorável, lista vazia, contagem de oportunidades, falha isolada de pesquisa (oportunidades não chamadas), falha isolada de oportunidades (pesquisa conta), múltiplas misturadas com contagens fechadas, determinismo, imutabilidade+freeze, dependências/`now` inválidos (fail alto, zero chamadas) |
| `tests/env.test.js` | 11 | config do agendador: default OFF/900000; boolean estrito (`true`/`1`; `yes`/`sim` desativam com `warn`); intervalo inválido ignorado com OFF e fail-fast com ON; fronteiras 60000/86400000; **M2: rejeita `60000abc`, `60000.9`, `60000 0`**; **M3: isola e restaura `PORT`/`HOST`, sem vazamento do shell** |
| `tests/monitoring-scheduler.test.js` | 18 | agendador: timer único e idempotente; D1 (nada antes do intervalo); after-complete sem sobreposição; 409 como skip; erro genérico não para a cadeia; stop em voo; `idle()`; logs sem duplicação; **M1: stop→start em voo mantém uma cadeia e zero timers no stop final**; **borda: tick que falha antes do 1º `await` não deixa ciclo fantasma**; **L1: logger quebrado não mata a cadeia nem gera `unhandledRejection`**; integração real: `defaultScheduledRun` grava `trigger: SCHEDULED` |
| `tests/server-bootstrap.test.js` | 13 | bootstrap: OFF nunca cria scheduler; ON inicia só após `listen` e usa o logger do Fastify; listen falhando → exit 1 sem factory/handlers; **L2: falha pós-listen (factory ou handlers) → stop + close + exit 1 com log da fase**; **L4: env incompleto falha antes de `createApplication`**; SIGTERM/SIGINT mesma sequência; shutdown idempotente; `close()` aguarda ciclo em voo; falha de `close`; `buildApp` real em porta 0; factory real com relógio falso |
| `tests/monitoring-endpoint.test.js` | 10 | persistência: POST grava run COMPLETED refletindo relatório (linha verificada no banco); POST valida body/query ({} ok); GET histórico real com ordem decrescente e limit; GET valida limit; **árbitro: RUNNING de outro processo → 409 e nenhuma segunda linha RUNNING**; 200+409 simultâneos com lock liberado depois; falha isolada por viagem com run COMPLETED; **ciclo abortado → run FAILED, finishedAt gravado, nenhum RUNNING órfão**; concorrência in-process (1 ciclo, 1 rejeição, 1 pesquisa); trigger fora do vocabulário → TypeError sem criar linha |

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
16. **Oportunidade é resultado calculado, não entidade**: a política pura recebe o envelope de análise e decide elegibilidade; nada é persistido. Persistir exigiria decidir expiração, deduplicação e idempotência de alerta — problemas que só existem quando houver notificação e dados reais
17. **Classificação (Dia 9) e elegibilidade (Dia 10.1) são camadas distintas**: a política não recalcula mediana nem percentual; exige `classification = OPPORTUNITY` vinda do núcleo e acrescenta amostra maior (5 anteriores em 2 dias distintos), recência (24 h), piso absoluto por moeda e viagem não iniciada. Uma oferta pode ser `OPPORTUNITY` e não ser oportunidade
18. **`historicalDifference` é diferença histórica observada**: mediana das observações anteriores menos o preço atual. Nunca é economia garantida, projeção futura ou recomendação de compra; a resposta carrega limitações e não expõe campo de garantia
19. **Ranking e piso são por moeda, sem câmbio**: moedas diferentes nunca são comparadas, o limite de 10 é por moeda e uma moeda sem piso declarado é excluída (`NO_CURRENCY_FLOOR`) em vez de herdar o piso de outra. `startDate` é data de calendário (`DATE`, sem hora nem fuso): viagem com partida passada não é monitorável
20. **Portões fail-closed por construção (Dia 10.2)**: duas fontes de verdade não podem divergir — a seleção de "observação atual" (núcleo `price-metrics`) e a contagem de dias distintos (`opportunities.service`) foram alinhadas no mesmo critério (linhas válidas, `current` = última cronológica); moeda sem piso declarado exclui com `Object.hasOwn` (chaves herdadas de prototype não são piso); data impossível de calendário não é viagem ativa. Sempre falhar para o lado conservador da decisão
21. **Arbitração dupla da concorrência no monitoramento (Dia 11.3)**: lock in-process (set síncrono antes do 1º `await`, 409 fast path no mesmo processo) **e** índice parcial único do Postgres em `status = 'RUNNING'` (workers/processos diferentes; `P2002` → 409). O `P2002` só vira 409 quando comprovadamente deste índice: cheque pelo **nome exato** — no Prisma 7 + adapter-pg o nome vem em `meta.driverAdapterError.cause.constraint.index` (postgrest `23505`), o `meta.target` clássico não vem; qualquer outro conflito sobe cru (500) como bug
22. **Arquivos de teste rodando sequencialmente** (`--test-concurrency=1`): o `node:test` roda arquivos em paralelo sobre o único Postgres de dev e o ciclo de monitoramento (que escreve em **todas** as viagens ativas) colidia com fixtures de outros arquivos — a flakiness observada em `opportunities-endpoint.test.js:258` tinha essa causa. Testes internos a um arquivo continuam sequenciais por padrão do runner
23. **Persistência reflete o núcleo, nunca o duplica (Dia 11.3)**: a linha `MonitoringRun` grava exatamente o relatório de `runMonitoringCycle` (contagem fechada, itens congelados em JSONB) e a derivação de `status` COMPLETED/FAILED é a decisão deferida do 11.1 — `FAILED` só para aborto global; falha por viagem é `items[].status = FAILED` e a execução segue COMPLETED. `trigger` MANUAL/SCHEDULED fecha o vocabulário **antes** do agendador (Dia 11.4) para não exigir migration nova
24. **POST /monitoring/runs evoluiu de contrato no 11.3** (relatório puro → registro persistido com `runId`/`status`/janela): mudança única, documentada no README e nos testes — o histórico anterior não existia, não há compatibilidade a preservar
25. **Agendador é after-complete, nunca `setInterval` (Dia 11.4)**: agenda → executa → só no `finally` agenda o próximo. Por construção o próprio scheduler não sobrepõe ciclos (intervalo real = duração + intervalo) e a concorrência entre processos continua no índice parcial único (`409` → skip com log `.info`, sem alarme). O primeiro tick nasce somente após o intervalo completo (D1): deploy/reinício não dispara ciclo imediato
26. **Scheduler OFF por padrão e config fail-fast (Dia 11.4)**: `MONITORING_SCHEDULER_ENABLED` só aceita `true`/`1` (resto desativa; valor não reconhecido avisa); `MONITORING_SCHEDULER_INTERVAL_MS` é inteiro 60000–86400000 (default 900000), com parsing **estrito** (não `parseInt`) e `TypeError` no boot apenas quando o agendador está ativo e o valor presente é inválido. Com OFF a invalidade é irrelevante e cai no default — nunca “scheduler silenciosamente ligado com 1 ms”
27. **Wiring só depois do `listen`; shutdown gracioso e idempotente (Dia 11.4)**: o scheduler nasce após a porta abrir (falha de listen não cria timers/handlers) e o encerramento é `stop()` (corta a cadeia) → `idle()` (espera o ciclo em voo, sem abortar) → `close()` → `terminate(0)`; sinais repetidos compartilham a mesma promessa. Falha **pós-listen** tem tratamento próprio: log da fase, `stop()`, `close()` e exit 1. `buildApp()` permanece sem scheduler — testes HTTP nunca disparam ciclos
28. **Hardening B.1 (Dia 11.4)**: uma única cadeia por instância, com `cycleRunning` (verdade sobre ciclo em curso) separada de `inFlight` (promessa do `idle()`) — cobre stop→start em voo e tick que falha antes do primeiro `await`; log de início dentro do `try` e `catch` na promessa do idle, de modo que logger quebrado não mata a cadeia nem gera `unhandledRejection`; testes de ambiente isolam `PORT`/`HOST` (a suíte não depende do shell)

---

## 8. Pendências e riscos (estado atual)

**Débitos técnicos:**
- Sem linting/formatter
- **Branch protection não confirmada**: o check do CI aparece no PR, mas exigir o job `Testes (Node 24 + PostgreSQL 17)` em Settings → Branches (para bloquear merge automaticamente) depende de configuração no GitHub não verificável por API sem autenticação
- Sem CORS/rate limit (API escuta em `0.0.0.0` no dev)
- Credenciais triviais do banco no compose (aceitável só para dev local)
- `docker-compose` sem limites de recurso

**Funcionalidades incompletas (planejadas, não implementadas):**
- Campo de **origem** no Trip (pesquisa usa origem fictícia do simulador)
- Análise limitada a uma oferta por vez, sem comparação entre ofertas/provedores, sem recorde/queda acumulada e sem janela temporal
- Agente de IA, notificações, hotéis/veículos/atividades, provedores reais, publicação

**Limitações conhecidas da análise (documentadas na resposta):**
- `PriceHistory` não tem `createdAt` nem sequência: empates de `observedAt` não têm desempate cronológico real (a ordem de entrada decide)
- Série com moedas misturadas não é comparada: fica `INSUFFICIENT_DATA` + `MIXED_CURRENCY`
- Com 3 observações anteriores a mediana é um dos próprios valores; não há intervalo de confiança
- Preços do provedor simulado são independentes entre si: nenhum limiar pode ser calibrado com eles (a classificação é validada por fixtures)

**Bugs conhecidos:** nenhum aberto. O único bug real já registrado (datas `Invalid` no simulador) foi corrigido no Dia 6 com regressão.

**Riscos documentados do monitoramento (Dia 11.3):**
- Se o banco cair **exatamente na finalização**, a linha pode ficar RUNNING (a `INSERT` de UPDATE de desfecho falhou e o erro original é preservado deliberadamente). É risco registrado, não bug: exige indisponibilidade do banco no meio da execução; o índice parcial garante que um novo ciclo informará 409 até a linha ser limpa manualmente.
- Sem alerta de execução FAILED/órfã (notificações pertencem a outro escopo).

**Riscos e dívidas documentados do agendador (Dia 11.4):**
- **Shutdown sem timeout (L3, fora do escopo por decisão)**: `idle()` aguarda o ciclo em voo sem prazo; um ciclo travado retém o processo até o SIGKILL do orquestrador. Se o banco cair no meio, a linha pode ficar `RUNNING` (mesmo risco do 11.3) e bloquear ciclos seguintes com 409 até limpeza manual. Opções futuras: grace period configurável (barato, mas não cancela o run), `AbortController` atravessando service/provedores (mudança estrutural) e recuperação de `RUNNING` órfão no boot (migration/consulta nova). Nenhuma foi implementada
- **Listeners de sinal não são removidos e `app.close()` externo não para o scheduler (L4)**: hoje não há caminho concreto (um bootstrap por processo; o scheduler só nasce em `startServer`). Se o bootstrap for reutilizado no mesmo processo, convém guardar/remover handlers e adicionar hook `onClose` ou `dispose()`
- **Sinais de SO reais não são exercitáveis neste Windows/Git Bash**: `timeout`/`kill` entregam TerminateProcess; a lógica é coberta com `EventEmitter` injetado e chamada direta de `shutdown()`, e o smoke ON real encerra pela função retornada. Validação de SIGTERM real fica para Linux/CI

---

## 9. Próximas etapas (ordem recomendada)

| Ordem | Tarefa | Dependência |
|---|---|---|
| 1 | **Revisão e commit do Dia 11.4** (agendador + hardening + documentação) — working tree pronto, sem hash | Dias 11.1–11.3 |
| 2 | Campo de origem no Trip (migration + input + query) | nada |
| 3 | OpenAPI/Swagger formal | qualquer momento |
| 4 | Provedor real (remover barreira anti-`REAL` com decisão explícita) | 1–3 maduros + credenciais de provedor |
| 5 | Publicação da API (Dockerfile, env de produção, migrations no deploy, TLS/CORS/rate limit) | 1–4 + decisão de plataforma |

---

## 10. Instruções para retomada

**Leia antes de implementar**: `docs/contexto.md` (requisitos e regras) · `apps/api/src/app.js` · `modules/flights/flights.service.js` · `modules/offers/offers.service.js` · `modules/analysis/price-metrics.js` (cabeçalho com critérios, arredondamento e limitações) · `modules/analysis/analysis.service.js` · `modules/monitoring/monitoring-core.js` (núcleo puro do ciclo + contrato) · `modules/monitoring/monitoring.service.js` (lock + árbitro + persistência) · `modules/monitoring/scheduler.js` (after-complete, single chain, `idle()`) · `server.js` (`startServer`, wiring pós-listen, shutdown) · `config/env.js` (scheduler OFF/fail-fast) · `integrations/flight-providers/index.js` + `normalize.js` · `prisma/schema.prisma`.

**Não alterar sem necessidade**: `docs/contexto.md` · porta 5433 (PostgreSQL nativo do Windows na 5432) · barreira anti-`REAL` · estado JS ESM puro (sem TS/tsx) · contrato de provedores.

**Preservar**: separação rota/service; nenhuma consulta ao banco em rotas; `SIMULATED` classificada no normalizador; provedor simulado puro (persistência em `modules/offers`); identidade por `externalKey`; tendências do banco; dependências mínimas justificadas; **`price-metrics.js` é núcleo puro aprovado** — não introduzir Prisma, relógio ou I/O nele; **`monitoring-core.js` é núcleo puro aprovado** (mesma regra) e `evaluateTripActive` segue sendo A ÚNICA regra de viagem monitorável; análise/oportunidades são somente leitura e não são recomendação de compra.

**Ambiente**:

```bash
npm install          # já roda prisma generate (postinstall)
docker compose up -d # banco na porta 5433
cp .env.example .env
npm test             # 167 testes, requer banco ativo
npm run dev          # servidor com recarga
curl http://localhost:3000/health → {"status":"ok","service":"trippulse-api"}
```

> **Snapshot atual**: API com 12 endpoints, 4 tabelas, **167 testes automatizados em 15 arquivos** (0 abertos; Dias 1–10 e 11.1–11.2 validados pelo CI, 11.3 publicado em `origin/main` (`46acf4a`)). O **Dia 11.4 está no working tree, sem commit** (agendador automático, shutdown gracioso, hardening B.1 e esta documentação). Próximos passos: revisar/commitar o 11.4 → origem no Trip → OpenAPI.
