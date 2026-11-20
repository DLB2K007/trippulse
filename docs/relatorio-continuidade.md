# Relatório de continuidade — TripPulse

> Atualizado em 2026-11-20. Cobre os **Dias 1 a 11.9** e o **D3**: o **Dia 11.3 está publicado em `46acf4a`**, o **Dia 11.4 em `83eb1ec`**, o **Dia 11.5 em `e4109eb`**, o **Dia 11.6 em `fab9eac`**, o **Dia 11.8 em `c55238c`**, o **Dia 11.9 em `72864543a36babdf2522af32558b524e2b2447a7`**, o **D3 em `6abba27d15f6500f8d3aa12b0f7479b6d3161137`**, a **Fase 4 em `a68bf73eb001bc9d70484186a4b98a4a53b82334`** e o **planejamento da Fase 5 em `9c2fe22567ced8af923cd375a742bb07c359a013`**; o **commit dos testes de regressão do `booking_token` em `81d5bb3e8a30e8e7559f60354863adcdef5a51c2`** está publicado, `main == origin/main == 81d5bb3` e a árvore de trabalho estava limpa na auditoria pós-push.
> O CI validou o Dia 9 em `fdfb7a7` (run `42520790068`, verde); os Dias 11.1/11.2/11.3 estão publicados em `origin/main` (11.3 em `46acf4a`), o 11.4 também foi publicado (`83eb1ec`), o 11.5 foi publicado com CI success (`e4109eb`), o 11.6 foi publicado (`fab9eac`), o 11.8 foi publicado com CI success (run `43106273261`), o 11.9 foi publicado com CI success (run `43460301273`) e o D3 foi validado pelo CI success (run `43788295629`). A **Fase 4 (OpenAPI 3.1 + Swagger UI) foi implementada e corrigida em 16/11/2026** (§14.13 e §14.14) e **publicada em `a68bf73`**; o CI #14 (`43884861309`) concluiu com `success`. A **Fase 5 foi planejada em 16/11/2026** (§15), sem chamada real, sem alteração de código e com `REAL` bloqueado. A **primeira melhoria técnica da Fase 5 — testes de regressão do `booking_token` — foi implementada e publicada em `81d5bb3`**, com o CI #16 (`44829121134`) concluído com `success` (§15.14).
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

**Dia 11.4 — Agendador automático (commit `83eb1ec`, publicado em `origin/main`):**

- **Fase A — agendador + configuração**: `modules/monitoring/scheduler.js` com after-complete loop (nunca `setInterval`), primeiro ciclo só após o intervalo completo (D1), no máximo um timer e uma cadeia por instância, `stop()` durante ciclo em voo sem abortar o ciclo. `env.js` passa a expor `monitoringScheduler` com `MONITORING_SCHEDULER_ENABLED` estrito (default **OFF**) e `MONITORING_SCHEDULER_INTERVAL_MS` inteiro entre 60000 e 86400000 ms (default 900000), com fail-fast apenas quando o agendador está ativo. 18 testes do scheduler (17 unitários sem tempo real + 1 de integração com `trigger: SCHEDULED`) e 11 de ambiente.
- **Fase B — wiring ao bootstrap**: `server.js` ganhou `startServer(deps)` injetável; o scheduler é criado e iniciado **somente após** `listen()` bem-sucedido, handlers de sinal são registrados uma única vez e o shutdown idempotente executa `scheduler.stop()` → `await scheduler.idle()` → `await app.close()` → `terminate(0)`. `buildApp()` permanece intocado e nunca ativa o scheduler. 13 testes de bootstrap.
- **Fase B.1 — hardening da revisão independente**: M1 (stop→start com ciclo em voo não duplica timers; `cycleRunning` separado da promessa do `idle()` cobre também tick que falha antes do primeiro `await`), M2 (parsing estrito rejeita `60000abc`, `60000.9`, `60000 0`), M3 (helper de ambiente isola/restaura `PORT`, `HOST` e variáveis do scheduler), L1 (log de início dentro do `try`; falha de logger não mata a cadeia nem gera `unhandledRejection`), L2 (falha pós-listen executa `scheduler.stop()` + `app.close()` + exit 1 com log próprio, sem rotular como falha de listen) e L4 (config lida antes de criar a aplicação). 8 testes novos; suíte em 167.
- **Fase C — documentação, auditoria final e validação integrada**: README (agendador, defaults, D1, persistência e shutdown), `.env.example` (as duas variáveis, com scheduler desligado) e este relatório. Auditoria integral sem defeito funcional novo (duas imprecisões documentais corrigidas no código) e validação: **167/167 em 3 rodadas**, mais 2 rodadas com `PORT`/`HOST` poluídos; smoke OFF real (`/health` 200, sem scheduler) e smoke ON real com intervalo mínimo configurado de 60000 ms: o primeiro ciclo ocorreu **60.210 ms após o boot** (sessenta mil duzentos e dez milissegundos), equivalentes a **60,21 s** (1 minuto e 0,21 s) — nenhum ciclo antes dos 60 s, `MonitoringRun` persistido com `trigger: SCHEDULED`, shutdown gracioso e zero ciclos nos 65 s seguintes ao stop. Commit `83eb1ec` (pai `46acf4a`), publicado em `origin/main`.

**Dia 11.5 — Resiliência do scheduler (commit `e4109eb`, publicado em `origin/main` com CI success):**

- **Heartbeat + recuperação de órfãs**: migration `20261109170000_add_monitoring_run_heartbeat` adiciona `heartbeat_at` (default `now`, backfill com `started_at`) e `failure_reason` a `monitoring_runs`. `startMonitoringRun` renova o heartbeat antes/depois de cada pesquisa e avaliação; `recoverStaleMonitoringRuns({ staleAfterMs })` converte em `FAILED` toda execução `RUNNING` sem heartbeat por 30 min e devolve o motivo. A recuperação roda antes de cada nova execução (manual ou agendada), então uma linha órfã não bloqueia o índice parcial indefinidamente. Execução com heartbeat recente nunca é tocada.
- **Posse protegida**: os `UPDATE`s finais (COMPLETED e FAILED) são condicionados a `status = 'RUNNING'`. Se outro processo recuperou a linha enquanto o ciclo atrasado ainda trabalhava, o ciclo recebe `409` e não sobrescreve o `FAILED` de recuperação.
- **Timeout de shutdown**: `SHUTDOWN_TIMEOUT_MS` (default 10000, faixa 1000–60000, fail-fast se presente e inválido) limita a espera por `scheduler.idle()`. Se expirar, o shutdown registra `warn`, segue para `app.close()` e encerra; o ciclo não é abortado e a recuperação por heartbeat cobre a linha. O timer é sempre limpo.
- **Validação**: **175/175 testes** em 16 arquivos, incluindo recuperação de órfã, preservação de execução viva, `409` para heartbeat recente, ciclo atrasado que não ressuscita a linha, renovação do heartbeat em ciclo real (prova do `withHeartbeat`), timeout de shutdown e validação da nova variável.

**Dia 11.6 — Origem da viagem, imutabilidade de rota/período e serialização transacional (commit `fab9eac`, publicado):**

- **`origin` no Trip**: migration `20261111011707_add_trip_origin` (`ALTER TABLE "trips" ADD COLUMN "origin" TEXT` — **nullable, sem backfill fictício**). Origem é texto canônico de localização, mesmo padrão do `destination` (não é IATA). POST exige `origin` (schema dedicado `createTripBodySchema`); PUT a torna opcional (ausente = preserva a armazenada), então viagens legadas sem origem podem recebê-la enquanto não tiverem ofertas.
- **Gate de pesquisa**: viagem sem origem **não pesquisa** — `GET /trips/:tripId/flights` responde `409` (associar uma origem inferida a um histórico existente corromperia o significado do histórico). Viagem deletada durante a pesquisa → `404` pós-lock.
- **Imutabilidade de rota/período**: após a primeira oferta persistida, `origin`, `destination`, `startDate` e `endDate` ficam congelados (`PUT` violando → `409`); `name` permanece editável. Mudança de rota ou período exige **nova viagem** — o `externalKey` das ofertas inclui rota e `departureDate`, e misturar históricos de rotas/períodos diferentes na mesma viagem invalidaria `previous`/`best`/`trend`.
- **Serialização por linha (`SELECT ... FOR UPDATE`)**: novo `shared/trip-lock.js` com `lockTripRow(tx, tripId)`, adquirido **dentro** de transações interativas curtas (`$transaction` com `timeout: 10_000`, `maxWait: 5_000`). `updateTrip` é transacional: lock → relê a linha → conta ofertas **pós-lock** → aplica a política → atualiza. A pesquisa captura a configuração antes do provedor, chama o provedor **fora** de qualquer transação e, só depois do retorno, abre a transação: lock → relê a config → compara com a capturada (divergente → `409`, nada persistido) → snapshot atômico.
- **Snapshot atômico**: `persistOfferSnapshot(tripId, offers, tx = prisma)` recebe o client transacional — ofertas e observações commitam ou roll back juntas; nenhuma gravação parcial. (**Comportamento anterior ao Dia 11.9**: o fallback `tx = prisma` foi removido — hoje `tx` é obrigatório e validado estruturalmente; ver §12.)
- **Simulador determinístico na rota**: `ORIGIN_HUBS` (hub aleatório) removido; origem e destino derivam do texto canônico por `deriveAirportCode` ("Curitiba, Paraná, Brasil" → `CUR`; "São Paulo, SP, Brasil" → `SOP`, pois o filtro `[A-Z]` remove o "ã"). Consulta sem `origin` lança `TypeError` (barreira, não inferência). `SIMULATED` preservado; IATA real permanece fora do escopo.
- **Validação (histórico do Dia 11.6)**: **188/188 testes** em 16 arquivos × 3 rodadas (175 → 188: +10 em `api.test.js` — origem, imutabilidade, corridas com provedor estacionado via promessas adiadas —, +2 no simulador, +1 de atomicidade do snapshot), rodada focada 45/45, `git diff --check` limpo, smoke real com trip com origem e pesquisa `CUR→LIS` (viagem de smoke removida do banco local). Esse total histórico antecede o Dia 11.9. O estado atual publicado em `81d5bb3` tem **343 declarações `test(...)` em 28 arquivos** (antes dos três arquivos novos, `a68bf73` tinha 335/25 e 336 resultados no runner; o Dia 11.9 em `7286454` tinha 306/307 e o D3 em `6abba27`, 322/323 — registros históricos). O runner não foi reexecutado nesta etapa documental; se o helper `tests/helpers/test-database-url.js` continuar sendo descoberto como arquivo sem declarações de teste, o total esperado é **344** (ver §12.1).

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
| Monitoramento — agendador (execuções programadas) | ✅ Implementado e testado (Dia 11.4, `83eb1ec`; OFF por padrão) |
| Monitoramento — recuperação de `RUNNING` órfão + timeout de shutdown | ✅ Implementado e testado (Dia 11.5, `e4109eb`) |
| Origem da viagem + imutabilidade de rota/período + serialização transacional | ✅ Implementado, testado e publicado (Dia 11.6, `fab9eac`) |
| Histórico de preços determinístico + decomposição opcional | ✅ Implementado, testado e publicado (Dia 11.9, `7286454`) |
| Integração **real** com provedores | ⚠️ **Adaptador experimental implementado; integração externa não validada e REAL bloqueado** (flag+chave apenas registram o adaptador; barreira fail-closed impede exposição/persistência REAL; D3 publicado em `6abba27`; validação manual e credenciais autorizadas ainda pendentes) |
| Contrato OpenAPI 3.1 + Swagger UI | ✅ **Implementado, corrigido e publicado em `a68bf73` (Fase 4)**; response schemas fechados, Swagger UI + JSON condicionados por `API_DOCS_ENABLED`; 12 operações documentadas (§14.13 e §14.14) |
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
│   │   ├── airports/         # resolver local (snapshot OurAirports + csv/build)
│   │   └── flight-providers/
│   │       ├── index.js      # registro de provedores (único ponto de extensão)
│   │       ├── normalize.js  # bruto → padrão canônico + garantia SIMULATED
│   │       ├── serpapi/      # adaptador experimental SerpApi/Google Flights
│   │       └── simulated/    # provedor externo simulado
│   ├── openapi/
│   │   └── schemas.js        # componentes/rotas do contrato OpenAPI 3.1
│   ├── shared/
│   │   ├── errors.js         # HttpError(statusCode, message)
│   │   └── uuid.js           # isUuid()
│   ├── app.js                # monta Fastify + /health + plugins no prefixo /trips
│   └── server.js             # bootstrap: listen → scheduler → handlers → shutdown gracioso
├── docs/ (contexto.md, relatorio-continuidade.md, Regras.md, archive/)
├── prisma/ (schema.prisma + 6 migrations)
├── prisma.config.ts          # conexão do CLI (tolerante a .env ausente)
├── tests/ (28 arquivos; estado publicado em `81d5bb3`: 343 declarações `test(...)`; o D3 em `a68bf73` tinha 25 arquivos / 335 declarações / 336 resultados no runner, o D3 em `6abba27` tinha 322/323 e o Dia 11.9 em `7286454`, 306/307 — ver §12.1)
├── docker-compose.yml · .env.example · README.md · package.json
```

### Endpoints (todos validados por testes)

| Método | Rota | Sucesso | Responsável |
|---|---|---|---|
| `GET` | `/health` | 200 | app.js |
| `POST` / `GET` | `/trips`, `/trips/:id` | 201/200/400/404 | trips.routes |
| `PUT` / `DELETE` | `/trips/:id` | 200/400/404 · 204 | trips.routes |
| `GET` | `/trips/:tripId/flights` | 200/404/409 | flights.routes (escreve snapshot; 409 sem origem ou config divergente) |
| `GET` | `/trips/:tripId/offers/history` | 200/400/404 | offers.routes (só leitura) |
| `GET` | `/trips/:tripId/analysis` | 200/400/404 | analysis.routes (só leitura) |
| `GET` | `/trips/:tripId/opportunities` | 200/400/404 | opportunities.routes (só leitura) |
| `POST` | `/monitoring/runs` | 200/409 | monitoring.routes (executae persiste) |
| `GET` | `/monitoring/runs` | 200/400 | monitoring.routes (só leitura) |

### Fluxo principal

```
GET /trips/:tripId/flights
  → flights.service busca Trip (404 se ausente) — id não-UUID é 400
  → GATE: trip.origin ausente → 409 (viagem legada não pesquisa)
  → captura config { origin, destination, departureDate, returnDate }
  → query = config + variationSeed
  → registro de provedores → simulated-airways.search() → ofertas BRUTAS
      (chamada externa FORA de qualquer transação/lock)
  → normalizeFlightOffer() → ofertas CANÔNICAS (SIMULATED obrigatória)
  → $transaction: lockTripRow (SELECT ... FOR UPDATE na linha de trips)
      → relê a config pós-lock → divergente → 409, nada persistido
      → trip ausente pós-lock → 404
  → modules/offers.persistOfferSnapshot(tripId, offers, tx)  ← atômico
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
  → recupera RUNNING com heartbeat expirado (FAILED + failure_reason)
  → INSERT monitoring_runs (RUNNING) — P2002 do índice parcial → 409
  → runMonitoringCycle (núcleo puro do 11.1):
      para cada viagem: heartbeat → evaluateTripActive → skip | search (escreve histórico)
      → opportunities (só leitura) → item OK | FAILED(stage)
  → UPDATE condicionado a status=RUNNING: COMPLETED (contagens+itens) ou FAILED
    (aborto); se a posse foi recuperada por outro processo → 409, sem sobrescrever
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
  → await scheduler.idle() com SHUTDOWN_TIMEOUT_MS (não aborta o ciclo; timeout → warn)
  → await app.close() → terminate(0); sinais repetidos = mesma promessa
```

**Padrão canônico de oferta** (definido em `normalize.js`): `{ provider, isSimulated, dataClassification, type, route, dates, flight, price, relatedQuery }` + `history: { observedAt, current, previous, best, trend }`.

---

## 4. Banco de dados

```text
trips (Trip)
  id uuid pk · name · destination · origin? · start_date date · end_date date · created_at · updated_at
  └─< flight_offers (FlightOffer) [trip_id FK, CASCADE]  @@unique(trip_id, external_key)
        id · trip_id · provider · data_classification · type · origin · destination ·
        departure_date · arrival_date · airline · flight_number · stops · cabin_class ·
        baggage_pieces · refundable · external_key · created_at · updated_at
        └─< price_history (PriceHistory) [offer_id FK, CASCADE] @@index(offer_id, observed_at, sequence)
              id · offer_id · currency · total · base? · taxes? · observed_at · sequence (BigInt único, interno)

monitoring_runs (MonitoringRun)  — sem FK: registro operacional, independente de viagens
  id uuid pk · status (RUNNING|COMPLETED|FAILED) · trigger (MANUAL|SCHEDULED) ·
  started_at · heartbeat_at · finished_at? · duration_ms? · trip_count ·
  monitorable_count · skipped_count · ok_count · failed_count · opportunity_count ·
  items jsonb · failure_reason?
  @@index(started_at)
  § índice parcial único: UNIQUE(status) WHERE status = 'RUNNING'  ← árbitro
```

**Migrations aplicadas**: `20261107211054_init_create_trips` (trips), `20261107214055_add_flight_offers_and_price_history` (flight_offers, price_history, FKs, índices), `20261109131507_add_monitoring_runs` (monitoring_runs + índice parcial único escrito na mão — Prisma não modela índice parcial), `20261109170000_add_monitoring_run_heartbeat` (heartbeat/failure_reason, com backfill), `20261111011707_add_trip_origin` (`origin` TEXT nullable, sem backfill — política do Dia 11.6) e `20261112000000_add_price_history_sequence_and_optional_breakdown` (Dia 11.9: sequence BIGINT + backfill + unique + base/taxes nullable + índice canônico).

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
| 11.4 (`83eb1ec`) | `modules/monitoring/scheduler.js` (novo), `config/env.js` (config do scheduler), `server.js` (startServer + wiring + shutdown; Fase B.1), `tests/{monitoring-scheduler,env,server-bootstrap}.test.js` (novos, 18/11/13), `README` (agendador), `.env.example` (2 variáveis), este relatório. **Sem migration, sem dependência nova e sem mudança de escopo do ciclo.** |
| 11.5 (`e4109eb`) | `prisma/schema.prisma` (+`heartbeat_at`, `failure_reason`), migration `20261109170000_add_monitoring_run_heartbeat`, `monitoring.service.js` (heartbeat + recuperação + posse), `server.js` (timeout do idle), `config/env.js` (`SHUTDOWN_TIMEOUT_MS`), `tests/monitoring-recovery.test.js` (novo, 5), `tests/{env,server-bootstrap,monitoring-endpoint}.test.js` (ajustes), README e `.env.example`. **Sem dependência nova.** |
| 11.6 (`fab9eac`) | `prisma/schema.prisma` (+`origin String?`), migration `20261111011707_add_trip_origin` (nova), `shared/trip-lock.js` (novo — `SELECT ... FOR UPDATE` na linha de trips), `modules/trips/trips.service.js` (create exige origem; `updateTrip` transacional com lock + política de imutabilidade), `modules/trips/trips.routes.js` (schemas POST/PUT separados), `modules/flights/flights.service.js` (gate 409 sem origem; transação pós-provedor com lock/comparação/snapshot), `modules/offers/offers.service.js` (`persistOfferSnapshot(tripId, offers, tx = prisma)`), `simulated-flight-provider.js` (rota determinística, `ORIGIN_HUBS` removido), `integrations/flight-providers/index.js` (contrato), `tests/{api,simulated-provider,offers-service,offers-history,monitoring-endpoint}.test.js` (+13 líquidos), README e este relatório. **Sem dependência nova.** |
| 11.8 (`c55238c`, publicado) | **Resolver de aeroportos**: `integrations/airports/{build-airport-snapshot.mjs,csv.js,airport-resolver.js,data/airports-snapshot.json}` (novos — snapshot OurAirports local, 4.008 aeroportos, sem rede em runtime; parser RFC-4180 próprio). **Adaptador experimental**: `integrations/flight-providers/serpapi/serpapi-flight-provider.js` (novo — fetch injetável, round-trip via `departure_token`, `return_date` na primeira requisição, expansão limitada 1–10). **Config**: `config/env.js` (+`SERPAPI_ENABLED`/`SERPAPI_API_KEY`/`SERPAPI_MAX_OUTBOUND_EXPANSIONS`, padrões D2/D4), `.env.example`. **Registro**: `integrations/flight-providers/index.js` (`buildFlightProviders` condicional por flag+chave; `configureFlightProviders`/`resetFlightProviders`). **Barreira**: `shared/real-barrier.js` (fail-closed compartilhada), `normalize.js` (validação booleana estrita) e `flights.service.js` (gate pré-provider + pós-normalização), `offers.service.js` (D5 fail-closed). **Testes**: `tests/{airport-resolver,serpapi-provider,flight-providers-registry,real-barrier,real-barrier-policy}.test.js` (novos) + `tests/{normalize,env}.test.js` (estendidos) + `tests/csv.test.js` (novo) + `tests/fixtures/serpapi-fixtures.js` (sintéticas, rotuladas). README + este relatório. **Sem migration, sem dependência nova, zero chamadas reais.** |
| 11.9 (`7286454`, publicado) | `prisma/schema.prisma` (`sequence BigInt @unique @default(autoincrement())`, `base Float?`, `taxes Float?`, índice composto), migration `20261112000000_add_price_history_sequence_and_optional_breakdown` (transação explícita, backfill `ROW_NUMBER`, `setval`, `OWNED BY`, unique index, troca de índice), `offers.service.js` (current canônico pós-escrita, `previous` com OR lexicográfico, `best` com desempate, projeções sem sequence), `price-metrics.js` (comentários da ordem canônica), `tests/{offers-service,offers-history,analysis-endpoint}.test.js` (regressões) e `tests/price-history-migration.test.js` (novo, 3 cenários). README e este relatório. **Sem dependência nova; sem liberar REAL.** |
| D3 (`6abba27`, publicado) | `serpapi-flight-provider.js` (2ª requisição = todos os parâmetros da 1ª + `type=1` explícito + `departure_token`; validação de `error`/`search_metadata.status` antes da extração; moeda efetiva em `search_parameters.currency` com falha para divergência de BRL; erros externos não propagados, com mensagens controladas e sanitização exata de `api_key`/`departure_token` literal e codificado; **token usado somente durante a expansão e removido dos raw offers por cópia, sem mutar as respostas originais**), `tests/fixtures/serpapi-fixtures.js` (status `Success`, `error`, moeda configurável), `tests/serpapi-provider.test.js` (+16 testes: 15 históricos do D3 + 1 do ajuste de remoção do token — contrato das duas requisições, erros 200/status (incluindo `Error` na 2ª requisição), `search_metadata` ausente, mercado vazio sem erro, token literal/codificado com e sem prefixo, `token=`, exceção de rede, sanitização, moeda e ausência do token no raw/normalizado), README e este relatório. **Sem migration, sem dependência nova, zero chamadas reais.** |

**Scripts npm atuais**: `start` · `dev` (`--watch`) · `start:no-env` · `db:migrate` (`migrate dev && generate`) · `db:deploy` (= `prisma migrate deploy`, também usado no CI) · `postinstall` (`prisma generate`) · `test` (`node --env-file=.env --test --test-force-exit --test-concurrency=1` — arquivos sequenciais porque todos compartilham o mesmo PostgreSQL).

---

## 6. Testes

**242/242 passando em 3 rodadas completas antes das correções** (arquivos sequenciais — ver Decisão 22): estado do Dia 11.8 (working tree). A suíte completa não foi reexecutada imediatamente após a segunda auditoria porque, **naquele momento**, não havia PostgreSQL comprovadamente descartável/isolado. **Estado naquele momento: 289 declarações em 22 arquivos; 208 casos puros distintos executados e passando; 228 execuções no recorte canônico (208 casos + 20 reexecuções do registro; execuções focais adicionais, como as 17 do bootstrap, não entram nesse total); 81 declarações não executadas por dependerem de PostgreSQL** (ver 11.4).

**Sequência posterior (11/11/2026)**: as 81 declarações pendentes — e a suíte inteira — foram executadas em um PostgreSQL 17 descartável e isolado, com **289/289 em duas rodadas completas** (0 falhas, 0 skipped, 0 cancelados, exit 0) após as 5 migrations; o ambiente foi removido em seguida. O registro completo está em **§11.6**. Nenhuma dessas execuções foi reproduzida pela auditoria final, que não repetiu a suíte porque o container temporário já havia sido removido; os números são os **efetivamente executados e reportados na etapa de validação**.

**Dia 11.9 (12/11/2026)**: a implementação original passou a ter **295/295 em 23 arquivos**, em **duas rodadas completas** no **PostgreSQL 18** descartável e isolado (`127.0.0.1:5544`) — execução da implementação original, **não** é validação em 17.11 —, com 0 falhas, 0 skipped e 0 cancelados. As 5 migrations antigas foram aplicadas primeiro no banco populado, o seed sintético foi inserido e a sexta migration foi aplicada pelo runner real; o banco vazio recebeu as 6 migrations pelo `prisma migrate deploy`. Após as correções pós-auditoria, a suíte passou a **298/298 em duas rodadas**, revalidada em **PostgreSQL 17.11** descartável (`127.0.0.1:5546`); o fechamento documental e as validações finais estão em **§12**.

**Fase 4 (16/11/2026)**: **332/332 execuções passando** na suíte completa (`node --test --test-force-exit --test-concurrency=1`), 0 falhas, 0 skipped, 0 cancelados, exit 0, com PostgreSQL da aplicação em `localhost:5433` e PostgreSQL descartável para a migration em `127.0.0.1:5544`. O recorte HTTP de contrato existente passou **52/52** e o novo `tests/openapi.test.js` passou **9/9**. O documento OpenAPI 3.1 foi validado com `@readme/openapi-parser@10.0.0`. **Após a correção pós-auditoria (§14.14), a suíte passou 336/336 e `tests/openapi.test.js` 12/12.**

**Fechamento do Dia 11.9 (13/11/2026)**: **306 declarações em 24 arquivos** (8 novas do resolvedor de `TEST_DATABASE_URL`), **307 execuções/307 em duas rodadas completas** em **PostgreSQL 17.11** descartável (`127.0.0.1:5544`, `tmpfs`, sem volume), exit 0. O runner conta 307 porque `tests/helpers/test-database-url.js` também é descoberto como arquivo sem declarações de teste; a soma por arquivo é 306. Registro completo, incluindo o experimento negativo do teste de concorrência, em **§12.1**.

| Arquivo | Testes | O que protege |
|---|---|---|
| `tests/api.test.js` | 24 | `/health`; CRUD completo (201/400 schema/400 domínio/404/204); UUID inválido → 400; pesquisa persiste snapshot com `SIMULATED`; 2ª pesquisa compara com a anterior e dedupe de ofertas; cascade de exclusão; **regressão: `/flights` com id não-UUID é 400, não 500**; **Dia 11.6: POST exige origin (ausente/vazia → 400); origin ecoada no POST/GET e preservada no PUT sem origin; viagem sem ofertas aceita qualquer alteração; viagem legada (criada direto no banco) responde 200 com `origin: null` mas não pesquisa (409, zero linhas); pesquisa usa a origem da viagem (query e rota derivada `SOP`); os 4 campos congelados após a 1ª oferta (409) com `name` editável; PUT durante pesquisa estacionada → pesquisa aborta 409 sem persistir nada e a alteração permanece; viagem deletada em voo → 404 pós-lock sem linhas órfãs; PUTs concorrentes sem ofertas serializados (estado final é exatamente um dos payloads); PUTs concorrentes com ofertas → ambos 409 com config preservada**; **fechamento do Dia 11.9: concorrência determinística — 1ª requisição parqueada dentro da transação após `lockTripRow` (`RowShareLock` em `trips` observado em `pg_locks`), 2ª bloqueada por ela (`pg_blocking_pids` + espera em `transactionid`, sem chegar à escrita), liberação e histórico íntegro (2 observações por oferta, `sequence` única); falha se `lockTripRow` for removido (experimento negativo executado)** |
| `tests/normalize.test.js` | 13 | padrão canônico completo; classificação REAL sem throw (**barreira realocada — Dia 11.8**); rejeição de oferta incompleta; **Dia 11.8: mapeador SerpApi (itinerário bruto → canônico, datas por dia, base/taxes `null`, price_insights em `relatedQuery.priceInsights` não persistido) e fallback ao formato simulado para stubs com nome arbitrário**; **pós-auditoria D1: `flight_number` ausente/null/vazio/whitespace/não positivo/artificial falha alto; válido (string e numérico) passa; espaços são normalizados**; `isSimulated` precisa ser booleano explícito |
| `tests/simulated-provider.test.js` | 5 | 3–5 ofertas; **datas ISO válidas (regressão do bug T010)**; identidade estável × preço variável por semente; **Dia 11.6: rota determinística (`CUR`/`LIS` derivados do texto canônico, origem e destino) e barreira `TypeError` para consulta sem origin** |
| `tests/offers-service.test.js` | 8 | `externalKey`; snapshot: `FIRST_OBSERVATION` → `UNCHANGED`, dedupe, `best`; **Dia 11.6: snapshot atômico — falha no meio da transação apaga também o que veio antes (oferta e observação do rollback)**; **pós-auditoria D5: oferta REAL chamada DIRETAMENTE → 503 antes da 1ª escrita (zero linhas); SIMULATED intacto pela defesa**; **fechamento do Dia 11.9: contrato do `tx` — ausência, nulo e client global rejeitados antes de qualquer operação; client estruturalmente inválido rejeitado; transação interativa real aceita** |
| `tests/offers-history.test.js` | 5 | endpoint de histórico: 404/400; vazio pré-pesquisa; consolidação após 2 pesquisas; cascade. **Fixture ajustada no Dia 11.6: viagem criada com origin (o endpoint pesquisa de verdade)** |
| `tests/price-metrics.test.js` | 33 | núcleo puro: limiares (10%/-10 e 9,99%), mediana sem o preço atual, `DROPPED`≠`OPPORTUNITY`, `ROSE`≠`ABOVE_HISTORY`, moeda mista, observações inválidas, ordenação/imutabilidade, centavos e meio centavo, teto de inteiro seguro, média de somas grandes, validação de `options`, empates de `observedAt` |
| `tests/analysis-endpoint.test.js` | 8 | endpoint de análise com **fixtures determinísticas**: 400/404 e rejeição de querystring; viagem sem ofertas; histórico insuficiente (inclui oferta sem histórico e observação inválida); as três classificações; identificação de dados simulados × reais; moeda mista; repetibilidade + ausência de escrita + contrato de `/offers/history` preservado |
| `tests/opportunities-policy.test.js` | 28 | política pura: portões (viagem, dado, comparabilidade, amostra, recência, classificação, piso), motivos e precedência, limites exatos do piso (R$ 99,99 × R$ 100,00) e de 24 h, ranking e limite por moeda, determinismo, imutabilidade, contabilidade fechada e validação da política; **regressões: piso fail-closed contra chaves herdadas de prototype (`constructor`) e `startDate` impossível ao calendário (`2027-13-45`, `2027-02-30`)** |
| `tests/opportunities-endpoint.test.js` | 5 | endpoint com fixtures determinísticas: 400/404 e rejeição de querystring; viagem sem ofertas; real × simulada × sem queda (motivos e contagens); lista vazia quando só há simulados; repetibilidade, ausência de escrita e contratos de `/analysis` e `/offers/history` preservados |
| `tests/opportunities-days.test.js` | 5 | redução pura de dias distintos: regressão da linha final inválida (não conta o dia do `current` como histórico), linhas inutilizáveis descartadas antes de eleger o `current`, entrada nula/vazia/sem histórico, `observedAt` inválido em qualquer posição |
| `tests/monitoring-core.test.js` | 12 | núcleo puro do ciclo: viagem iniciando hoje/executável, futura, inativa sem chamadas, nenhuma monitorável, lista vazia, contagem de oportunidades, falha isolada de pesquisa (oportunidades não chamadas), falha isolada de oportunidades (pesquisa conta), múltiplas misturadas com contagens fechadas, determinismo, imutabilidade+freeze, dependências/`now` inválidos (fail alto, zero chamadas) |
| `tests/env.test.js` | 18 | config do agendador: default OFF/900000; boolean estrito (`true`/`1`; `yes`/`sim` desativam com `warn`); intervalo inválido ignorado com OFF e fail-fast com ON; fronteiras 60000/86400000; **M2: rejeita `60000abc`, `60000.9`, `60000 0`**; **M3: isola e restaura `PORT`/`HOST`, sem vazamento do shell**; timeout de shutdown default 10000, fronteiras e fail-fast; **Dia 11.8: SerpApi default OFF com chave `null` e 1 expansão; boolean estrito com warn; chave trimmada e ausente→`null` com warn; expansões 1–10 com fail-fast D2 apenas com flag ativa** |
| `tests/monitoring-scheduler.test.js` | 18 | agendador: timer único e idempotente; D1 (nada antes do intervalo); after-complete sem sobreposição; 409 como skip; erro genérico não para a cadeia; stop em voo; `idle()`; logs sem duplicação; **M1: stop→start em voo mantém uma cadeia e zero timers no stop final**; **borda: tick que falha antes do 1º `await` não deixa ciclo fantasma**; **L1: logger quebrado não mata a cadeia nem gera `unhandledRejection`**; integração real: `defaultScheduledRun` grava `trigger: SCHEDULED` |
| `tests/server-bootstrap.test.js` | 17 | bootstrap: OFF nunca cria scheduler; ON inicia só após `listen` e usa o logger do Fastify; **providers configurados antes do listen; falha de configuração impede abrir a porta**; listen falhando → exit 1 sem factory/handlers; **L2: falha pós-listen (factory ou handlers) → stop + close + exit 1 com log da fase**; **L4: env incompleto falha antes de `createApplication`**; SIGTERM/SIGINT mesma sequência; shutdown idempotente; `close()` aguarda ciclo em voo; **L3: timeout do idle não retém o processo e registra warn**; `shutdownTimeoutMs` inválido falha antes do app; falha de `close`; `buildApp` real em porta 0; factory real com relógio falso |
| `tests/monitoring-endpoint.test.js` | 11 | persistência: POST grava run COMPLETED refletindo relatório (linha verificada no banco); POST valida body/query ({} ok); GET histórico real com ordem decrescente e limit; GET valida limit; GET rejeita item JSONB com propriedade desconhecida (500); **árbitro: RUNNING de outro processo → 409 e nenhuma segunda linha RUNNING**; 200+409 simultâneos com lock liberado depois; falha isolada por viagem com run COMPLETED; **ciclo abortado → run FAILED, finishedAt gravado, nenhum RUNNING órfão**; concorrência in-process (1 ciclo, 1 rejeição, 1 pesquisa); trigger fora do vocabulário → TypeError sem criar linha. **Fixture ajustada no Dia 11.6: viagens criadas com origin (o ciclo pesquisa de verdade)** |
| `tests/monitoring-recovery.test.js` | 5 | recuperação de órfã: heartbeat expirado → FAILED com `failureReason`; heartbeat recente preservado; `startMonitoringRun` recupera antes de criar nova execução; ciclo atrasado perde a posse e não sobrescreve a recuperação com COMPLETED; ciclo real renova o heartbeat DURANTE a execução (promessa adiada + marcador futuro — prova do `withHeartbeat`) |
| `tests/airport-resolver.test.js` | 14 | **Dia 11.8**: Curitiba→CWB (município, sem rede); Lisboa→LIS via alias curado (município é `Lisbon` na fonte); Madrid→MAD; São Paulo→GRU,CGH,VCP na ordem curada (VCP tem município Campinas — sem a tabela curada o natural jamais incluiria); normalização de acentos/caixa/espaços; IATA explícito; inexistente→`UNRESOLVED` sem inventar; ambígua→`UNRESOLVED` com candidatos (nunca o primeiro); aliases (Rio→GIG,SDU; Buenos Aires→AEP,EZE; lisbon); entrada curada inconsistente com snapshot lança erro alto (bug de manutenção, não filtragem silenciosa); **IATA duplicado → `AMBIGUOUS_IATA` com snapshot sintético injetado** (o conjunto real não tem duplicatas — fixture rotulada); `resolveIata` (válido/desconhecido/TypeError); `normalizeLocationText`; TypeError para vazio/não-texto |
| `tests/serpapi-provider.test.js` | 42 | **Dia 11.8 (zero chamadas reais — fetch injetado + fixtures sintéticas rotuladas)**: parâmetros da busca (IATAs resolvidos multi-aeroporto por vírgula, `type` 1/2, `currency=BRL`, data ISO); **kgmid preferido sobre IATA quando o resolver fornecer**; autenticação na query **e chave nunca em mensagens de erro** (rede/HTTP/JSON); round-trip = 2 requisições (1+1 token) combinando ida+retorno com preço do retorno (pendência documentada); expansão N=1 (default)/3/5/10 com fórmula `1 + tokens` e tokens escolhidos na ordem determinística; rejeição de N>10/N<10; determinismo em empate de preço; ida simples sem expansão (1 requisição); mercado vazio → `[]` válido; round-trip sem `departure_token` → erro (anomalia); HTTP 4xx/5xx com status sem chave; timeout (AbortController); JSON inválido; itinerário malformado; expansão de retorno vazia; localidade não resolvida; consulta inválida; construção sem chave/fetch → TypeError; `price_insights` como metadado no raw; **pós-auditoria D4: resposta mista com/sem token (sem-token sai da seleção); tudo-sem-token segue anomalia; tokens duplicados dedupados (uma requisição por token único); falha HTTP na 2ª requisição aborta tudo (sem oferta parcial)**; **D3: contrato completo da 1ª requisição (`engine`/`hl`/`gl`/`travel_class`/`type`/aeroportos/datas/moeda, sem `departure_token`/`booking_token`, uma única `api_key`) e da 2ª (todos os parâmetros da 1ª preservados + `type=1` explícito + token, sem `booking_token`); HTTP 200 com `error` não vazio falha (inclusive na expansão, abortando tudo); status `Success` case-insensitive aceito, `Processing`/`Queued`/`Error`/desconhecido falham; `search_metadata` ausente tolerado; mercado vazio com `Success` e sem erro = `[]`; mensagens não expõem `api_key`/URL/`departure_token`; moeda BRL normalizada, USD falha, ausência usa fallback BRL, divergência na 2ª resposta falha**; **ajuste de confidencialidade: token usado na 2ª requisição e removido de `outbound`/`return`/`extra` do raw offer, campos restantes preservados, respostas originais não mutadas e normalização sem token**; **correção pós-auditoria: status `Error` na 2ª requisição aborta tudo (sem resultado parcial, sem segredo); `departure_token` com caracteres especiais (`+ / = & espaço %`) transmitido percent-encoded e recuperado íntegro, com `api_key` única e sem vazamento em erro**; **segunda auditoria de confidencialidade: texto externo de `error` e de rede não é propagado; token literal, percent-encoded, sem prefixo e sozinho, `token=`, URL e `api_key` não aparecem; status desconhecido e moeda divergente não são ecoados; 41/41 focados** |
| `tests/flight-providers-registry.test.js` | 10 | **Dia 11.8**: registro padrão só simulado; sem chave → SerpApi não registrado mesmo com flag ativa; flag desativada com chave → não registrado; flag+chave → registrado como `isSimulated: false`/`rawFormat: 'serpapi'`; classificação REAL sempre do registro, nunca dos dados; **pós-auditoria D7: configuração explícita via `configureFlightProviders(env)`/`resetFlightProviders`, independente de `process.env`; memoização comprovada; flag ON e OFF herméticos; `enabled` só aceita boolean true; chave vazia/espaços não registram** |
| `tests/real-barrier.test.js` | 4 | **Dia 11.8 (com banco)**: provedor REAL stub → 503 ANTES da transação, zero linhas em `flight_offers` e `price_history`; controle positivo (SIMULADA equivalente persiste normalmente); provedor misto (SIMULADO+REAL) → 503 e nada persiste; **pós-auditoria D6: provider REAL com contador — NUNCA executa (zero chamadas externas), 503, zero linhas** |
| `tests/real-barrier-policy.test.js` | 8 | **Terceira/quarta auditoria (puro, client falso)**: D6 exige provider objeto com `name` não vazio, `search` função e `isSimulated === true`; cobre provider malformado, array, lista vazia, lista mista, contadores de `trip.findUnique`/counts/transação/search e caso positivo SIMULATED executando `provider.search()` exatamente uma vez; D5 cobre REAL, UNCLASSIFIED, classificação ausente, flags nulas/numéricas/string, elementos nulos/array, lista vazia sem escrita e entrada não-array; fluxo SIMULATED válido continua persistindo |
| `tests/price-history-migration.test.js` | 3 | **Dia 11.9**: migration em banco vazio (sequence inicia em 1, nullable, índices), em banco populado (backfill determinístico por `offer_id`/`observed_at`/`id`, unicidade, preservação de linhas, próxima inserção acima do máximo) e atomicidade (falha antes do `COMMIT` desfaz coluna, backfill, nulabilidade e índices). **Pós-auditoria:** verifica `OWNED BY` via `pg_get_serial_sequence`, default `nextval` e remoção da sequência criada no rollback. **Fechamento do Dia 11.9:** conexão exclusiva por `TEST_DATABASE_URL` (resolvida antes de qualquer `new Client`), e atomicidade de **dados** — quantidade, IDs, `total`, `base` e `taxes` idênticos após a falha, sem inserção/remoção parcial |
| `tests/test-database-url.test.js` | 8 | **Fechamento do Dia 11.9 (puro, sem banco)**: `TEST_DATABASE_URL` ausente/vazia falha antes de conectar; URL malformada rejeitada sem ecoar o valor; protocolo inválido; banco sem nome; destino sem `test` no nome (banco de desenvolvimento); URL equivalente à `DATABASE_URL` rejeitada mesmo com nome de teste e sem vazar credenciais; destino explícito aceito |
| `tests/openapi.test.js` | 12 | **Fase 4 + correção A1–A4**: OpenAPI 3.1 válido (`@readme/openapi-parser`); exatamente as 12 operações canônicas com `operationId` único, tags, summaries e descriptions; respostas JSON com descrição e exemplo; componentes nomeados (`Trip`, `ErrorResponse`, `ValidationIssue`, etc.) e refs resolvíveis; schemas fechados e única permissividade dinâmica em `ValidationIssue.params`; `CurrencyFloors` como mapa; três variantes de `MonitoringItem` e validação das três; `RelatedQuery.priceInsights` fechado nos quatro campos conhecidos; `ValidationError` removido; `ErrorResponse` exige apenas `statusCode`/`error`/`message`; `Trip` preserva `createdAt`/`updatedAt`, `origin` nulo e campos fechados; documento sem `servers`, segredos, hosts ou URLs; `/documentation` e `/documentation/json` 200 com CSP local quando habilitados e 404 por padrão; `API_DOCS_ENABLED` estrito; erro HTTP real serializa sem campos opcionais falsos; erro de validação expõe os cinco campos de `ValidationIssue` |
| `tests/csv.test.js` | 19 | **Dia 11.8 (pós-auditoria D2)**: parser CSV estrito — vírgulas citadas, aspas escapadas, multilinha, CRLF/LF, BOM, linhas em branco, campos vazios, linha sem newline; falhas com linha no erro: aspa em posição inválida (`ab"cd`), citação nunca fechada, conteúdo após fechamento (`"abc"x`), colunas excedentes/ausentes, linha só de espaços, entrada não-string, malformação no meio do arquivo (nada engolido); **cabeçalho correto após linhas vazias iniciais (`\n\na,b\n1` → cabeçalho linha 3, registro linha 4)**; amostra real do formato OurAirports |

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
29. **Heartbeat é a posse (Dia 11.5)**: cada execução renova `heartbeat_at` antes/depois de cada trabalho externo; `RUNNING` sem heartbeat por 30 min é recuperado como `FAILED` por `UPDATE` condicional. A recuperação roda antes de cada execução e é idempotente entre processos. Os desfechos também são condicionais a `status=RUNNING`: um ciclo atrasado que perdeu a posse recebe `409` e nunca converte uma recuperação em `COMPLETED`. A alternativa de recuperar todo `RUNNING` no boot foi rejeitada porque poderia roubar um ciclo legítimo de outro worker. **Limitação de clock skew (registrada, não é bug confirmado no deployment atual)**: o limiar de staleness é calculado no relógio do processo e comparado contra `heartbeat_at` que pode ter sido gravado por outra instância; em multi-host com relógios dessincronizados, uma instância com relógio adiantado poderia recuperar prematuramente uma execução legítima de outra. O pressuposto operacional atual é deployment single-instance ou hosts com relógios sincronizados; não há tratamento específico de clock skew nesta implementação, e a limitação permanece arquitetural documentada. **Efeitos parciais de posse perdida (inerentes ao desenho de lease)**: um ciclo pode ter persistido ofertas/observações antes de perder a posse; quando recuperado, o status final é `FAILED` com `failureReason` de perda de posse e **não há rollback** das gravações já realizadas — a recuperação do registro não desfaz operações de negócio, e a consistência dessas gravações depende das garantias dos serviços de persistência individuais (não existe rollback global automático do ciclo)
30. **Timeout do shutdown não aborta o ciclo (Dia 11.5)**: `SHUTDOWN_TIMEOUT_MS` limita apenas a espera por `idle()`; se expirar, o processo encerra e a linha eventualmente `RUNNING` é recuperada pelo heartbeat na execução seguinte. Abortar o provedor exigiria `AbortController` atravessando service/provedores — mudança estrutural fora deste escopo. Isso preserva a regra de não interromper trabalho em voo e evita processo retido indefinidamente
31. **`origin` nullable no banco, sem backfill (Dia 11.6)**: inventar origem para viagens legadas (ex.: hub fictício `GRU`) registraria nas respostas uma informação que nunca existiu e associaria a origem errada ao histórico. Novos cadastros exigem origem no POST (schema dedicado); PUT a torna opcional (ausente = preserva a armazenada), então uma viagem legada pode receber origem enquanto não tiver ofertas. Viagem sem origem responde normalmente (GET/PUT/DELETE), mas **não pesquisa** (`409`) — uma pesquisa exigiria inferir a origem e o histórico resultante ficaria permanentemente desprovido de significado
32. **Rota e período congelados após a primeira oferta (Dia 11.6)**: o `externalKey` das ofertas inclui rota e `departureDate`; alterar `origin`/`destination`/`startDate`/`endDate` sob a mesma viagem misturaria históricos de rotas/períodos diferentes e invalidaria `previous`/`best`/`trend`. A política é aplicar no PUT (`409` com mensagem explicando "crie outra viagem"), `name` permanece editável e a comparação normaliza as datas para ISO (yyyy-mm-dd), igual à persistência — a mesma alteração de rota/período continua sendo respeitada quando a viagem ainda não tem ofertas
33. **Serialização por linha com `SELECT ... FOR UPDATE` (Dia 11.6)**: um único lock compartilhado (`shared/trip-lock.js`) disputado pela pesquisa e pelo PUT fecha as duas janelas de corrida — PUT commita primeiro → a pesquisa relê a config pós-lock, diverge e aborta com `409` sem persistir; pesquisa commita primeiro → o PUT pós-lock conta as ofertas visíveis e aplica a imutabilidade (`409`). O lock é sempre adquirido **dentro** de uma transação interativa curta e **nunca** é mantido durante a chamada externa ao provedor (a transação abre só depois do retorno). Sob READ COMMITTED (default), a leitura imediatamente pós-lock vê a versão mais recente commitada — nível de isolamento mais forte não é necessário com esse desenho
34. **Transação abre somente após o provedor; snapshot atômico (Dia 11.6)**: a chamada externa fica fora de qualquer transação (latência de rede não segura lock nem transação). `persistOfferSnapshot` ganhou parâmetro transacional (`tx = prisma` — **comportamento anterior ao Dia 11.9**; o fallback foi removido e `tx` passou a ser obrigatório, ver §12): dentro da transação da pesquisa, ofertas e observações commitam ou roll back juntas — nenhum snapshot parcial. Um throw `HttpError(409)` dentro da transação aborta tudo. Testado por falha proposital no meio do snapshot (offer inválida depois da primeira gravada → rollback total)
35. **Simulador deriva origem e destino do texto canônico (Dia 11.6)**: fim dos hubs aleatórios (`ORIGIN_HUBS`) — a mesma consulta sempre produz a mesma rota e, portanto, o mesmo `externalKey` (a identidade determinística estendida à origem). `deriveAirportCode(locationText)` filtra `[A-Z]` ("São Paulo" → `SOP`, pois o "ã" não sobrevive ao filtro) e **não é código IATA real** — a resolução em aeroportos reais permanece pendente para o provedor real. Consulta sem `origin` lança `TypeError`: falha alta de bug de chamada, nunca inferência silenciosa. `SIMULATED` permanece classificado pelo registro/normalizador
36. **Corridas testadas por provedor estacionado, não por sleeps (Dia 11.6)**: provider fake com promessas adiadas (`ready` sinaliza config capturada; `release` devolve ofertas da config antiga) torna as corridas pesquisa × PUT determinísticas e rápidas; o teste da viagem deletada em voo prova `404` pós-lock e zero linhas órfãs; PUTs concorrentes provam serialização por estado final (sempre exatamente um dos payloads completos, nunca mistura). **Sem janela concreta de TOCTOU na auditoria do Dia 11.6**: `updateTrip` adquire `lockTripRow` (em transação) **antes** de contar ofertas e atualizar a viagem; `searchFlightsForTrip` usa o mesmo lock antes de comparar a config e persistir o snapshot, com `persistOfferSnapshot` recebendo o client transacional no único caminho de produção; `deleteTrip` coordena-se via row-lock exclusivo implícito do PostgreSQL, que conflita com `FOR UPDATE` (delete primeiro → 404 pós-lock; delete depois → cascade sobre ofertas já commitadas). Qualquer PUT entre a leitura inicial e o lock da pesquisa, ou durante a chamada externa, é fechado pela comparação pós-lock. **Limitações residuais (arquitetural/disponibilidade, não corrida)**: (1) a disciplina de bloqueio depende de todo futuro caminho de escrita respeitar o protocolo compartilhado — o banco não tem trigger que imponha a regra a escritas diretas fora do service; (2) contenção acima do `maxWait` (5 s) aborta a transação interativa e, com o tratamento atual, vira `500` — degradação de experiência de erro, sem falha de integridade identificada
37. **Barreira REAL realocada, não removida (Dia 11.8)**: com o adaptador SerpApi produzindo ofertas REAL de verdade, o normalizador passou a CLASSIFICAR REAL (mapeadores por provedor com fallback ao formato simulado) e o BLOQUEIO de exposição/persistência virou `HttpError(503)` em `flights.service.js`, pós-normalização e ANTES da transação — nenhuma linha é escrita. A liberação de REAL aos usuários é uma decisão explícita futura; a classificação continua honesta e registrada
38. **Resolver é agnóstico e sem rede em runtime (Dia 11.8)**: snapshot LOCAL do OurAirports (domínio público; 4.008 aeroportos com serviço comercial regular + IATA; SHA-256 e data das fontes nos metadados; regeneração por script de manutenção). `ident` é a chave canônica e o IATA é atributo (nunca primária). Localidade com múltiplos aeroportos comerciais é `UNRESOLVED`/`AMBIGUOUS_LOCATION` com candidatos — **nunca** o primeiro match; entrada curada inconsistente com o snapshot é bug de manutenção e falha alto. IATAs duplicados não existem no conjunto filtrado: o teste usa snapshot sintético injetado (rotulado). Tabela curada precede o casamento natural (município exato normalizado + país) e cobre grafias divergentes (Lisboa→`Lisbon`) e multi-município (São Paulo inclui VCP/Campinas; EZE com município `Buenos Aires (Ezeiza)` seria perdido pelo natural)
39. **SerpApi experimental por desenho (Dia 11.8)**: registro condicional (flag `SERPAPI_ENABLED` estrita + chave presente; sem nenhum dos dois o provedor não existe para a aplicação); chave fechada na closure; erros externos não propagados e mensagens controladas, com `api_key` e `departure_token` tratados como dados sensíveis e nunca expostos em mensagens/logs; `fetch` injetável (testes 100% offline com fixtures sintéticas rotuladas — nenhuma resposta apresentada como real); round-trip em 2 requisições via `departure_token` com expansão limitada `SERPAPI_MAX_OUTBOUND_EXPANSIONS` (1–10, default 1; `requisições/ciclo = 1 + tokens`); seleção determinística por preço/duração/hora/companhia preserva comparabilidade histórica; round-trip sem token é anomalia (erro alto), não mercado vazio; ida simples não expande
40. **Semânticas não assumidas (Dia 11.8)**: `price_insights` é metadado de contexto do Google (`relatedQuery.priceInsights`, não persistido — `FlightOffer` não tem coluna) e NUNCA se mistura ao `PriceHistory` por oferta; o preço do round-trip combinado usa o preço do retorno da 2ª resposta (pendência registrada: a semântica exata do total combinado será confirmada com fixtures reais); base/impostos não decompostos pelo SerpApi são persistidos como `NULL` (schema do Dia 11.9), sem conversão para zero; a semântica comercial da decomposição continua pendente antes de liberar REAL; horários dos legs são locais sem offset — as datas normalizadas usam apenas o dia (YYYY-MM-DD), parseável por `new Date()` na persistência
41. **Ordem canônica do histórico (Dia 11.9)**: `observedAt` é a chave principal e `sequence` só desempata timestamps iguais — nunca o contrário. A migration usa `ROW_NUMBER() OVER (ORDER BY offer_id, observed_at, id)` e `setval` (vazio: 1/is_called=false; populado: MAX/is_called=true); `previous` usa `OR` lexicográfico explícito, não `sequence < current.sequence` isolado. `base`/`taxes` são opcionais e preservados como `NULL`; `sequence` é BigInt interno e todas as respostas usam projeção explícita, sem espalhar o registro Prisma.

---

## 8. Pendências e riscos (estado atual)

**Débitos técnicos:**
- Sem linting/formatter
- **Branch protection não confirmada**: o check do CI aparece no PR, mas exigir o job `Testes (Node 24 + PostgreSQL 17)` em Settings → Branches (para bloquear merge automaticamente) depende de configuração no GitHub não verificável por API sem autenticação
- Sem CORS/rate limit (API escuta em `0.0.0.0` no dev)
- Credenciais triviais do banco no compose (aceitável só para dev local)
- `docker-compose` sem limites de recurso

**Funcionalidades incompletas (planejadas, não implementadas):**
- **Exposição de ofertas REAL aos usuários**: o adaptador SerpApi existe e é testável, mas a barreira 503 (duas camadas em `flights.service.js`) impede qualquer exposição/persistência REAL — liberação é decisão explícita futura. **D3 publicado em `6abba27`** (contrato da 2ª requisição + validação de resposta + moeda; §13); a **validação manual com conta autorizada** permanece pré-requisito da liberação REAL e foi detalhada no protocolo da Fase 5 (§15.4)
- **Semântica exata do preço de round-trip do SerpApi** e decomposição base/impostos: pendências registradas (Decisão 40), a confirmar com fixtures reais
- **kgmid/códigos de metrópole no resolver**: o adaptador aceita `kgmid` nos matches, mas o resolver ainda só devolve IATA (códigos de cidade são suporte futuro)
- **Cobertura parcial da expansão de round-trip**: por desenho, expandir apenas N itinerários de ida (default 1) não cobre todas as combinações ida × volta (custo por requisição)
- Análise limitada a uma oferta por vez, sem comparação entre ofertas/provedores, sem recorde/queda acumulada e sem janela temporal
- Agente de IA, notificações, hotéis/veículos/atividades, publicação

**Limitações conhecidas da análise (documentadas na resposta):**
- `PriceHistory.sequence` é uma sequência global interna e só desempata `observedAt` iguais; ela não é uma cronologia independente e não é exposta na API
- Série com moedas misturadas não é comparada: fica `INSUFFICIENT_DATA` + `MIXED_CURRENCY`
- Com 3 observações anteriores a mediana é um dos próprios valores; não há intervalo de confiança
- Preços do provedor simulado são independentes entre si: nenhum limiar pode ser calibrado com eles (a classificação é validada por fixtures)

**Bugs conhecidos:** nenhum aberto. O único bug real já registrado (datas `Invalid` no simulador) foi corrigido no Dia 6 com regressão.

**Riscos residuais do monitoramento (Dia 11.3; recuperação implementada no 11.5):**
- Se o banco cair **exatamente na finalização**, a linha ainda pode ficar RUNNING (o UPDATE de desfecho falhou e o erro original é preservado deliberadamente). A diferença é que ela não fica bloqueada para sempre: o próximo ciclo com heartbeat expirado a converte em FAILED e segue. O atraso é de até `staleAfterMs` (30 min) mais o intervalo do scheduler; não há limpeza manual obrigatória.
- A recuperação é **lazy** (antes da próxima execução), não no boot. Um RUNNING fresco de um processo que acabou de morrer ainda pode causar 409 até o heartbeat expirar. Um provedor que passe mais de 30 min sem renovar heartbeat também pode ser tratado como órfão; o limite é conservador e coberto por teste.
- Sem alerta de execução FAILED/órfã (notificações pertencem a outro escopo).
- **Clock skew multi-host**: o limiar de staleness usa o relógio do processo contra `heartbeat_at` que pode ter sido gravado por outra instância; pressuposto single-instance/relógios sincronizados — detalhe na Decisão 29 (limitação arquitetural, não bug no deployment atual).

**Riscos e dívidas residuais do agendador (Dia 11.4/11.5):**
- **Timeout não aborta o ciclo**: `SHUTDOWN_TIMEOUT_MS` evita que o processo fique retido, mas o trabalho em voo é interrompido pelo encerramento do processo, não por cancelamento cooperativo. A linha é recuperada pelo heartbeat na execução seguinte; `AbortController` continua sendo dívida estrutural.
- **Testabilidade do timeout do shutdown**: `waitForSchedulerIdle` usa `setTimeout` real (não injetável), e o teste correspondente depende de um prazo curto de tempo real. O comportamento atual é **funcional**; injeção de relógio ou mecanismo de timeout determinístico pode ser considerada como futura melhoria de testabilidade. Implementação **não alterada** nesta etapa (débito registrável, não bloqueante).
- **Listeners de sinal não são removidos e `app.close()` externo não para o scheduler (L4)**: hoje não há caminho concreto (um bootstrap por processo; o scheduler só nasce em `startServer`). Se o bootstrap for reutilizado no mesmo processo, convém guardar/remover handlers e adicionar hook `onClose` ou `dispose()`
- **Sinais de SO reais não são exercitáveis neste Windows/Git Bash**: `timeout`/`kill` entregam TerminateProcess; a lógica é coberta com `EventEmitter` injetado e chamada direta de `shutdown()`, e o smoke ON real encerra pela função retornada. Validação de SIGTERM real fica para Linux/CI

**Riscos e dívidas residuais da serialização/imutabilidade (Dia 11.6):**
- **Ofertas legadas com rota de hub antigo**: ofertas persistidas antes do Dia 11.6 levam `route.origin` de hub fictício (`GRU`, `GIG`...) derivado aleatoriamente; a viagem correspondente, sem `origin` no banco, nunca mais pesquisa (`409`), então essas ofertas ficam **permanentemente sem nova observação** (o histórico congela). Decisão consciente: sem backfill, nenhuma origem inventada — registro no relatório em vez de dado fabricado.
- **Disciplina de bloqueio é arquitetural, não imposta pelo banco**: não existe janela concreta de TOCTOU nos caminhos atuais de produção (Decisão 36 — PUT, pesquisa e DELETE coordenam-se pelo mesmo row-lock). O resíduo é que um **futuro** caminho de escrita direta em `trips` fora do service contornaria o protocolo, pois não há trigger no banco impondo a regra.
- **Contenção extrema → 500**: espera acima do `maxWait` da transação interativa (5 s) aborta a operação e, com o tratamento atual, vira resposta `500` em vez de `409` — limitação de disponibilidade/experiência de erro, não de integridade.
- **`AbortController` estrutural** e **posse perdida sem rollback** seguem nas Decisões 29/30 — a pesquisa transacional do Dia 11.6 não muda esse quadro (o provedor continua interruptível apenas pelo encerramento do processo; a transação aborta por divergência de config, não por cancelamento).
- **Checksum da migration 11.3**: o banco local registrava um checksum de uma versão anterior de `20261109131507_add_monitoring_runs` (o arquivo commitado é estável). O checksum local foi alinhado ao SHA-256 do arquivo sem resetar dados; `migrate dev --create-only` confirmou o schema em sincronia. CI com banco limpo não é afetado.

---

## 9. Próximas etapas (ordem recomendada)

| Ordem | Tarefa | Dependência |
|---|---|---|
| 1 | ✅ **Concluído — revisão, commit e push do Dia 11.4** (agendador + hardening + documentação), commit `83eb1ec` | Dias 11.1–11.3 |
| 2 | ✅ **Concluída e publicada — Dia 11.5** (correção de cobertura com o 5º teste de recovery provando renovação de heartbeat em ciclo real, finalização documental, commit e push): commit `e4109eb`, CI success | 1 |
| 3 | ✅ **Concluída e publicada — Dia 11.6** (origem no Trip + imutabilidade de rota/período + serialização transacional): commit `fab9eac`, `main == origin/main` | 2 |
| 3.5 | ✅ **Publicado — Dia 11.8 em `c55238c` + segunda auditoria + correções + validação PostgreSQL** (resolver OurAirports + adaptador experimental SerpApi + feature flags + barreira fail-closed D5/D6; correções D1/D2/D4/D5/D6/D7 aplicadas; D3 registrada como validação pré-liberação REAL — seção 11). **289 declarações em 22 arquivos; 208 casos puros executados e passando no recorte canônico; validação PostgreSQL descartável com 289/289 em duas rodadas completas** (§11.6). A auditoria final pré-consolidação emitiu **APROVADO COM RESSALVAS**; a única pendência impeditiva — o registro da validação no relatório — foi fechada nesta atualização documental. **Checkpoint concluído:** commit e push realizados; o Dia 11.8 foi publicado em `c55238c`. D3 e Fase 4 avançaram em etapas posteriores. | 3 |
| 3.6 | ✅ **Publicado - Dia 11.9 em `7286454`** (sequence determinística + base/taxes opcionais + migration atômica + **306 declarações em 24 arquivos / 307/307 em duas rodadas** após as correções pós-auditoria; o runner reporta 307 porque o helper `tests/helpers/test-database-url.js` é descoberto como arquivo sem declarações de teste - ver §12.1). **D3 implementado em 13/11/2026 (registro histórico do working tree em §13); checkpoint concluído:** publicado em `6abba27` (CI success, run `43788295629`). A validação manual com conta autorizada permanece pendente (§15.4). | 3.5 |
| 4 | ✅ **Fase 4 implementada e corrigida em 16/11/2026 (registro histórico em §14.13/§14.14); checkpoint concluído:** publicada em `a68bf73` — OpenAPI 3.1 + Swagger UI (contrato formal, schemas de resposta/erro fechados, documentação interativa, gate `API_DOCS_ENABLED` e testes de validade). CI #14 success | D3 publicado (`6abba27`) |
| 5 | **Fase 5 — preparação para integração real**: planejamento concluído em 16/11/2026 (§15), com protocolo D3, semântica de preço pendente, custos, jurídico e critérios de liberação. `REAL` continua bloqueado; não é uma liberação | Código publicado em `a68bf73`; decisão do usuário |
| 6 | Publicação da API (Dockerfile, env de produção, migrations no deploy, TLS/CORS/rate limit) | 2–5 + decisão de plataforma |

---

## 10. Instruções para retomada

**Leia antes de implementar**: `docs/contexto.md` (requisitos e regras) · `apps/api/src/app.js` · `modules/flights/flights.service.js` (gate de origem + transação pós-provedor) · `shared/trip-lock.js` (lock de linha compartilhado) · `modules/offers/offers.service.js` · `modules/trips/trips.service.js` (create/update + política de imutabilidade) · `modules/analysis/price-metrics.js` (cabeçalho com critérios, arredondamento e limitações) · `modules/analysis/analysis.service.js` · `modules/monitoring/monitoring-core.js` (núcleo puro do ciclo + contrato) · `modules/monitoring/monitoring.service.js` (lock + árbitro + persistência) · `modules/monitoring/scheduler.js` (after-complete, single chain, `idle()`) · `server.js` (`startServer`, wiring pós-listen, shutdown) · `config/env.js` (scheduler OFF/fail-fast) · `integrations/flight-providers/index.js` + `normalize.js` (contrato exige `origin` na prática) · `prisma/schema.prisma`.

**Não alterar sem necessidade**: `docs/contexto.md` · porta 5433 (PostgreSQL nativo do Windows na 5432) · barreira anti-`REAL` · estado JS ESM puro (sem TS/tsx) · contrato de provedores.

**Preservar**: separação rota/service; nenhuma consulta ao banco em rotas; `SIMULATED` classificada no normalizador; provedor simulado puro (persistência em `modules/offers`); identidade por `externalKey`; tendências do banco; dependências mínimas justificadas; **`price-metrics.js` é núcleo puro aprovado** — não introduzir Prisma, relógio ou I/O nele; **`monitoring-core.js` é núcleo puro aprovado** (mesma regra) e `evaluateTripActive` segue sendo A ÚNICA regra de viagem monitorável; análise/oportunidades são somente leitura e não são recomendação de compra; **lock de linha sempre dentro de transação curta e nunca durante chamada externa** (Dia 11.6); **sem backfill fictício de `origin`**.

**Ambiente**:

```bash
npm install          # já roda prisma generate (postinstall)
docker compose up -d # banco na porta 5433
cp .env.example .env
npm test             # exige TEST_DATABASE_URL (banco de testes isolado, diferente do banco da aplicação); ver README › Testes
npm run dev          # servidor com recarga
curl http://localhost:3000/health → {"status":"ok","service":"trippulse-api"}
```

> **Snapshot atual**: API com 12 endpoints, 4 tabelas/models (trips, flight_offers, price_history, monitoring_runs; `origin` é coluna de trips), **343 declarações de teste em 28 arquivos no commit publicado `81d5bb3`** (antes, `a68bf73` tinha 25 arquivos / 335 declarações / 336 resultados no runner; o D3 em `6abba27` tinha 322/323 em 24 arquivos e o Dia 11.9 em `7286454`, 306/307 — registros históricos; o runner não foi reexecutado após os novos testes; a diferença histórica de 1 entre declarações e resultados ocorria porque o helper `tests/helpers/test-database-url.js` é descoberto pelo padrão de arquivos de teste e contabilizado como arquivo sem declarações de teste — §12.1; 0 abertos; Dias 1–10 e 11.1–11.5 validados pelo CI; **11.3 em `46acf4a`, 11.4 em `83eb1ec`, 11.5 em `e4109eb`, 11.6 em `fab9eac`, todos publicados**). **Dia 11.8 publicado em `c55238c`** (CI success, run `43106273261`): **resolver de aeroportos agnóstico** (`integrations/airports/` — snapshot local OurAirports em domínio público com 4.008 aeroportos comerciais, `ident` canônico, tabela curada para multi-aeroporto/grafias divergentes, `UNRESOLVED` explícito para ambiguidade/inexistência, sem rede em runtime, regeneração por script de manutenção com proveniência SHA-256); **adaptador experimental SerpApi/Google Flights** (`flight-providers/serpapi/` — `fetch` nativo injetável, round-trip via `departure_token`, expansão limitada `SERPAPI_MAX_OUTBOUND_EXPANSIONS` 1–10 com fórmula `1 + tokens`, seleção determinística, erros externos não propagados e mensagens controladas (sem `api_key`, `departure_token` ou URL), erros HTTP/timeout/JSON/vazio tratados, fixtures 100% sintéticas — zero chamadas pagas); **feature flags** (`SERPAPI_ENABLED` default `false` estrito D4, `SERPAPI_API_KEY` opcional, `SERPAPI_MAX_OUTBOUND_EXPANSIONS` default 1 com fail-fast D2) e **registro condicional** (`buildFlightProviders`: sem flag+chave o provedor não existe; simulado continua o padrão); **barreira REAL realocada** — o normalizador agora classifica REAL (mapeadores por provedor + fallback simulado para stubs); o bloqueio pré-provider é `HttpError(503)` antes de qualquer operação Prisma (inclusive `trip.findUnique`), com barreira pós-normalização e D5 na persistência. O teste com banco que cobre zero linhas em `flight_offers`/`price_history` **foi reexecutado na validação PostgreSQL descartável (289/289 em duas rodadas completas — §11.6)**; o recorte puro também cobre o gate e os contadores. Pendências registradas: semântica do preço de round-trip, base/impostos `NULL` persistidos, kgmid/códigos de metrópole no resolver, cobertura parcial da expansão, `price_insights` isolado do `PriceHistory`. 208 casos puros executados (228 execuções no recorte canônico); suíte completa com **289/289 em duas rodadas** na validação PostgreSQL descartável (§11.6), encerrando as 81 declarações antes pendentes, módulos novos validados isoladamente, `git diff --check` limpo, **sexta migration** (Dia 11.9) e sem dependência nova. **Dia 11.9**: migration em banco vazio e populado, **307/307 em duas rodadas** após as correções pós-auditoria e `prisma migrate diff` sem diferença; **publicado em `7286454`**. Débitos anteriores do 11.5/11.6 permanecem válidos (Decisões 29/30/36). Naquele ponto (registro histórico), o Git estava em `main == origin/main == 7286454`, com working tree = D3 + documentação (nada staged). **D3 local (13/11/2026 — registro histórico, já superado):** contrato das duas requisições, validação de resposta, moeda e confidencialidade de erros; **41 testes no provider (39 antes dos 2 testes de confidencialidade) e 318/318 na suíte completa antes dos 4 testes pós-auditoria** em PostgreSQL 17 local; a validação manual com conta autorizada já era pendência naquele momento e continua pendente. A primeira auditoria independente do D3 foi **APROVADA COM RESSALVAS** e a segunda **NÃO APROVADA** por vazamento de `departure_token`; as correções de confidencialidade e os testes correspondentes foram aplicados e o D3 foi depois publicado em `6abba27` (322/323 em 24 arquivos), concluindo o ciclo auditoria → commit → push. **Os números de 41 e 318/318 são históricos e não descrevem o estado atual**, que é 335 declarações/336 resultados em `a68bf73` (início deste Snapshot). Depois: liberação de REAL com decisão explícita (semântica de preço, base/impostos, Legal Shield/ToS — só Production+; litígio Google v. SerpApi com leave to amend ~01/12/2026).

---

## 11. Auditoria independente do Dia 11.8 e correções pós-auditoria (11/11/2026)

### 11.1 Parecer da auditoria

Auditoria READ-ONLY independente concluída com parecer **APROVADO COM RESSALVAS**. Estado Git confirmado íntegro (`main == origin/main == fab9eac`; 9 modificados + 10 não rastreados; staging e stash vazios). Nenhum achado crítico ativo; rastreamento de fluxo confirmou que todo caminho de persistência de ofertas passa por `searchFlightsForTrip`. Ressalvas D1–D7 registradas abaixo e tratadas.

### 11.2 Correções aplicadas (working tree, sem staging/commit/push)

- **D1 — `flight_number` obrigatório** (`normalize.js`): nova função `requireSerpApiFlightNumber` — aceita inteiro positivo finito ou string não vazia após trim; rejeita 0, negativos, NaN/Infinity e literais artificiais; ausente/`null`/vazio/whitespace falha alto (nunca vira `"undefined"` artificial, pois compõe o `externalKey`). Testes: 4 regressões (5 casos) em `tests/normalize.test.js`.
- **D2 — parser CSV estrito** (`airports/csv.js`): aspa só abre campo no início; citação aberta no EOF, aspa em posição inválida (`ab"cd`) e conteúdo após fechamento (`"abc"x`) falham com o número da linha; contagem de colunas validada contra o header (linha incluída no erro). **Verificação empírica anterior (histórico)**: uma execução anterior relatou 86.351 registros e reprodução 1:1 do snapshot (4.008 aeroportos; countries idênticos). Essa comparação **não é reproduzível apenas com os arquivos atuais**, pois os CSVs originais não estão versionados; o snapshot NÃO foi reescrito nesta etapa. Testes: `tests/csv.test.js` (19 testes, incluindo cabeçalho após linhas vazias).
- **D5 — defesa em profundidade FAIL-CLOSED** (`offers.service.js`): `persistOfferSnapshot` chama `assertOnlySimulatedOffers()` antes de `observedAt` e de qualquer operação no client. Só passa oferta com `dataClassification === 'SIMULATED'` **e** `isSimulated === true`; REAL, UNCLASSIFIED, classificação ausente/desconhecida e flags ausentes/inconsistentes recebem 503. Testes: 2 com banco em `tests/offers-service.test.js` + 4 puros D5 em `tests/real-barrier-policy.test.js` (client falso, lista vazia sem escrita, entrada não-array, elementos nulos/array e prova de zero chamadas).
- **D6 — bloqueio pré-provider** (`flights.service.js`): com a barreira ativa, qualquer provider sem `isSimulated === true` **não executa** — o gate `503` acontece antes de qualquer operação Prisma, inclusive `trip.findUnique`, das queries de contagem e de qualquer `provider.search` (nenhuma chamada externa paga, nem em pesquisa manual nem no ciclo do agendador). A barreira pós-normalização permanece como defesa adicional. Testes: 8 puros em `tests/real-barrier-policy.test.js` (estrutura `name`/`search`/`isSimulated`, lista vazia, lista mista, contadores de `trip.findUnique`/counts/transação/search e caso positivo SIMULATED que executa `provider.search()` exatamente uma vez) + teste com banco em `tests/real-barrier.test.js` (contador = 0).
- **D7 — config no boot e registro memoizado** (`flight-providers/index.js`): a validação SerpApi já acontece no boot (`startServer` → `loadEnv()`); o registro efetivo agora é construído **uma vez** (`getFlightProviders` memoiza `buildFlightProviders`), eliminando o reavaliamento por pesquisa (warnings repetidos e 500 tardio). `buildFlightProviders(env)` permanece injetável; `configureFlightProviders(env)`/`resetFlightProviders()` permitem testes herméticos; a configuração ocorre **antes do `listen()`**. A camada de ambiente normaliza texto explicitamente permitido (`true`/`1`) para boolean; `buildFlightProviders()` recebe configuração tipada e só aceita `enabled === true` (valores explícitos `1`, `'true'` ou `'false'` não habilitam). A chave exige string não vazia. Testes: memoização, flags ON/OFF, tipos inválidos, chave vazia/espaços e bootstrap em `tests/{flight-providers-registry,server-bootstrap}.test.js`.
- **D4 — round-trip documentado e dedup** (`serpapi-flight-provider.js`): dedup determinístico de `departure_token` duplicado (ordena, mantém a 1ª ocorrência, corta em `maxOutboundExpansions`); comentários documentam o descarte silencioso de idas sem token quando outras têm token, o aborto total na falha da 2ª requisição e a cobertura parcial. Estratégia determinística inalterada. Testes: 4 novos em `tests/serpapi-provider.test.js` (resposta mista; tudo-sem-token segue anomalia; tokens duplicados; falha HTTP na expansão aborta tudo).

### 11.3 D3 - contrato da 2ª requisição (implementado localmente em 13/11/2026)

Na auditoria do Dia 11.8, os parâmetros exigidos pelo SerpApi na 2ª requisição do round-trip (a que envia `departure_token`) **não podiam ser confirmados sem conta autorizada** e os testes usavam fixtures sintéticas que aceitavam qualquer parâmetro. O D3 foi implementado localmente (§13): a 2ª requisição passou a preservar todos os parâmetros da 1ª pesquisa e a acrescentar `type=1` explícito + `departure_token` (Alternativa B, coerente com o exemplo oficial), com testes de contrato, validação de `error`/status e moeda efetiva. **A validação manual com conta autorizada permanece pendente** (protocolo R1–R7; cenário GRU→LIS) e é pré-requisito da liberação REAL; nenhuma chamada real foi feita nesta etapa.

### 11.4 Validação pura — estado ANTERIOR à validação PostgreSQL (histórico)

- **Estado desta rodada (histórico, anterior à validação PostgreSQL)**: testes puros **208 casos distintos/208 passando** — 100 (csv/normalize/serpapi/registry/airport/env) + 100 (monitoring-core/price-metrics/opportunities-policy/opportunities-days/simulated-provider/server-bootstrap) + 8 (real-barrier-policy). **Execuções no recorte canônico: 228** (208 casos + 20 reexecuções do registro; a execução focal de `server-bootstrap` é uma reexecução e não entra nesse total). O segundo grupo exige `DATABASE_URL` fictícia **apenas para importar Prisma**; nenhuma conexão é aberta. Suíte com banco **NÃO reexecutada nesta rodada**: naquele momento não havia PostgreSQL comprovadamente descartável/isolado. Declarações: **289 em 22 arquivos, das quais 81 dependentes de PostgreSQL ainda não executadas**. **Superado em 11/11/2026**: essas 81 foram executadas em ambiente descartável, com **289/289 em duas rodadas** (§11.6).
- `git diff --check`: limpo. Nenhuma migration (5 mantidas), nenhuma dependência nova, nenhuma chamada real à SerpApi, nenhuma credencial real.
- Barreira REAL: ativa em duas camadas (+ defesa em profundidade na persistência); fluxos SIMULATED íntegros; snapshot de aeroportos NÃO reescrito.

### 11.5 Segunda auditoria independente — correções fail-closed (working tree)

A segunda auditoria emitiu parecer **REPROVADO naquele momento**, condicionado à correção dos achados abaixo. Todos foram corrigidos na sequência (D5/D6 fail-closed, normalização estrita, D1 complementar, D2, D4/`return_date` e D7). A auditoria final pré-consolidação reconheceu as correções, **aprovou o gate D6** e emitiu **APROVADO COM RESSALVAS**, apontando como única pendência impeditiva o registro da validação PostgreSQL no relatório — **fechada em §11.6**. Nenhuma alteração foi staged, commitada ou enviada; nenhuma migração, dependência ou chamada externa foi adicionada.

- **D5 fail-closed** (`shared/real-barrier.js` + `offers.service.js`): a persistência agora exige simultaneamente `dataClassification === 'SIMULATED'` e `isSimulated === true`. REAL, UNCLASSIFIED, classificação ausente/desconhecida, `isSimulated` false/ausente/não booleano e listas mistas falham com 503 **antes de qualquer operação no client** (inclusive o primeiro `findUnique`). Testes puros com client falso comprovam zero chamadas.
- **D6 fail-closed** (`shared/real-barrier.js` + `flights.service.js`): o provider precisa ser objeto válido, ter `name` string não vazia, `search` função e `isSimulated === true`. Provider malformado, lista vazia e lista mista bloqueiam com 503 antes de qualquer operação Prisma, inclusive `trip.findUnique`, e de `provider.search`. O teste conta `trip.findUnique`, counts, transação e busca; o caso positivo SIMULATED comprova que a consulta da viagem é alcançada e que `provider.search()` executa exatamente uma vez. A barreira pós-normalização permanece.
- **Normalização sem truthiness** (`normalize.js`): `isSimulated` precisa ser booleano explícito; `'false'`, `'true'`, `1`, `0`, objeto, `null` e ausente falham alto.
- **D1 complementar**: `flight_number` aceita inteiro positivo finito ou string não vazia após trim; rejeita 0, negativos, `NaN`, `Infinity`, `'null'`/`'undefined'`/`'0'` e normaliza espaços nas extremidades.
- **D2**: o parser atualiza a linha do registro também em linhas vazias e usa a linha real do primeiro registro como cabeçalho; `parseCsv('\n\na,b\n1')` identifica cabeçalho na linha 3 e registro na linha 4. O gerador aceita `AIRPORT_SNAPSHOT_GENERATED_AT`, ordena sem `localeCompare` e recusa sobrescrita com dados diferentes sem `--force`.
- **D4/return_date**: round-trip envia `type=1`, `outbound_date` e `return_date` na primeira requisição; one-way mantém `type=2` sem `return_date`. O D3 (implementado localmente em 13/11/2026, §13) fixou a 2ª requisição com os mesmos parâmetros da 1ª + `type=1` explícito + `departure_token`; a validação manual com conta autorizada permanece pendente.
- **D7**: o registro efetivo é configurado por `configureFlightProviders(env)` **antes do `listen()`** (falha de configuração impede abrir a porta) e resetável apenas para testes; `getFlightProviders()` continua memoizado. `enabled` exige boolean `true` e chave string não vazia; os testes usam configuração explícita e passam com flag ON/OFF, sem depender do `process.env` externo. `buildFlightProviders(env)` permanece injetável.

**Validação**: **208 casos puros distintos executados e passando**; **228 execuções no recorte canônico** (208 casos + 20 reexecuções do registro; reexecuções focais de `server-bootstrap` não entram nesse total); **289 declarações em 22 arquivos, das quais 81 dependentes de PostgreSQL ainda não executadas neste ponto**. A suíte com banco não foi reexecutada imediatamente após as correções por ausência, naquele momento, de PostgreSQL comprovadamente descartável/isolado — quadro **superado** pela validação descartável (§11.6), com 289/289 em duas rodadas. `git diff --check` limpo; sem migrations novas (5 mantidas), sem dependência nova e sem chamadas reais à SerpApi.

**Snapshot**: `apps/api/src/integrations/airports/data/airports-snapshot.json` está **versionado** desde `c55238c` (Dia 11.8 publicado), com 4.008 aeroportos, 249 países e SHA-256 `ea91fc83a17a9a85d19b9e14b18112aa42f87b966b0407d0348d7d938c00e2e6`; não foi reescrito no Dia 11.9.

### 11.6 Validação PostgreSQL descartável e fechamento documental (11/11/2026)

Registro da validação que executou efetivamente as 81 declarações antes pendentes (§6, §9, §11.4 e §11.5). Os resultados abaixo foram **executados e reportados na etapa anterior**; a auditoria final pré-consolidação **não repetiu a suíte** porque o ambiente temporário já havia sido removido. Não há log ou artefato persistido no repositório além deste registro — os números são os reportados pela execução.

**Ambiente**

| Item | Valor |
|---|---|
| Servidor | PostgreSQL **17.11** |
| Imagem | `postgres:17-alpine` (previamente disponível no cache local) |
| Container temporário | `trippulse-test-pg` |
| Banco | `trippulse_test` |
| Endereço | `127.0.0.1:5544` |
| Armazenamento | `tmpfs` (sem volume persistente) |
| Volumes persistentes | zero |
| Credenciais | sintéticas, usadas apenas no container temporário |
| Container de desenvolvimento | `trippulse-db` permaneceu **parado** durante toda a execução |

**Migrations**

- **5/5 migrations aplicadas** no banco descartável.
- `prisma migrate status` → `Database schema is up to date!`
- **5 registros concluídos** em `_prisma_migrations`.
- Nenhuma migration nova foi criada ou alterada: as 5 são as já existentes na `main`.

**Suíte completa**

Duas execuções completas, sequenciais:

| Indicador | Resultado |
|---|---:|
| Declarações de teste | 289 |
| Arquivos | 22 |
| Primeira rodada | 289/289 |
| Segunda rodada | 289/289 |
| Falhas | 0 |
| Skipped | 0 |
| Cancelados | 0 |
| Exit code | 0 |

Comando: `npm test`
Script efetivo: `node --env-file=.env --test --test-force-exit --test-concurrency=1`

As variáveis de ambiente **do processo** apontaram para o banco temporário (`DATABASE_URL` para `127.0.0.1:5544/trippulse_test`), prevalecendo sobre o `.env`; **o `.env` não foi modificado**. A contagem de 289 confere com a soma das declarações por arquivo da tabela do §6.

**Isolamento e limpeza**

- Banco temporário confirmado como alvo efetivo da suíte (isolamento por variável de ambiente de processo, não por edição de `.env`).
- Container de desenvolvimento `trippulse-db` **não utilizado** e mantido parado.
- Container `trippulse-test-pg` **removido** ao final.
- Porta **5544 liberada**.
- Volume de desenvolvimento `trippulse_trippulse-db-data` **preservado**.
- **Nenhuma alteração em arquivos de código, testes, snapshot, migrations, schema, dependências ou configuração operacional.**

**Observação não bloqueante**: restou **1 linha em `monitoring_runs`** no banco descartável ao final da execução — resíduo do próprio teste com banco, sem efeito sobre o volume de desenvolvimento e eliminado junto com o container.

**Sequência histórica consolidada**: 81 declarações dependentes de PostgreSQL pendentes (§6/§11.4) → ambiente PostgreSQL 17 descartável e isolado → 5 migrations aplicadas → **289/289 em duas rodadas** → remoção do ambiente → auditoria final pré-consolidação **APROVADO COM RESSALVAS** (código e os 26 arquivos consistentes; pendência apenas documental) → **este fechamento documental**, que registra a validação e encerra a ressalva.

**Escopo preservado**: a aprovação do Dia 11.8 **não** libera o provider REAL. **D3 foi implementado localmente** (validação manual com conta autorizada pendente; §13), nenhuma chamada real à SerpApi foi feita e nenhuma credencial real foi utilizada. O Dia 11.8 foi publicado em `c55238c` e o Dia 11.9 em `7286454`; **à época desta seção** o 11.9 permanecia no working tree, sem staging, commit ou push (o D3 posterior está registrado no §13).

---

## 12. Dia 11.9 — histórico determinístico e decomposição opcional (12/11/2026)

**Implementação (publicada em `7286454`; à época, working tree sem staging/commit/push)**:

- **Schema/migration**: `PriceHistory.sequence BigInt @unique @default(autoincrement())`, `base Float?`, `taxes Float?` e índice composto `@@index([offerId, observedAt, sequence])`. A sexta migration (`20261112000000_add_price_history_sequence_and_optional_breakdown`) é transacional (`BEGIN`/`COMMIT`), bloqueia a tabela durante o backfill, usa `ROW_NUMBER() OVER (ORDER BY offer_id, observed_at, id)`, inicializa a sequência com `setval` nos dois casos, associa com `OWNED BY`, cria o índice único e troca o índice antigo. Nenhuma tabela foi recriada.
- **Serviço**: `persistOfferSnapshot` consulta `current` **depois** da escrita pela ordem `observedAt DESC, sequence DESC`; `previous` usa `OR` lexicográfico explícito; `best` ordena por `total ASC, observedAt ASC, sequence ASC`; `listOfferHistoryForTrip` ordena por `observedAt ASC, sequence ASC` e calcula `best` com desempate explícito. As respostas usam DTO/projeção sem `sequence`; `base`/`taxes` nulos não são convertidos em zero. Após a auditoria, `persistOfferSnapshot` passou a exigir explicitamente o client transacional, sem fallback para o Prisma global.
- **Correções pós-auditoria (12/11/2026)**: removido o fallback `tx = prisma`; a função valida o client transacional antes de qualquer operação e o fluxo de produção continua passando o `tx` que segura `lockTripRow`. Documentada a distinção entre o `observedAt` de captura do snapshot e o `current.observedAt` canônico. Corrigido o comentário de `normalizeObservations` no núcleo puro. Os testes da migration passaram a verificar `OWNED BY`, default `nextval` e remoção da sequência no rollback; foram adicionados testes de ausência de `tx`, múltiplas ofertas e concorrência HTTP. Nenhuma migration, schema, ordem canônica, barreira REAL ou dependência foi alterada.
- **Núcleo puro**: `price-metrics.js` continua sem Prisma/relógio/I/O e recebe a série já canônica; apenas os comentários de contrato foram alinhados ao novo desempate.
- **Documentação**: README atualizado (ordem, nulos, `sequence` interna, snapshot de aeroportos versionado em `c55238c`) e este relatório corrigido quanto ao Dia 11.8 publicado.

**Migration e equivalência**

| Verificação | Resultado |
|---|---|
| `prisma validate` | schema válido |
| `prisma generate` | client 7.10.1 gerado |
| `prisma migrate deploy` em banco vazio | 6/6 aplicadas; `Database schema is up to date!` |
| `prisma migrate diff --from-config-datasource --to-schema` | `No difference detected` |
| Banco populado (5 migrations + seed + 6ª) | 4 linhas preservadas; sequence 1–4; próxima inserção = 5; `base`/`taxes` nullable |
| Teste de atomicidade | falha antes do `COMMIT` desfez coluna, backfill, nulabilidade e índices |

**Testes**

- Focados: **24/24** (`offers-service`, `offers-history`, `analysis-endpoint`, `price-history-migration`) após as correções pós-auditoria.
- Suíte completa: **298/298 em duas rodadas** (23 arquivos, 0 falhas, 0 skipped, 0 cancelados, exit 0) em PostgreSQL 17.11 descartável e isolado, com `DATABASE_URL` de processo apontando para `127.0.0.1:5546`; o `.env` não foi alterado e o PostgreSQL de desenvolvimento na 5432/5433 não foi usado.
- Cobertura nova: `sequence` gerada/única; backfill vazio e populado; `current` não é a recém-inserida; `previous` composto; empate de `observedAt`; `best` com desempate; `base`/`taxes` nulos; JSON sem `sequence`/BigInt; `persistOfferSnapshot` exigindo `tx`; rollback com múltiplas ofertas; `observedAt` de captura distinto de `current.observedAt`; `OWNED BY`/default/rollback da sequência; concorrência HTTP serializada; D5/D6/D7, SIMULATED, monitoramento, scheduler, atomicidade e isolamento de `PriceInsights` preservados.

**Git**: branch `main`, HEAD/origin `7286454` (Dia 11.9 publicado); à época desta seção o 11.9 estava no working tree, nada staged, nenhum commit/push/amend. **Pendências**: validação manual do D3 com conta autorizada (implementação local no §13); sem liberação de REAL, OpenAPI, Dockerfile, CORS, rate limit ou mudança de provider.

### 12.1 Fechamento da verificação de encerramento (13/11/2026)

Registro das correções pedidas pela verificação de fechamento e das validações executadas **nesta etapa**. Os números de §12 (295/298) são de execuções **anteriores** e permanecem como registro histórico: 295/295 em **PostgreSQL 18** (`127.0.0.1:5544`) e 298/298 em **PostgreSQL 17.11** (`127.0.0.1:5546`). Nenhum resultado de PG18 é reapresentado como PG17.11.

**Ambiente desta execução**

| Item | Valor |
|---|---|
| Servidor | PostgreSQL **17.11** (`SHOW server_version` → `17.11`) |
| Imagem/container | `postgres:17-alpine` em `trippulse-test-11-9-pg` |
| Endereço | `127.0.0.1:5544` |
| Armazenamento | `tmpfs` (sem volume persistente) |
| Bancos | `trippulse` (aplicação), `trippulse_test_migration` (`TEST_DATABASE_URL`), `trippulse_empty_test`, `trippulse_populated_test` |
| Banco de desenvolvimento | `trippulse-db` (`0.0.0.0:5433`) **não utilizado**; `.env` não alterado |
| Container de auditoria anterior | `trippulse-audit3-pg17` (`5548`) não utilizado |

**Implementações**

- **Contrato de transação** (`offers.service.js`): `assertTransactionClient` documentada como validação **apenas estrutural** (rejeita ausência, não-objeto, `prisma` global e delegates ausentes) e explicitamente incapaz de provar transação ativa, origem Prisma ou aquisição de lock. Documentado o contrato do chamador (`$transaction` → `lockTripRow` → comparação da configuração → `persistOfferSnapshot`, tudo na mesma transação). A exportação de `persistOfferSnapshot` foi mantida (chamador de produção em outro módulo + testes), com o contrato e a superfície de acesso documentados; nenhum mecanismo artificial foi introduzido.
- **Concorrência determinística** (`tests/api.test.js`): a primeira requisição é parqueada **dentro** da transação, depois de `lockTripRow`, na primeira escrita em `flight_offers` (conexão de controle com `LOCK TABLE flight_offers IN SHARE MODE`). A disputa é provada por observação real: `pg_locks` (`RowShareLock` em `trips` = `SELECT ... FOR UPDATE` executado) e `pg_stat_activity`/`pg_blocking_pids` (a segunda espera em `transactionid` bloqueada pelo pid detentor do lock, sem chegar à escrita). `Promise.all` não é mais usado como evidência.
- **Atomicidade de dados no rollback** (`price-history-migration.test.js`): 3 linhas com IDs/`total`/`base`/`taxes` capturados antes da falha e comparados por `deepEqual` depois — além das verificações de schema (coluna/sequência ausentes, nulabilidade original, índice antigo presente, índices novos ausentes).
- **Isolamento** (`tests/helpers/test-database-url.js` + 8 testes puros): `TEST_DATABASE_URL` exclusiva, sem fallback; validação **antes** de qualquer conexão; rejeita ausência, URL malformada, protocolo inválido, banco sem `test` no nome e URL equivalente à `DATABASE_URL`; erros não imprimem credenciais.
- **CI** (`.github/workflows/ci.yml`): `TEST_DATABASE_URL` no job, banco `trippulse_test_migration` criado no serviço efêmero `postgres:17-alpine` e `db:deploy` nos dois bancos antes de `npm test`; validações existentes preservadas.
- **Documentação**: as referências a `tx = prisma` foram marcadas como comportamento **anterior ao Dia 11.9**; a contradição PG18 × PG17.11 foi corrigida em §6.

**Testes e validações (resultados efetivos desta execução)**

| Verificação | Resultado |
|---|---|
| Testes puros de `TEST_DATABASE_URL` | **8/8** |
| Conjunto focado (api, offers-service, offers-history, analysis-endpoint, migration, helper) | **56/56**, exit 0 |
| Suíte completa, 1ª rodada | **307/307**, 0 falhas, 0 skipped, 0 cancelados, exit 0 |
| Suíte completa, 2ª rodada | **307/307**, 0 falhas, 0 skipped, 0 cancelados, exit 0 |
| Experimento negativo (sem `lockTripRow`) | teste de concorrência **falhou** (`Timeout aguardando lock da viagem + parqueamento...`) — detecta a ausência do lock |
| Migration em banco vazio (`trippulse_empty_test`) | 6/6 aplicadas pelo runner; sequência `last_value=1, is_called=false`; `base`/`taxes` nulos; índices corretos |
| Migration em banco populado (`trippulse_populated_test`) | 5 migrations + seed (5 linhas) + 6ª pelo runner; backfill `1..5` na ordem canônica; próxima inserção = `6`; 6/6 sequências únicas |
| Rollback com dados | linhas/IDs/valores idênticos; schema original restaurado |
| `prisma migrate status` | `Database schema is up to date!` (6 migrations) |
| `prisma validate` | schema válido |
| `prisma migrate diff --from-config-datasource --to-schema` | `No difference detected` (exit 0) |
| `git diff --check` | exit 0 (apenas avisos de CRLF) |

**Contagem**: 306 declarações `test(...)` em 24 arquivos; o runner reporta **307** porque `tests/helpers/test-database-url.js` (módulo auxiliar sob `tests/`) também é descoberto como arquivo sem declarações de teste (1 execução). O total por arquivo soma 306.

**Estado do D3 publicado em `6abba27`**: **322 declarações `test(...)` em 24 arquivos** e **323 resultados no runner** — 306 publicadas em `7286454` + 11 testes do D3 + 2 testes de correção pós-auditoria (status `Error` na 2ª requisição e codificação do `departure_token` especial) + 2 testes de confidencialidade da segunda auditoria (token literal/codificado, sem prefixo, `token=` e exceção de rede) + 1 teste do ajuste de remoção do token dos raw offers. A diferença de 1 entre declarações e resultados continua sendo o helper descoberto como arquivo sem declarações de teste. Esse total foi publicado no commit `6abba27` e validado pelo CI (run `43788295629`, success); o commit anterior `7286454` permanece com 306/307.

**Ambiente de teste da migration**: `trippulse_test_migration` recebeu as 6 migrations; o teste cria e remove apenas schemas temporários próprios, sem tocar `public`.

**CI**: revisão estática do workflow (Actions não é executado localmente). `TEST_DATABASE_URL` é definida no job, o banco isolado é criado antes do deploy e `npm test` herda as duas variáveis; `DATABASE_URL` nunca é usada pelo teste da migration.

**Git (à época desta execução)**: branch `main`, HEAD `c55238c`; o Dia 11.9 foi posteriormente publicado em `7286454`. Nada staged, nenhum commit/push/amend/reset/stash/clean nesta etapa. Container descartável removido ao final; `/var/lib/postgresql/data` em `tmpfs` e nenhum volume criado.

---

## 13. D3 — segunda requisição da SerpApi com `departure_token` (13/11/2026)

**Base anterior**: `72864543a36babdf2522af32558b524e2b2447a7` (Dia 11.9), com `main == origin/main` e CI success (run `43460301273`). O D3 foi implementado localmente em 13/11/2026 e **publicado** no commit `6abba27d15f6500f8d3aa12b0f7479b6d3161137` (`feat: complete SerpApi departure token expansion`; CI success, run `43788295629`). Este §13 preserva o registro da implementação e das auditorias, agora parte do commit publicado.

**Contrato da 1ª requisição (round-trip)**: `engine=google_flights`, `hl=pt-BR`, `gl=br`, `currency=BRL`, `travel_class=1`, `type=1`, `departure_id`/`arrival_id` resolvidos localmente (IATA ou `kgmid`, múltiplos por vírgula), `outbound_date` e `return_date` em `YYYY-MM-DD`; `api_key` anexada exclusivamente por `performRequest`. One-way mantém `type=2` e não envia `return_date`.

**Contrato da 2ª requisição (Alternativa B)**: `{ ...parâmetros da 1ª, type=1, departure_token }`. Nenhum parâmetro é removido; `type=1` é explícito (não depende do default); `booking_token` nunca é enviado; `api_key` aparece uma única vez e só dentro de `performRequest`. É o padrão do exemplo oficial do SerpApi (preservar `params` e atualizar `type`/`departure_token`).

**Validação de resposta (antes de `extractItineraries`, nas duas requisições)**:

- HTTP não-2xx: erro com status, sem corpo e sem URL/chave (comportamento preservado).
- HTTP 200 com `error` não vazio: falha do provedor — nunca mercado vazio; o texto externo **não** é propagado (mensagem controlada).
- `search_metadata.status` presente: aceito somente `Success` (case-insensitive); `Processing`, `Queued`, `Error` e desconhecido falham por segurança. Status desconhecido não é ecoado.
- `search_metadata` ausente: tolerado.
- Mercado vazio (`[]`): somente sem `error` e sem status de falha.
- 2ª resposta sem itinerários: anomalia (erro).
- Falha em qualquer expansão: aborta a busca inteira; sem resultados parciais, retries ou backoff.
- **Política de confidencialidade:** o texto bruto de `error` e de exceções de rede não é propagado; mensagens são controladas pela aplicação, preservam contexto e status HTTP conhecido e nunca expõem `api_key`, `departure_token` (literal ou codificado) ou URL completa. O corpo bruto da resposta não é registrado. `api_key` e `departure_token` são tratados como dados sensíveis.

**Moeda**: `search_parameters.currency` presente é normalizado para maiúsculas; divergência de `BRL` falha alto (sem conversão e sem mistura no histórico); ausente usa `BRL` como fallback apenas porque a requisição enviou `currency=BRL`. O raw offer carrega a moeda validada.

**Token no raw offer**: o `departure_token` é usado somente durante a expansão (2ª requisição). Depois dela, os raw offers são montados a partir de cópias de `outbound` e `return` sem essa propriedade e sem `departure_token` em `extra`; os objetos originais recebidos da SerpApi não são mutados. A normalização e a persistência continuam sem transportar o campo. A validação integrada de logs e resposta HTTP permanece pendência para a etapa anterior à liberação de REAL.

**Testes**: `tests/serpapi-provider.test.js` passou de 26 para **41 testes** no D3 (15 novos: 11 do D3 + 2 de correção pós-auditoria + 2 de confidencialidade da segunda auditoria) e recebeu **+1 teste** no ajuste de remoção do token, totalizando **42**. A cobertura inclui contrato completo das duas requisições, presença/ausência de parâmetros, `departure_token` (literal e percent-encoded, com e sem prefixo, `token=` e valor isolado), `booking_token` (apenas ausência nas requisições; não há teste de remoção do raw), `api_key` sem duplicação/vazamento, exceção de rede com URL/dados sensíveis, `error` em HTTP 200 (inclusive na expansão), status `Success`/`Processing`/`Queued`/`Error`/desconhecido (inclusive `Error` na 2ª requisição; desconhecido sem eco), `search_metadata` ausente, mercado vazio sem erro, sanitização, moeda (BRL/minúsculas, USD sem eco do valor externo, ausente, divergência na 2ª resposta) e remoção do `departure_token` do raw sem mutação/preservação dos demais campos. Resultados: **42/42 focados após o ajuste** (41/41 na auditoria anterior; 39 antes dos 2 testes de confidencialidade) e **318/318 na suíte completa antes dos 4 testes pós-auditoria** (0 falhas, 0 skipped, 0 cancelados); a suíte completa **não foi reexecutada** após as correções — os 318/318 permanecem como medição anterior, não reproduzida nesta etapa. `git diff --check` limpo. A suíte usou o PostgreSQL local de desenvolvimento (`trippulse-db`, 5433) e o banco descartável de teste da migration em `trippulse-audit3-pg17` (`TEST_DATABASE_URL`, 5548); a **sexta migration, já publicada no commit `7286454`**, foi aplicada ao banco local `trippulse-db` via `npm run db:deploy` (`prisma migrate deploy`). **Nenhum arquivo de schema ou migration foi criado ou alterado durante o D3** — nenhuma migration nova e nenhuma alteração em `schema.prisma` ou em migrations existentes. **Zero chamadas reais à SerpApi; nenhuma credencial real.**

**Arquivos alterados (somente)**: `apps/api/src/integrations/flight-providers/serpapi/serpapi-flight-provider.js`, `tests/fixtures/serpapi-fixtures.js`, `tests/serpapi-provider.test.js`, `README.md` e este relatório. Sem alteração em D5/D6/D7, persistência, `normalize.js`, `flights.service.js`, schema, migrations, `.env` ou dependências; REAL continua bloqueado.

**Limitações**: a validação manual com conta autorizada segue pendente (mínimo estimado de 2 requisições pagas — 1 busca inicial + 1 expansão; recomendado 3, incluindo cenário negativo; cenário GRU→LIS, 2027-03-10/2027-03-20, economia, BRL, expansão default). Permanecem fora do escopo: semântica do preço total do round-trip (preço do retorno usado como total), base/impostos `NULL`, one-way no produto, retries/backoff, resultados parciais, `deep_search`, multi-city e liberação do provider REAL.

**Git e publicação**: branch `main`; HEAD e `origin/main` em `6abba27d15f6500f8d3aa12b0f7479b6d3161137`; árvore limpa na auditoria pós-push; CI run `43788295629` concluído com **success**. A primeira auditoria independente do D3 concluiu **APROVADO COM RESSALVAS**; a segunda concluiu **NÃO APROVADO** por vazamento de `departure_token` em mensagens de erro. A correção de confidencialidade e os 2 testes adicionais foram aplicados (41/41 focados); o ajuste posterior removeu o token dos raw offers e acrescentou 1 teste (42/42 focados). O D3 foi publicado; a validação manual com conta autorizada **permanece pendente** e continua sendo pré-requisito da liberação REAL.

---

## 14. Fase 4 — OpenAPI 3.1 / Swagger UI (planejamento e implementação, 16/11/2026)

> **Planejamento original preservado abaixo; implementação registrada no §14.13.** O plano foi executado sem alterar regras de negócio, schema Prisma, migrations, `normalize.js`, barreira `REAL` ou D5/D6/D7. Nenhuma chamada à SerpApi foi feita e nada foi staged/commitado/pushado. **O provider REAL continua bloqueado.**

### 14.1 Objetivo e escopo

Formalizar o contrato HTTP que já existe e disponibilizar uma interface interativa (Swagger UI) para consulta e execução assistida das operações, sem criar uma segunda fonte de verdade. O contrato deve refletir exatamente o comportamento implementado, incluindo respostas reais, códigos de erro e distinções entre dados `SIMULATED` e `REAL`.

**Dentro do escopo:**

- Documento OpenAPI **3.1.0** gerado dinamicamente a partir dos schemas e metadados das rotas Fastify.
- Cobertura dos **12 endpoints** hoje montados em `app.js` e dos schemas reutilizáveis de request, response e erro.
- Swagger UI servida pelo próprio processo, com assets locais do pacote (sem CDN).
- Rota de documentação controlada por ambiente, desabilitada por padrão em produção.
- Testes de validade estrutural do documento, de cobertura de paths/operações e de exposição da rota.
- Atualização do README apenas na etapa de implementação, quando houver comportamento novo para documentar.

**Fora do escopo:** autenticação/autorização (não existe hoje), versionamento de API, SDKs, geração de clientes, gateway, rate limit, CORS, deploy, alteração de regras de negócio, novas rotas funcionais ou liberação de `REAL`.

### 14.2 Contrato real que deve ser representado

O código confirma:

- Fastify 5 (`^5.12.8`), JavaScript ESM puro, sem TypeScript.
- Rotas registradas em `apps/api/src/app.js`; `/health` inline e os módulos sob `/trips` e `/monitoring`, sem prefixo de versão.
- Schemas de request existentes: body de criação/atualização de viagem; `params.id` e `params.tripId`; querystrings vazias em `analysis`, `opportunities` e `POST /monitoring/runs`; `limit` 1–100 em `GET /monitoring/runs`; body `object|null` com `maxProperties: 0` no POST de monitoramento.
- **Não há response schemas** nas rotas. As respostas vêm dos services e estão comprovadas pelos testes `app.inject()`.
- Erros de domínio usam `HttpError(statusCode, message)` e o handler padrão do Fastify; o corpo de erro é `statusCode`, `error`, `message` (com `code` e `validation` quando o Fastify os produz). Não há handler central customizado.
- **Não há autenticação.** Portanto não se deve inventar `securitySchemes` nem exigir token no Swagger UI; o documento deve declarar ausência de segurança e a rota deve ser protegida por ambiente.
- Dados simulados são explícitos (`simulated`, `dataClassification: SIMULATED`, contagens e limitações); o contrato não pode apresentá-los como preços reais.

### 14.3 Dependências e compatibilidade

| Pacote | Versão planejada | Justificativa |
|---|---|---|
| `@fastify/swagger` | `9.9.4` (linha `^9.x`) | Compatibilidade oficial com Fastify `^5.x`; suporta `openapi: '3.1.0'` e geração dinâmica a partir dos schemas. |
| `@fastify/swagger-ui` | `5.2.6` (linha `^5.x`) | É a linha listada oficialmente para Fastify 5 + swagger 9. O npm publica `6.1.4`, mas a tabela do projeto ainda não declara a 6.x para Fastify 5; não usar sem validação explícita. |
| `@readme/openapi-parser` | `10.0.0` (dev) | Valida OpenAPI 3.1, mantém API de `validate()` e declara Node `>=20`, compatível com o mínimo do projeto. Alternativa a `@apidevtools/swagger-parser`, cuja linha atual exige Node mais novo. |

Nenhuma dependência de runtime além dos dois plugins. Nenhuma migration. O `package-lock.json` deve ser atualizado na implementação; nada é instalado nesta fase de planejamento.

### 14.4 Estratégia de geração e prevenção de divergência

1. Registrar `@fastify/swagger` antes das rotas, em modo dinâmico, com `openapi: { openapi: '3.1.0', info: { title, version, description }, tags, servers: [] }` e `components` compartilhados. Não manter um `openapi.json` estático paralelo.
2. Adicionar metadados de operação nas rotas: `operationId` único, `tags`, `summary`, `description` e `schema.response` por código HTTP. O `schema.response` passa a ser a fonte única do contrato de saída e também o serializer do Fastify; por isso cada schema deve conter **todos** os campos que os services realmente devolvem, incluindo `null` quando aplicável.
3. Definir componentes reutilizáveis: `Trip`, `FlightOffer`, `PriceObservation`, `PriceSnapshot`, `AnalysisEnvelope`, `OpportunitiesEnvelope`, `MonitoringRun`, `MonitoringItem`, `ErrorResponse`, `ValidationError` e variantes de item. Usar `$ref` para evitar duplicação.
4. Declarar erros por operação com o schema padrão do Fastify. `400` cobre validação de schema e regras de UUID/data; `404` cobre viagem inexistente; `409` cobre imutabilidade de rota/período, ausência de origem, configuração divergente durante pesquisa e concorrência de monitoramento; `503` cobre a barreira `REAL`; `500` permanece como fallback não enumerado quando aplicável. Não prometer códigos que o código não produz.
5. Usar exemplos derivados de fixtures/testes existentes, marcando explicitamente dados `SIMULATED`. Exemplos não podem introduzir propriedades fora dos schemas.
6. Declarar `security: []` (ou ausência de requisito) e documentar que a API não possui autenticação nesta fase. Quando auth existir, o esquema será adicionado em etapa própria.
7. Validar a coerência em teste: o documento gerado deve conter exatamente os paths/operações montados; nenhuma operação documentada sem handler e nenhum handler relevante sem operação. O teste de contrato roda sem banco, via `app.swagger()`/`app.inject()`.

**Risco central:** adicionar `schema.response` altera a serialização do Fastify. A implementação deve rodar a suíte existente e comparar os corpos; se um campo legítimo for removido, o schema está incompleto e deve ser corrigido — nunca relaxar o teste ou esconder a diferença.

### 14.5 Cobertura mínima por endpoint

| Método | Rota | Sucesso | Erros a documentar |
|---|---|---|---|
| `GET` | `/health` | `200` | — |
| `POST` | `/trips` | `201` | `400` |
| `GET` | `/trips` | `200` | — |
| `GET` | `/trips/:id` | `200` | `400`, `404` |
| `PUT` | `/trips/:id` | `200` | `400`, `404`, `409` |
| `DELETE` | `/trips/:id` | `204` | `400`, `404` |
| `GET` | `/trips/:tripId/flights` | `200` | `400`, `404`, `409`, `503` |
| `GET` | `/trips/:tripId/offers/history` | `200` | `400`, `404` |
| `GET` | `/trips/:tripId/analysis` | `200` | `400`, `404` |
| `GET` | `/trips/:tripId/opportunities` | `200` | `400`, `404` |
| `POST` | `/monitoring/runs` | `200` | `400`, `409`, `500` |
| `GET` | `/monitoring/runs` | `200` | `400` |

Além dos paths funcionais, a UI expõe `/documentation` e `/documentation/json` quando habilitada; esses paths não fazem parte do contrato de negócio e não devem ser contados como endpoints de domínio.

### 14.6 Rota, ambientes e segurança

- Criar uma configuração explícita `API_DOCS_ENABLED` (boolean estrito, padrão **`false`**), carregada por `config/env.js` com o mesmo padrão D2/D4 já usado no projeto: valor não reconhecido desativa e emite `warn`; `true`/`1` habilitam.
- `buildApp()` deve receber a opção de forma injetável (ex.: `buildApp({ docsEnabled = false } = {})`) para que testes não dependam de ambiente global. `server.js` passa `loadEnv().apiDocs.enabled`; `buildApp()` sozinho continua sem docs, preservando os testes existentes.
- Quando habilitada: `GET /documentation` (UI) e `GET /documentation/json` (documento). Quando desabilitada: os paths respondem `404`, sem registrar o plugin.
- A UI usa os assets locais de `@fastify/swagger-ui`; não usar CDN. Aplicar `staticCSP: true` e uma CSP compatível com o Swagger UI, sem `unsafe-eval` desnecessário; revisar os headers antes de habilitar em ambiente público.
- Não incluir `servers` com host interno, URLs de banco, chaves, tokens, credenciais ou variáveis de ambiente. `API_DOCS_ENABLED` não é segredo, mas a documentação não deve revelar a topologia interna.
- Como não há auth, produção deve manter `API_DOCS_ENABLED=false` por padrão. Habilitar publicamente é uma decisão operacional explícita; a rota não deve ser confundida com proteção de acesso.

### 14.7 Estratégia de testes

Criar `tests/openapi.test.js` (ou equivalente), sem banco:

1. Construir a app com `docsEnabled: true`, aguardar `ready()` e obter `app.swagger()`.
2. Validar o documento com `@readme/openapi-parser` (`validate`), garantindo `openapi === '3.1.0'` e `info`/paths bem formados.
3. Comparar o conjunto de paths/operações com uma lista canônica dos 12 endpoints; falhar em path ausente, extra ou método trocado.
4. Verificar que cada operação tem `operationId` único, `tags`, `summary`, request schema quando aplicável, response schema para o sucesso e respostas de erro compatíveis com o comportamento real.
5. Verificar `components.schemas` referenciados e a presença de `ErrorResponse`; garantir que nenhum exemplo contenha campo não declarado.
6. Com `docsEnabled: false`, garantir `404` em `/documentation` e `/documentation/json`; com `true`, garantir `200` e `content-type` correto para HTML/JSON.
7. Rodar a suíte existente (`npm test`) para provar que a serialização por response schema não alterou nenhum contrato. Os testes de API já cobrem os corpos reais; não criar um segundo conjunto de fixtures divergente.
8. Opcional e somente se necessário: validar exemplos com o Ajv do próprio Fastify, sem abrir conexão com o banco.

### 14.8 Arquivos potencialmente envolvidos

- `package.json` / `package-lock.json` — duas dependências de runtime e uma dev.
- `apps/api/src/app.js` — registro condicional dos plugins e opção `docsEnabled`.
- `apps/api/src/config/env.js` — `API_DOCS_ENABLED` estrito.
- `apps/api/src/server.js` — passar a configuração ao `buildApp()`.
- `apps/api/src/modules/*/*.routes.js` — metadados e `schema.response`/erros por operação.
- `apps/api/src/openapi/` (novo, se necessário) — componentes compartilhados e helpers de resposta, sem lógica de negócio.
- `tests/openapi.test.js` (novo) — validade, cobertura e gate da rota.
- `.env.example` — `API_DOCS_ENABLED=true` apenas como conveniência local, com comentário de que produção usa `false`.
- `README.md` — seção curta de documentação e instrução de acesso, na implementação.

Não alterar `prisma/schema.prisma`, migrations, services de domínio, barreira `REAL`, `normalize.js` ou contratos de provedores.

### 14.9 Critérios objetivos de conclusão

- `@fastify/swagger` e `@fastify/swagger-ui` instalados nas versões compatíveis e `npm ci` reproduzível.
- Documento OpenAPI 3.1.0 válido, com os 12 endpoints e todos os códigos de sucesso/erro acordados.
- Responses cobrem integralmente os corpos reais; suíte existente continua verde sem relaxar assertions.
- `GET /documentation` e `/documentation/json` funcionam quando habilitados e retornam `404` quando desabilitados.
- Nenhum segredo/host interno no documento ou nos assets; CSP revisada.
- Teste de contrato verde e executado no CI.
- README e relatório atualizados apenas com o comportamento efetivamente implementado.

### 14.10 Riscos técnicos e mitigação

| Risco | Mitigação |
|---|---|
| Response schema alterar serialização e remover campos | Escrever schemas completos; rodar suíte existente; comparar corpos reais; corrigir schema, nunca o teste. |
| Divergência entre OpenAPI e handlers | Geração dinâmica + teste que compara paths/operações com a lista canônica; code review. |
| OpenAPI 3.1 vs. JSON Schema do Fastify | Usar `type: ['string','null']` quando necessário; validar com parser 3.1; evitar `nullable` exclusivo de 3.0. |
| Exposição pública da documentação | `API_DOCS_ENABLED=false` por padrão; CSP; ausência de hosts/segredos; decisão explícita para habilitar. |
| UI 6.x incompatível ou não suportada | Fixar a linha 5.2.6 documentada para Fastify 5; não atualizar para 6.x sem validação. |
| Exemplos virarem “promessas” de dados | Derivar de fixtures/testes; rotular `SIMULATED`; não inventar propriedades ou resultados. |
| Auth futura | Não simular segurança agora; adicionar `securitySchemes` somente quando houver implementação real. |

### 14.11 Fora do escopo (permanece)

- Liberação do provider `REAL`, remoção da barreira `503`, validação paga da SerpApi e decisão comercial/legal.
- Autenticação, autorização, multiusuário, rate limit, CORS, TLS e deploy.
- Novas regras de negócio, novos endpoints, migrations, cache, SDK, geração de clientes ou versionamento de API.
- Substituir os testes existentes por testes de contrato ou alterar fixtures para fazer o documento passar.

### 14.12 Próximo checkpoint

Aguardar revisão e autorização explícita do usuário. A implementação só começa depois disso, em etapa separada, com instalação das dependências, alterações de código, testes e commit/push somente se autorizados. Até lá, o estado permanece: `main == origin/main == 6abba27`, árvore limpa, D3 publicado, Fase 4 apenas planejada.

> **Checkpoint cumprido em 16/11/2026.** A implementação foi executada no working tree e validada; o registro efetivo, os números de teste e o estado Git estão no §14.13. Este §14.12 permanece como registro do planejamento original.

### 14.13 Implementação efetiva (16/11/2026)

> Este registro preserva o estado original da implementação. Após a auditoria independente, os schemas foram fechados e a CSP foi restringida; os números e o estado atuais estão em **§14.14**. Onde este subseção cita `additionalProperties: true`, 42 componentes, 9/9 ou 332/332, trata-se do estado anterior à correção.

**Escopo entregue no working tree, sem commit/push:**

- `package.json` / `package-lock.json`: `@fastify/swagger@9.9.4` e `@fastify/swagger-ui@5.2.6` em `dependencies`; `@readme/openapi-parser@10.0.0` em `devDependencies`. Versões explícitas, sem faixa flutuante.
- `apps/api/src/openapi/schemas.js` (novo): componentes JSON Schema compartilhados e registro via `app.addSchema`, cobrindo `HealthResponse`, `Trip`, ofertas de voo, histórico, análise, oportunidades, monitoramento e erros. Os schemas também são os serializers Fastify; `additionalProperties: true` foi mantido deliberadamente para não remover campos futuros/adicionais, e os campos opcionais reais (`ErrorResponse.code`, `validation`, `validationContext`, `RelatedQuery.priceInsights`) não são obrigatórios.
- `apps/api/src/app.js`: `buildApp({ docsEnabled = false } = {})`; registro condicional de `@fastify/swagger`/`@fastify/swagger-ui`; 12 operações com `operationId` único, tags, summaries, descriptions, parâmetros, request/response schemas e códigos HTTP reais; `servers: []`; componentes nomeados; `refResolver` que usa o `title`/`$id` em vez de `def-N`; transformação de `/trips/` para `/trips`; descrições e exemplos de resposta anexados no `transformObject`.
- `/health` foi movido para um plugin registrado após o Swagger: uma rota adicionada diretamente no root antes de o plugin carregar não era capturada pelo hook `onRoute`.
- `apps/api/src/config/env.js`: `API_DOCS_ENABLED` estrito (ausente/`false`/`0`/`off`/`no`/vazio desligam; `true`/`1` ligam; valor não reconhecido desliga com `warn`). `server.js` repassa `env.apiDocs.enabled`; `buildApp()` sozinho permanece sem docs, preservando testes e bootstrap.
- `apps/api/src/modules/*/*.routes.js`: metadados e response schemas em todas as rotas, sem alterar regras de negócio. Em `POST /monitoring/runs`, o body vazio usa `anyOf` (`object` com `maxProperties: 0` ou `null`) e a querystring vazia declara `properties: {}`; isso evita parâmetros de query inválidos gerados pelo `@fastify/swagger` sem mudar a validação do Fastify.
- `.env.example`: `API_DOCS_ENABLED=false` documentado.
- `README.md`, `docs/contexto.md` e este relatório atualizados com URLs, ativação, comportamento por ambiente, cobertura e limitações.

**Comportamento em runtime:**

- `docsEnabled: false` (default e bootstrap sem flag): `/documentation`, `/documentation/json` e assets respondem `404`; plugins não são registrados.
- `docsEnabled: true`: `/documentation` serve HTML do Swagger UI com assets locais e `staticCSP`; `/documentation/json` serve o documento 3.1.0.
- O documento não inclui autenticação simulada, `servers` com hosts internos, `DATABASE_URL`, `TEST_DATABASE_URL`, `SERPAPI_API_KEY`, `api_key`, `localhost`, `127.0.0.1` ou URLs `http(s)`.
- As 12 operações documentadas são: `GET /health`; `POST/GET /trips`; `GET/PUT/DELETE /trips/{id}`; `GET /trips/{tripId}/flights`; `GET /trips/{tripId}/offers/history`; `GET /trips/{tripId}/analysis`; `GET /trips/{tripId}/opportunities`; `POST/GET /monitoring/runs`.

**Correções encontradas durante a validação:**

1. `ErrorResponse` inicialmente exigia `code`/`validation` em todos os erros, fazendo o serializer do Fastify transformar um `400` de domínio em `500`; os campos opcionais foram corrigidos no schema, não nos testes.
2. `RelatedQuery` exigia `priceInsights`, que não existe em toda oferta; passou a ser opcional.
3. O Swagger gerava `/trips/` em vez de `/trips`; a transformação preserva o path realmente usado pela API.
4. Componentes saíam como `def-N`; o `refResolver` passou a publicar os nomes lógicos.
5. `POST /monitoring/runs` gerava parâmetros de query inválidos a partir do body/querystring vazios; `anyOf` + `properties: {}` corrigiram o documento sem alterar o comportamento validado.
6. O `/health` não aparecia no documento quando registrado antes do plugin; foi movido para um plugin posterior ao Swagger.

**Verificação executada:**

- `tests/openapi.test.js`: **9/9**.
- Recorte HTTP existente (`api`, `offers-history`, `analysis-endpoint`, `opportunities-endpoint`, `monitoring-endpoint`): **52/52**.
- Suíte completa: **332/332** em **10,4 s**, exit 0, após a criação do banco descartável `trippulse_test_migration` em `127.0.0.1:5544`; a aplicação usou `localhost:5433`.
- `git diff --check`: limpo (exit 0; somente avisos de normalização LF/CRLF do Git no Windows).
- Documento inspecionado em runtime: `openapi: 3.1.0`, 8 paths / 12 operações, 42 componentes, `/documentation` 200 `text/html` e `/documentation/json` 200 `application/json`.

**Limitações e estado:**

- Nenhuma inspeção visual da UI em navegador foi feita; a validação foi por `app.inject()` (HTML, CSP, JSON e conteúdo).
- Nenhum commit, staging, push, amend, rebase ou reset foi executado. HEAD permanece `6abba27d15f6500f8d3aa12b0f7479b6d3161137`; a árvore contém as alterações da Fase 4, `docs/contexto.md` e este relatório, além dos arquivos não rastreados `apps/api/src/openapi/schemas.js` e `tests/openapi.test.js`.
- Nenhuma alteração em `prisma/schema.prisma`, migrations, `normalize.js`, barreira `REAL`, D5/D6/D7, regras de negócio ou chamadas à SerpApi.

### 14.14 Correção pós-auditoria independente (A1–A4, 16/11/2026)

A auditoria independente do D4 emitiu **NÃO APROVADO**, com bloqueio em **A1**: o helper `object()` aplicava `additionalProperties: true` a 41 dos 42 componentes, e o próprio comentário o justificava como proteção genérica contra perda de campos. A correção foi aplicada no working tree, sem commit/push.

**A1 — schemas fechados, componente a componente:**

- `object()` agora gera `additionalProperties: false`; campos públicos precisam ser declarados.
- Os únicos mapas dinâmicos remanescentes são `CurrencyFloors` (`additionalProperties: { type: 'integer' }`, mapa moeda → inteiro) e `ValidationIssue.params` (parâmetros variáveis de palavra-chave do Ajv, com `additionalProperties: true` local e documentado).
- `Trip`, `Money`, `FlightRoute`, `AnalysisEnvelope`, `OpportunitiesEnvelope`, `MonitoringRun` e os demais componentes de resposta foram fechados sem remover campos reais.
- O contrato agora tem **45 componentes** (42 anteriores − `ValidationError` + `MonitoringItemOk` + `MonitoringItemFailed` + `MonitoringItemSkipped` + `ValidationIssue`).

**MonitoringItem — três variantes explícitas:**

| Variante | Campos obrigatórios | Campos opcionais |
|---|---|---|
| `OK` | `tripId`, `status` | `opportunityCount`, `evaluatedOfferCount`, `containsSimulatedData` |
| `FAILED` | `tripId`, `status`, `stage`, `error`, as três contagens/flag | — |
| `SKIPPED` | `tripId`, `status`, `reason`, `detail`, as três contagens/flag | — |

As contagens de `OK` continuam opcionais para preservar itens históricos gravados antes do contrato atual (fixtures usam `{ tripId, status: 'OK' }`). `MonitoringItem` é `oneOf` das três variantes fechadas. A leitura do JSONB em `monitoring.service.js` valida tipo, status, chaves permitidas, campos obrigatórios, enums e tipos antes de `toRunView()`; propriedade desconhecida falha com 500 controlado e não é ecoada na resposta.

**RelatedQuery.priceInsights:**

- Deixou de ser objeto arbitrário. Declara somente `lowest_price`, `price_level`, `typical_price_range` e `price_history`, todos opcionais, com `additionalProperties: false`.
- `normalize.js` continua copiando o metadado para `relatedQuery.priceInsights`; o serializer da API passa a descartar qualquer campo externo não previsto, reduzindo a superfície de exposição de payload do provedor.

**ErrorResponse / validation.items:**

- Criado `ValidationIssue` fechado com `instancePath`, `schemaPath`, `keyword`, `params` e `message`, todos opcionais.
- `params` mantém `additionalProperties: true` porque suas chaves variam por palavra-chave do Ajv (`missingProperty`, `limit`, `type`, `additionalProperty`, etc.); é a única permissividade de objeto no contrato.
- `ErrorResponse.validation` referencia `ValidationIssue`; `code` e `validationContext` continuam opcionais.

**A2:** o componente duplicado `ValidationError` foi removido; `ErrorResponse` é a única definição de erro.

**A3:** a UI passou a usar CSP explícita, restrita a assets locais:

```text
default-src 'self'; base-uri 'self'; font-src 'self' data:; frame-ancestors 'self';
img-src 'self' data:; object-src 'none'; script-src 'self'; script-src-attr 'none';
style-src 'self'; upgrade-insecure-requests;
```

`https:` foi removido de `style-src`; `validator.swagger.io` foi removido de `img-src` e `validatorUrl: false` desabilita o validador externo do Swagger UI. O inicializador é servido localmente.

**A4:** o JSDoc de `buildApp` foi movido para imediatamente acima da função; `healthRoutes` ficou sem o bloco incorreto.

**Comparação antes/depois:**

| Ponto | Antes | Depois |
|---|---|---|
| `additionalProperties: true` | 41/42 componentes de topo + aninhados | Somente `ValidationIssue.params`; `CurrencyFloors` é mapa tipado |
| `MonitoringItem` | Objeto único permissivo | `oneOf` de `OK`/`FAILED`/`SKIPPED`, fechados e validados na leitura |
| `priceInsights` | Objeto arbitrário | Quatro campos conhecidos, fechado |
| `validation.items` | Objeto arbitrário | `ValidationIssue` com cinco campos, `params` dinâmico |
| `ValidationError` | Duplicado e não referenciado | Removido |
| CSP | `style-src 'self' https:` e `validator.swagger.io` | Somente `'self'`/`data:`; validador externo desligado |
| JSDoc de `buildApp` | Sobre `healthRoutes` | Sobre `buildApp` |

**Testes executados:**

- `tests/openapi.test.js`: **12/12**; inclui schemas fechados, única permissividade em `params`, `CurrencyFloors`, três variantes, `priceInsights`, `ValidationIssue`, ausência de `ValidationError`, CSP local e `validatorUrl: null`.
- `tests/monitoring-endpoint.test.js`: **11/11**; inclui rejeição de item JSONB com campo desconhecido (500) e preservação das três variantes legítimas.
- Recorte focado (`monitoring-core`, `monitoring-endpoint`, `normalize`, `real-barrier-policy`, `flight-providers-registry`): **53/53**.
- Suíte completa: **336/336**, 0 falhas, 0 skipped, 0 cancelados, exit 0, em PostgreSQL 17 descartável (`127.0.0.1:5545`); banco descartável removido ao final.
- Validação OpenAPI 3.1 do documento gerado: `valid: true`, sem warnings; 8 paths, 12 operações e 45 componentes; exemplos de resposta validados com Ajv sem falhas.

**Estado e limites:** HEAD permanece `6abba27d15f6500f8d3aa12b0f7479b6d3161137`; nada staged/commitado/pushado. Nenhuma alteração em Prisma, migrations, regras de negócio, contratos de provedores, D5/D6/D7, barreira `REAL` ou semântica de preços. Nenhuma chamada real à SerpApi e `REAL` continua bloqueado. Não houve inspeção visual em navegador; a UI foi validada por `app.inject()` (HTML, CSP, assets locais, inicializador e JSON). **Este registro não declara aprovação independente; o D4 aguarda nova auditoria.**

> **Atualização posterior (16/11/2026):** o D4 foi aprovado na segunda auditoria independente, commitado em `a68bf73eb001bc9d70484186a4b98a4a53b82334` e publicado; o CI #14 (`43884861309`) concluiu com `success`. O parágrafo acima permanece como registro do estado no momento do §14.14.

---

## 15. Fase 5 — preparação para integração real (planejamento, 16/11/2026)

> **Natureza desta etapa:** planejamento e análise. Nenhuma chamada real à SerpApi foi executada, nenhuma credencial foi usada, nenhum arquivo de código/Prisma/migration foi alterado e a barreira `REAL` (503) permanece intacta. `REAL` continua **bloqueado**. Este §15 registra o que foi auditado, o que é hipótese, o que exige evidência e o que impede a liberação.

### 15.1 Estado Git e limite de escopo

| Item | Estado em 16/11/2026 |
|---|---|
| Branch | `main` |
| HEAD inicial | `a68bf73eb001bc9d70484186a4b98a4a53b82334` |
| `origin/main` inicial | `a68bf73eb001bc9d70484186a4b98a4a53b82334` |
| Working tree inicial | limpa |
| Staging inicial | vazio |
| CI do commit | run `#14` / `43884861309`, conclusão `success` |
| Código de referência | commit publicado, não o working tree de relatórios anteriores |

Foram consultados o código efetivamente publicado, `docs/contexto.md`, este relatório, `README.md` e `docs/Regras.md`. A documentação anterior foi tratada como histórica; onde divergiu do código, prevaleceu o código. **Nenhum teste de código foi executado nesta etapa**, pois não houve alteração de código; a verificação final é documental (`git diff --check`, conferência de links e estado Git).

### 15.2 Arquitetura atual e o que está comprovado

O fluxo publicado é:

```text
GET /trips/:tripId/flights
  → valida UUID
  → resolve o registro de providers
  → assertOnlySimulatedProviders (barreira D6, antes de banco e de rede)
  → busca Trip, exige origin
  → calcula variationSeed
  → provider.search() FORA de transação
  → normalizeFlightOffer() (classificação vem do registro)
  → assertOnlySimulatedOffers (defesa pós-normalização)
  → transação: lock da Trip → relê config → snapshot atômico
  → persistOfferSnapshot (defesa D5)
```

O adaptador SerpApi implementa `type=1` com `outbound_date` e `return_date` na primeira requisição. Para cada `departure_token` selecionado, repete os parâmetros da primeira pesquisa, acrescenta `type=1` e o token, e faz a segunda requisição. A fórmula é `1 + N`, com `N` entre 1 e 10. O retorno escolhido é o primeiro da ordenação determinística por preço, duração, partida e companhia/voo. O preço usado hoje é `chosenReturn.price`.

**Comprovado por código e testes sintéticos:** contrato das duas requisições, preservação de parâmetros, validação de `error`/`search_metadata.status`, moeda BRL, timeout por `AbortController`, mensagens sanitizadas, remoção de `departure_token` dos raw offers, fail-closed em falha de expansão, deduplicação de tokens, barreira em três pontos e preservação de D5/D6/D7.

**Não comprovado:** comportamento de resposta real, semântica do preço, disponibilidade real, latência real, limites de throughput na prática, qualidade dos dados, direitos contratuais de uso e custo total de operação.

### 15.3 Achados técnicos da auditoria

1. **Preço do round-trip não confirmado.** O código usa o preço do retorno da segunda resposta como total do trip. A documentação oficial consultada descreve o fluxo de `departure_token`, mas não afirma de forma inequívoca que esse campo é o total combinado. Não é seguro tratar a hipótese como fato.
2. **Identidade da oferta ignora a volta.** `buildOfferExternalKey()` usa provider, rota, companhia, número do voo e data de partida **da ida**. `normalizeSerpApiOffer()` também projeta rota, datas e voo apenas da ida. Dois retornos diferentes para a mesma ida produzem o mesmo `externalKey`; o histórico pode misturar produtos distintos e o `best`/`trend` perde significado. Este é um bloqueio técnico independente da semântica do preço.
3. **Custo sem controle.** O endpoint `/flights` é aberto, sem autenticação, rate limit, orçamento por período ou contador de créditos. O scheduler é sequencial, mas chamadas manuais podem ser concorrentes e consumir créditos sem relação com o ciclo agendado.
4. **Sem idempotência.** Cada pesquisa grava uma nova observação por oferta. Um retry manual ou uma repetição do ciclo cria outra linha de `PriceHistory`, mesmo com o mesmo preço; não há chave de idempotência nem janela de deduplicação de observações.
5. **Sem retry/backoff/circuit breaker.** Uma falha de rede, HTTP, JSON ou retorno vazio aborta a viagem inteira. O scheduler tenta de novo no próximo ciclo, mas não há backoff, jitter, orçamento total ou disjuntor. Indisponibilidade externa tende a virar erro genérico 500, não 502/503.
6. **Timeout apenas por requisição.** O adaptador usa 30 s por chamada. Um round-trip com N expansões pode consumir até `(1+N) × 30 s` em caso de lentidão, sem prazo total do ciclo. O scheduler não sobrepõe ciclos, mas o ciclo pode ficar muito longo.
7. **Cache implícito.** O adaptador não envia `no_cache`; portanto aceita o cache padrão do SerpApi (consulta exata, 1 h, gratuito). Isso pode reduzir custo, mas também devolver preço com até 1 h de idade. A política de frescor/cache não está definida.
8. **Sem observabilidade de custo.** Não há métricas de requisições, créditos, latência, taxa de erro por provider, cache hit ou custo estimado. Também não há alerta de consumo.
9. **Logs sem redaction explícita.** O Fastify está com `logger: true`. O adaptador não registra a URL nem o corpo bruto e sanitiza mensagens, mas não há configuração de redaction no logger nem teste integrado de logs. Mensagens de falha por viagem são persistidas em `monitoring_runs.items` e expostas no GET de monitoramento.
10. **Desativação exige restart.** `SERPAPI_ENABLED` é lida no boot, o registro é memoizado e não existe kill switch em runtime. Desligar o provider ou o scheduler em produção exige reiniciar o processo.
11. **Isolamento é all-or-nothing.** O registro sempre inclui o simulado; ao adicionar o SerpApi real, `assertOnlySimulatedProviders` bloqueia a lista inteira. Isso é correto para a barreira atual, mas a liberação futura precisará definir mistura, prioridade e fallback entre SIMULATED e REAL.
12. **Contrato de resposta assumiria `simulated: true`.** `searchFlightsForTrip` devolve `simulated: true` fixo. Uma liberação REAL exigirá revisão do contrato e do OpenAPI, não apenas a remoção da barreira.
13. **`observedAt` é hora local da captura.** Não é o timestamp da cotação do provedor. Com cache, o dado pode ser mais antigo. Não há campo separado de `quoteAt`/`retrievedAt`.
14. **D5/D6/D7 preservados.** Nenhuma alteração foi feita em `real-barrier.js`, `normalize.js`, `offers.service.js`, `flights.service.js`, schema, migrations ou contratos de providers nesta fase.
15. **`booking_token` não é removido do raw.** O adaptador nunca envia `booking_token`, mas `withoutDepartureToken()` remove apenas `departure_token`; o raw `return` pode conservar `booking_token`. A normalização não lê `raw.return`, então o token não é transportado para a oferta normalizada pelo fluxo atual, e a persistência usa apenas essa oferta. A ausência de `booking_token` nas requisições, na oferta normalizada, na resposta HTTP, no histórico e no JSONB de monitoramento passou a ter cobertura de regressão por **testes de fronteira** em 20/11/2026 — `tests/booking-token.test.js`, `tests/booking-token-persistence.test.js` e `tests/booking-token-monitoring.test.js` (8 testes, publicados em `81d5bb3`, §15.14) —, sem busca `REAL` ponta a ponta; a presença do token em `raw.outbound`/`raw.return` é fixada por teste. A documentação foi corrigida para não afirmar remoção de ambos.

### 15.4 Protocolo mínimo de validação manual do D3

**Objetivo:** validar o adaptador e a semântica do preço sem remover a barreira, sem usar credenciais de produção e sem executar nada nesta fase.

**Pré-condições obrigatórias:**

- autorização escrita e específica do usuário, com orçamento máximo;
- conta SerpApi dedicada ao teste, sem dados de produção;
- chave fornecida apenas por variável de ambiente em sessão isolada;
- `SERPAPI_ENABLED` não precisa ser ligado no servidor: a validação pode chamar `createSerpApiFlightProvider()` diretamente, com `fetch` nativo e sem passar por `/flights`;
- barreira `REAL` e D5/D6/D7 intocadas;
- nenhum screenshot, log ou fixture pode conter chave ou tokens.

**Cenário principal:** GRU → LIS, 2027-03-10 (ida) e 2027-03-20 (volta), economia, 1 adulto, BRL, `hl=pt-BR`, `gl=br`, `maxOutboundExpansions=1`.

| Ordem | Chamada | Requisições HTTP | Créditos potenciais | Dependência de cache | O que registrar |
|---|---|---|---|---|---|
| R1 | Execução A: `type=1`, rota, `outbound_date`, `return_date` | 1 | até 1; cobrança não presumida | primeira consulta; sem cache | status HTTP, `search_metadata.status`, `search_parameters.currency`, `P1` da ida escolhida, presença de `departure_token`, quantidade de `best_flights`/`other_flights` |
| R2 | Execução A: todos os parâmetros da R1 + `type=1` + `departure_token` | 1 | até 1; cobrança não presumida | token novo; sem cache | prova de preservação dos parâmetros, `P2` do retorno escolhido, presença de `booking_token`, quantidade de retornos |
| R3 | Execução A: `booking_token` do retorno escolhido, mesmos parâmetros de contexto | 1 | até 1; cobrança não presumida | token novo; sem cache | `booking_options`; `selected_flights`; `separate_tickets`; `together`; `departing`; `returning`; `baggage_prices`; seller e preço `B` correspondente |
| R4 | Execução B: repetir R1 com os mesmos parâmetros | 1 | 0 ou 1; **não garantido** | repetição exata de R1; pode usar cache de 1 h, mas só evita cobrança com parâmetros idênticos e cache válido | determinismo do mercado e eventuais divergências |
| R5 | Execução B: repetir R2 com o token da R4 | 1 | 0 ou 1; **não garantido** | se o token da R4 for idêntico ao da R1, repete R2 e pode usar cache; caso contrário, consulta nova | contrato preservado e novo `P2` |
| R6 | Execução B: repetir R3 com o token da R5 | 1 | 0 ou 1; **não garantido** | se o token da R5 for idêntico ao da R2, repete R3 e pode usar cache; caso contrário, consulta nova | mesmos campos de R3 e novo `B` |
| R7-C | Repetir booking options de R3 com cache padrão | 1 | 0 ou 1; **não garantido** | mesma consulta de R3; depende de parâmetros idênticos e cache válido | cache hit/miss, `B`, campos de R3 e delta do contador |
| R7-N | Repetir booking options de R3 com `no_cache=true` | 1 | até 1; cobrança não presumida | `no_cache=true` força consulta nova; sem cache | `B`, campos de R3 e delta do contador |

**Quantidade e custo:** duas execuções positivas completas = **6 requisições HTTP** (R1–R3 e R4–R6). O R7 é adicional e deve ser executado como **duas requisições separadas** (R7-C e R7-N), totalizando **8 requisições positivas** se ambas forem feitas; se o orçamento permitir apenas uma, priorizar R7-N e registrar que o cache não foi testado. **Requisições não equivalem a créditos:** cada requisição pode consumir até 1 crédito, mas R4, R5, R6 e R7-C podem ser atendidas pelo cache padrão. Isso só evita cobrança quando os parâmetros são exatamente os mesmos e o cache está válido; **não presumir gratuidade** por repetição. Sem consultar o contador da conta, não é possível prometer custo exato: registrar o valor antes/depois e, se o contador não estiver disponível, declarar a limitação em vez de apresentar estimativa como cobrança confirmada. O teste negativo com token inválido/expirado é opcional e fica **fora** das 8 requisições positivas: **não presumir que seja gratuito**; medir o contador antes/depois. Se for testar mercado vazio, acrescentar 1 requisição; resultado vazio, se cobrado, conta como busca.

**Contador de créditos:** registrar o valor do painel/consumo antes de R1 e depois de **cada** chamada, sem capturar credenciais, IDs de conta ou dados pessoais. Registrar o delta mesmo quando a chamada falhar; a cobrança de falhas e de tokens inválidos não é presumida. Se o contador não estiver disponível, declarar a limitação e **não afirmar custo exato**.

**Cache:** as chamadas positivas que podem depender de cache são **R4** (repetição exata de R1), **R5/R6** (somente se o token retornado for idêntico ao da execução A) e **R7-C** (mesma consulta de R3 com cache padrão). A eventual gratuidade exige correspondência exata dos parâmetros e cache válido; se qualquer parâmetro mudar, o token expirar ou o cache estiver vencido, a consulta **deixa de ter expectativa de cache hit** e **pode consumir crédito** caso resulte em busca bem-sucedida — conferindo o contador da conta antes/depois de cada chamada. **R7-N** usa `no_cache=true` e força consulta nova — não depende de cache. Comparar `B`, seller e contador entre R3, R7-C e R7-N. Executar R7 imediatamente após R3 para reduzir o risco de expiração do token; se ele expirar, repetir R1–R3 e registrar o desvio. Se o endpoint de booking options não aceitar `no_cache`, registrar como “não testável” e não inferir cache hit. O cache de 1 h é por consulta exata e não garante frescor.

**Resultados esperados:**

- R1/R4: HTTP 200, `status = Success`, moeda BRL, ao menos uma ida com `departure_token`.
- R2/R5: HTTP 200, `status = Success`, mesmos parâmetros da respectiva busca inicial, `type=1` explícito, ao menos um retorno; nenhuma oferta parcial se falhar.
- R3/R6: HTTP 200, `booking_options` preenchido; `selected_flights`, `separate_tickets`, `together`, `departing`, `returning`, `baggage_prices`, seller e `B` comparáveis ao itinerário selecionado.
- R7-C/R7-N: mesma consulta de booking options, com e sem cache; comparar `B`, seller e contador.
- Mercado vazio: HTTP 200, `Success`, ausência de `best_flights`/`other_flights` e retorno `[]` pelo adaptador, sem exceção.

**Evidências que devem ser capturadas:**

- data/hora UTC, SHA do código, versão do adaptador, rota, datas, moeda, `N`;
- parâmetros sanitizados de R1/R2/R4/R5 (sem `api_key`/tokens), inclusive prova de preservação;
- status HTTP, `search_metadata.status`, `search_parameters.currency`;
- `P1`, `P2`, `B`, `price_insights.lowest_price` (quando presente);
- presença booleana de `departure_token`/`booking_token` (nunca o valor);
- quantidade de itinerários e o primeiro itinerário de retorno escolhido;
- todos os campos de R3/R6: `selected_flights`, `separate_tickets`, `together`, `departing`, `returning`, `baggage_prices`, seller e preço correspondente;
- contador de créditos antes/depois de cada chamada e cache hit/miss;
- comparação manual com a mesma consulta na UI do Google Flights (mesma rota, datas, locale/currency), com data/hora e screenshot sem dados sensíveis.

**Como gerar fixtures sem armazenar credenciais ou tokens:**

1. Executar uma sessão única, com a chave apenas em `SERPAPI_API_KEY` do processo; nunca criar `.env` de teste versionado.
2. Usar um `fetchImpl` instrumentado em memória para receber a resposta; não gravar URL, corpo bruto ou headers.
3. Aplicar uma allowlist de campos e substituir `departure_token`/`booking_token` por placeholders determinísticos (`<OUTBOUND_TOKEN_1>`, `<RETURN_BOOKING_TOKEN_1>`); remover `api_key`, `search_metadata.id`, endpoints, URLs e qualquer campo desconhecido.
4. Gravar somente o JSON sanitizado em `tests/fixtures/real/serpapi/` (futuro), com um sidecar de proveniência: data, SHA do código, rota, datas, moeda, quantidade de requisições e SHA-256 do fixture.
5. Rodar uma verificação automática que compare a chave real com o conteúdo do fixture sem imprimi-la e que rejeite padrões de token/URL; revisar o diff antes de qualquer commit.
6. Nunca versionar resposta bruta, `.env`, logs de rede ou screenshots com URL/QR/token.

**Verificação separada dos tokens (código e testes):**

- `departure_token`: é enviado somente em R2/R5; `withoutDepartureToken()` remove a propriedade por cópia dos itinerários de ida e volta; os testes verificam ausência em `raw`, `raw.outbound`, `raw.return`, no JSON serializado e no objeto normalizado; as respostas originais não são mutadas.
- `booking_token`: **nunca é enviado** nas requisições (testes verificam `searchParams.get('booking_token') === null`); porém **não é removido do raw `return`** pelo código. A normalização de `normalizeSerpApiOffer()` não lê `raw.return`, então o token **não é transportado para a oferta normalizada pelo fluxo atual**; a persistência recebe apenas a oferta normalizada. **A ausência de `booking_token` nos destinos sensíveis tem teste específico de regressão desde 20/11/2026** (`tests/booking-token.test.js`, `tests/booking-token-persistence.test.js` e `tests/booking-token-monitoring.test.js`, 8 testes, publicados em `81d5bb3`; CI #16 success). O token continua em `raw.outbound`/`raw.return` — a redação anterior que afirmava remoção do raw permanece corrigida. Essa cobertura é de **fronteiras** (§15.14), não ponta a ponta: nenhuma busca `REAL` foi executada, e o bloqueador `baggagePieces`/`refundable` do mapeador SerpApi é independente do token.

**Critério de aceite do protocolo:** as duas execuções positivas completas (R1–R6) e o R7 produzem evidência suficiente para decidir a semântica do preço e comparar cache; a negativa opcional prova confidencialidade; as fixtures permitem reproduzir o comportamento sem rede e sem segredo. Sem isso, o D3 permanece “implementado e testado apenas com fixtures sintéticas”, não “validado com provedor real”.

### 15.5 Semântica do preço round-trip: decisão proposta

**Fatos:**

- A documentação oficial do Google Flights API descreve `type=1`, `return_date` e a necessidade de uma segunda requisição com `departure_token`, mas não afirma, de forma inequívoca, que o `price` da segunda resposta é o total combinado.
- O exemplo oficial é de ida simples; não há um exemplo oficial completo de round-trip com `P1`, `P2` e total de booking que feche a semântica.
- O adaptador atual usa `chosenReturn.price` (`P2`) como `price.total` do trip; `P1` é descartado.
- A oferta canônica e o `externalKey` não distinguem o retorno.

**Hipóteses e teste:**

| Observação | Interpretação |
|---|---|
| `B ≈ P2` | `P2` é o total do itinerário selecionado; a implementação atual estaria correta. |
| `B ≈ P1 + P2` | `P1` é a ida e `P2` é a volta; o total precisa ser somado. |
| `B ≈ P1` e `P2` é o retorno | `P1` já é o total; não usar `P2` como total. |
| `B` diverge de todos | Há taxa/vendedor diferente; repetir com o mesmo vendedor e mesma tarifa antes de concluir. |

**Decisão proposta:** manter `REAL` bloqueado e não alterar `PriceHistory` agora. Depois da evidência, adotar a hipótese confirmada, com estas regras:

- o preço persistido deve representar o **itinerário selecionado ida+volta**, não “a ida” nem “a volta” isoladamente;
- se `P2` for total, manter `P2`; se `P2` for incremental, compor com `P1` apenas se `P1` for de ida; se `P1` já for total, não somar;
- a identidade da oferta deve incluir o voo/data da volta ou declarar explicitamente que a oferta é “ida + volta mais barata compatível”, com regra estável;
- `price_insights` continua metadado, não preço histórico;
- qualquer mudança de composição exige teste de regressão com fixture real e atualização do contrato/OpenAPI.

**Risco de não resolver:** o histórico pode registrar um valor que não corresponde ao produto exibido, e dois retornos diferentes podem colapsar no mesmo `externalKey`. Ambos são incompatíveis com a promessa de histórico e de oportunidade.

### 15.6 Base, impostos, moeda e representação monetária

**Estado atual comprovado:**

- `normalizeSerpApiOffer()` grava `price: { currency, total: rawOffer.price, base: null, taxes: null }`.
- `PriceHistory.base` e `.taxes` são `Float?`; `total` é `Float` obrigatório.
- `assertNormalizedOffer()` exige `price.currency` e `price.total`, mas não exige `base`/`taxes`.
- A persistência usa `offer.price.base ?? null` e `offer.price.taxes ?? null`; não converte ausência em zero.
- A análise converte preços em centavos inteiros para comparação, mas a persistência continua em ponto flutuante.
- O adaptador só aceita BRL: lê `search_parameters.currency`, normaliza para maiúsculas e falha se divergir; ausência usa BRL porque a requisição enviou BRL.
- `observedAt` é `new Date()` no momento da escrita, depois da resposta; não é o timestamp da cotação do provedor.

**Política proposta (sem migration nesta fase):**

1. `total` é o valor autoritativo da observação. Não reconstruir total a partir de componentes.
2. `base` e `taxes` só são preenchidos se o provedor expuser os dois de forma explícita, na mesma moeda e com semântica documentada. Caso contrário, permanecem `NULL`.
3. Nunca derivar impostos por subtração (`total - base`), percentual estimado ou arredondamento. Isso inventaria decomposição tributária.
4. Nunca converter `NULL` em `0`; `0` significa “zero conhecido”, `NULL` significa “não informado”.
5. Não somar `base + taxes` ao `total`; a decomposição é informativa, não uma segunda cobrança. Se `total ≠ base + taxes`, o `total` prevalece e a divergência vira qualidade de dados, não ajuste silencioso.
6. Uma moeda por observação; nenhuma conversão cambial automática; séries mistas continuam `INSUFFICIENT_DATA`/`MIXED_CURRENCY`. A aceitação de múltiplas moedas exige decisão de produto e de exibição.
7. `observedAt` deve ser descrito como “momento da observação TripPulse”, não “momento da cotação”. Se o produto precisar de `quoteAt`, isso exige campo/contrato novo, não inferência.

**Sobre `Float`:** `Float` do Prisma/PostgreSQL é ponto flutuante binário e não representa todos os decimais exatamente. Para preços em BRL, valores inteiros ou com duas casas geralmente sobrevivem à conversão para centavos, mas igualdade, soma e histórico de longo prazo não têm garantia decimal. A dívida é **bloqueante para uma liberação financeira séria** até uma decisão explícita: inteiro de menor unidade (por exemplo, centavos) com expoente da moeda, ou tipo decimal exato suportado pelo stack. Isso exigirá migration e revisão de todos os consumidores; não é escopo desta fase.

**Sobre dupla contagem:** o TripPulse não deve exibir “total + impostos” nem “base + taxes” como se fossem valores adicionais. Se o provedor só entrega um preço único, a UI deve mostrar “preço total informado” e deixar a decomposição como indisponível. `price_insights` não é decomposição e não entra no histórico.

### 15.7 Custos e viabilidade comercial

**Fórmula e premissas:** `requisições/mês = viagens ativas × ciclos/mês × (1 + N)`. Cada requisição pode consumir 1 crédito; o cache padrão de 1 h pode evitar consumo, mas **não presumir** que erro, falha ou token inválido sejam gratuitos. Verificar o contador antes/depois de cada chamada. A tabela abaixo é o pior caso sem cache. Planos com U.S. Legal Shield começam no Production (US$ 150/mês, 15.000 buscas, 3.000/h), premissa conservadora diante da contradição entre a página de pricing e as condições específicas do benefício, registrada no §15.8. Preços oficiais consultados em 16/11/2026; impostos não incluídos.

| Cenário | Viagens | Cadência | N | Requisições/mês | Plano mínimo com shield | Custo/mês | Custo/viagem |
|---|---:|---:|---:|---:|---|---:|---:|
| Pequena A | 50 | diária | 1 | 3.000 | Production 15k | US$ 150 | US$ 3,00 |
| Pequena B | 50 | 6 h | 3 | 24.000 | Big Data 30k | US$ 275 | US$ 5,50 |
| Pequena C | 50 | 15 min | 1 | 288.000 | Infrastructure 500k | US$ 2.750 | US$ 55,00 |
| Média A | 500 | diária | 1 | 30.000 | Big Data 30k | US$ 275 | US$ 0,55 |
| Média B | 500 | 6 h | 1 | 120.000 | Volume 250k | US$ 1.475 | US$ 2,95 |
| Média C | 500 | 15 min | 1 | 2.880.000 | Cloud 3M | US$ 7.600 | US$ 15,20 |
| Grande A | 5.000 | diária | 1 | 300.000 | Infrastructure 500k | US$ 2.750 | US$ 0,55 |
| Grande B | 5.000 | 6 h | 1 | 1.200.000 | Cloud 2M | US$ 5.675 | US$ 1,14 |
| Grande C | 5.000 | 6 h | 3 | 2.400.000 | Cloud 3M | US$ 7.600 | US$ 1,52 |
| Grande D | 5.000 | 15 min | 1 | 28.800.000 | Cloud 29M | US$ 57.800 | US$ 11,56 |
| Stress A | 50 | 15 min | 10 | 1.584.000 | Cloud 2M | US$ 5.675 | US$ 113,50 |
| Stress B | 5.000 | 15 min | 3 | 57.600.000 | acima do catálogo | enterprise sob consulta | — |

**Custo por requisição:** no Production, US$ 150 / 15.000 = **US$ 0,01 por busca** no uso integral; no Big Data, US$ 275 / 30.000 ≈ **US$ 0,00917**; no Volume, US$ 1.475 / 250.000 = **US$ 0,0059**. O custo por viagem da tabela é uma alocação do plano, não um preço marginal por requisição; capacidade ociosa encarece a viagem efetiva.

**Limites e picos:**

- Production cobre **2 viagens** a 15 min com N=1; a terceira excede. Com N=10, uma única viagem a 15 min consome 31.680 créditos e não cabe no Production.
- Throughput do Production: 3.000 buscas/hora. 1.500 viagens com N=1 disparadas na mesma hora já ocupam 3.000. O scheduler atual é sequencial (uma viagem por vez), o que reduz o pico, mas aumenta a duração do ciclo; chamadas manuais a `/flights` não têm rate limit e podem furar o orçamento.
- Cache de 1 h por consulta exata pode reduzir o consumo; a tabela não conta com isso. Se o produto promete 15 min, cache de 1 h é incompatível com a promessa de frescor; é preciso escolher entre frescor e custo.
- `SERPAPI_MAX_OUTBOUND_EXPANSIONS=10` multiplica o custo por 11 no round-trip. Cobertura de todas as combinações ida×volta não existe: no máximo N idas, cada uma com a volta mais barata; não é busca exaustiva.
- O plano Developer (US$ 75, 5.000) seria suficiente para 50 viagens diárias N=1 (3.000), mas o benefício **não está disponível nesse plano** segundo a página específica e os Termos (Seção 13) — apesar de a página de pricing exibir “U.S. Legal Shield” no cartão Developer. Para uso comercial que dependa do shield, o piso conservador é Production.

**Ponto de inviabilidade:** a 15 min, 50 viagens N=1 custam US$ 55/viagem/mês só de API; 50 viagens N=10 custam US$ 113,50/viagem/mês. Mesmo a 6 h, 500 viagens N=1 custam US$ 2,95/viagem/mês antes de infraestrutura, suporte, taxas e margem. A viabilidade não pode ser declarada sem preço do produto; a fórmula de decisão é:

```text
receita_líquida_por_viagem > custo_api_por_viagem + infra + suporte + taxas + margem_alvo
```

**Recomendação de piloto:** N=1, cadência diária ou 6 h, 50–500 viagens, Production/Big Data, sem 15 min e sem N>1 por padrão. Medir cache hit, latência e custo real antes de ampliar. O modo 15 min deve ser tratado como recurso premium ou desativado no lançamento real.

### 15.8 Revisão jurídica e comercial

**Natureza da análise:** revisão documental, não parecer jurídico. As conclusões abaixo distinguem fato documentado, interpretação e lacuna que exige confirmação por escrito ou advogado.

**Fontes primárias consultadas em 16/11/2026:**

| Fonte | URL | Uso |
|---|---|---|
| Google Flights API | https://serpapi.com/google-flights-api | parâmetros, `departure_token`, `price`, `no_cache`, moeda |
| Google Flights Booking Options | https://serpapi.com/google-flights-booking-options | `booking_options`, preço/taxas do itinerário selecionado |
| Pricing | https://serpapi.com/pricing | planos, buscas, throughput, Legal Shield, cache/contagem |
| Legal Documents | https://serpapi.com/legal | Termos de Serviço (atualizados em 27/08/2026), privacidade, retenção, foro |
| U.S. Legal Shield | https://serpapi.com/us-legal-shield | cobertura, exclusões, território, planos |
| Ordem judicial | https://storage.courtlistener.com/recap/gov.uscourts.cand.461513/gov.uscourts.cand.461513.62.0.pdf | `Google LLC v. SerpApi LLC`, N.D. Cal., 09/11/2026 |

**Respostas às perguntas obrigatórias:**

1. **Armazenar indefinidamente?** A SerpApi retém os dados de busca dela por 31 dias (política de privacidade). O contrato público não define prazo para cópias mantidas pelo cliente e não concede, de forma expressa, direito de armazenamento indefinido. **Não autorizado expressamente; exige confirmação escrita.**
2. **Exibir aos usuários finais?** Não há licença explícita de exibição. A Seção 2 dos Termos restringe “reproduzir, duplicar, copiar, vender, revender ou explorar qualquer parte do Serviço” sem permissão escrita. **Não autorizado expressamente; exige confirmação escrita e revisão jurídica.**
3. **Comercializar um produto baseado nos dados?** O Legal Shield cobre a coleta/parsing, não o uso posterior; a mesma Seção 2 restringe exploração comercial. **Não autorizado expressamente; não confundir com Legal Shield.**
4. **Alertas derivados da variação histórica?** Não há cláusula específica sobre obras derivadas, análises ou alertas. **Pendente; exige confirmação escrita.**
5. **Atribuição?** Não foi encontrada exigência de atribuição à SerpApi nos termos públicos. Marcas do Google, companhias aéreas, logos e regras tarifárias podem ter exigências próprias. **Pendente; confirmar com SerpApi e advogado.**
6. **Responsabilidades do cliente?** Uso lícito, conformidade legal, indenização à SerpApi e exclusão de usos ilegais. **Documentado, mas amplo e unilateral.**
7. **O que o Legal Shield cobre e quais planos são elegíveis?** Coleta/parsing lícitos de dados públicos de busca, até US$ 2 milhões. A página de pricing **exibe “U.S. Legal Shield” nos cartões Free, Starter e Developer**, além dos planos superiores; a página específica do benefício (“Production Plan and above”) e os Termos (Seção 13), que excluem expressamente “the Free, Starter, and Developer plans”, afirmam que o benefício existe **somente no Production+**. **Production+ é a premissa conservadora; não é licença de dados e exige confirmação escrita.**
8. **Limitação territorial?** A FAQ diz que a cobertura se limita a claims sob lei estadual/federal dos EUA em tribunal dos EUA; leis estrangeiras e tribunais não americanos ficam fora. O título “worldwide legal coverage” se refere a clientes internacionais, não a cobertura jurídica global. **Cobertura apenas nos EUA.**
9. **Interrupção sem aviso?** As Seções 4, 13 e 16 permitem modificar, suspender, remover ou terminar o serviço sem aviso e sem responsabilidade; existe SLA de 99,95% com créditos. **Sim, contratualmente possível.**
10. **Autorização contratual clara para o modelo?** Não foi encontrada autorização específica para armazenar, exibir, comercializar ou gerar alertas. **Não; exige aditivo/confirmação escrita e advogado.**

**Legal Shield ≠ licença de dados.** O shield é uma assunção de responsabilidade pela coleta/parsing, limitada e condicionada. Ele não concede direito de armazenar, exibir, vender ou criar produto derivado, e não cobre o uso posterior. Também não cobre DMCA — e o caso Google v. SerpApi é justamente sobre DMCA/Google Search.

**Caso judicial:** `Google LLC v. SerpApi LLC`, No. 4:25-cv-10826-YGR (N.D. Cal.). Google ajuizou em 19/12/2025; em 20/07/2026 o tribunal rejeitou a primeira versão; em 09/11/2026 rejeitou a segunda versão da acusação, com autorização para emenda em 21 dias. Não há sentença final. O caso trata de Google Search/SearchGuard, **não de Google Flights**; não serve como validação de direitos sobre tarifas aéreas. O resultado favorável à SerpApi até aqui é um fato, não uma garantia para clientes.

**Conclusão comercial/jurídica:** o modelo completo (armazenar histórico, exibir ofertas, cobrar pelo produto e gerar alertas) **não está autorizado de forma clara** pela documentação pública. Antes de `REAL`, obter confirmação escrita da SerpApi cobrindo especificamente esses usos e parecer de advogado sobre Google Flights, marcas, tarifas e jurisdição brasileira. Não apresentar o Legal Shield como licença.

**Contradição documental sobre o Legal Shield:** a **página de pricing** exibe “U.S. Legal Shield” **também nos cartões Free, Starter e Developer**, além dos planos superiores — apresentação comercial que sugere disponibilidade em todos os planos. Em sentido contrário, a **página específica do benefício** diz “Production Plan and above” e os **Termos (Seção 13)** excluem expressamente “the Free, Starter, and Developer plans”. A contradição é entre a **apresentação comercial** e as **condições específicas do benefício**: a primeira sugere alcance amplo, as segundas restringem a Production+. A leitura conservadora é **Production+**, e permanece pendente a **confirmação escrita da SerpApi** sobre elegibilidade, cobertura e uso comercial. Não usar a exibição nos cartões inferiores para sustentar direito em plano que o Termo exclui.

### 15.8.1 LGPD — análise preliminar (não é parecer jurídico)

**Fluxo e categorias de dados.** O TripPulse recebe origem, destino, datas e nome da viagem — dados que podem ser pessoais ou vinculados a uma pessoa, embora hoje não haja autenticação e a titularidade ainda não esteja individualizada. O adaptador envia à SerpApi apenas a consulta de voo (aeroportos, datas, moeda, locale e classe), não nome, e-mail, documento ou pagamento. A SerpApi pode processar IP, metadados de requisição e resultados; o TripPulse persiste ofertas, histórico de preços e itens de monitoramento. A oferta normalizada não tem campo de token e o `booking_token` não é transportado para ela pelo fluxo atual, e a ausência nos destinos sensíveis (requisições, oferta normalizada, resposta HTTP, histórico e JSONB de monitoramento) tem cobertura de regressão por **testes de fronteira** desde 20/11/2026 (`tests/booking-token*.test.js`, 8 testes, `81d5bb3`), sem busca `REAL` ponta a ponta — a persistência de oferta do mapeador SerpApi segue bloqueada por `baggagePieces`/`refundable` nulos, bloqueador separado do token. A chave da API é segredo de serviço, não dado pessoal do usuário.

**Papéis dos agentes.** Em análise preliminar: TripPulse como controladora dos dados das viagens e do histórico; SerpApi como operadora/subprocessadora da consulta e do parsing; Google Flights e demais fornecedores como terceiros/subprocessadores da SerpApi; hospedagem, banco e observabilidade como subprocessadores do TripPulse. Os papéis definitivos dependem do contrato, do DPA e da autenticação futura.

**Base legal.** Não há conclusão definitiva. Hipóteses a validar: execução de contrato ou procedimentos preliminares (art. 7º, V, LGPD); legítimo interesse (art. 7º, IX) para segurança, prevenção a fraude e melhoria; consentimento específico para marketing ou comunicações não necessárias; obrigação legal ou regulatória quando aplicável. A base escolhida deve constar do inventário de tratamentos e do aviso de privacidade.

**Transferência internacional.** A SerpApi está nos Estados Unidos e pode usar subprocessadores em outras jurisdições. A transferência exige hipótese legal e mecanismo do art. 33 da LGPD (decisão de adequação, cláusulas contratuais padrão, normas corporativas globais ou outra hipótese legal), com avaliação documentada. A **Resolução CD/ANPD nº 19/2024** disciplina a transferência internacional e deve ser verificada quanto a escopo, cláusulas, prazos e transparência; a aplicabilidade concreta exige confirmação jurídica.

**DPA e subprocessadores.** Solicitar à SerpApi o DPA vigente e a lista de subprocessadores; verificar finalidade, instruções, confidencialidade, segurança, notificação de incidentes, subcontratação, auditoria, retenção/eliminação e cooperação com titulares e ANPD. A política pública lista AWS, Cloudflare, Wasabi, Airbrake, Intercom, FrontApp, ActiveCampaign, MaxMind, Stripe, Postmark, Prelude, provedores de proxy e Google, entre outros; a lista pode mudar. O TripPulse precisa de mecanismo de aviso/objeção e de inventário próprio.

**Minimização e transparência.** Não enviar à SerpApi dados que a consulta não exige; não persistir tokens, corpos brutos ou credenciais; sanitizar logs e itens de monitoramento; definir retenção e eliminação; informar no aviso de privacidade a finalidade, os destinatários, a transferência internacional e os direitos do titular. Minimização não elimina a necessidade de base legal, DPA e avaliação de transferência.

**Conclusão preliminar:** a LGPD exige análise e documentação antes de `REAL`, mas esta subseção **não conclui** que o tratamento é lícito ou ilícito. DPA, base legal, transferência internacional, retenção e transparência devem ser confirmados por advogado/DPO e pela SerpApi.

### 15.9 Checklist de segurança

| Controle | Estado | Evidência / lacuna |
|---|---|---|
| Chave apenas no backend | ✅ | `SERPAPI_API_KEY` em env; closure; não versionada |
| Chave em URL de saída | 🟡 | exigência do provedor; TLS; não logada pela aplicação, mas pode aparecer em telemetria de rede |
| Chave em mensagens de erro | ✅ | sanitização e testes sintéticos; falta teste integrado de logs |
| `departure_token` | ✅ | usado só na 2ª requisição; removido do raw `outbound`/`return`; testes cobrem raw e normalizado; não persistido |
| `booking_token` | 🟡 | nunca enviado; **permanece em `raw.outbound`/`raw.return`** (fixado por teste); não é transportado para a oferta normalizada, resposta HTTP, histórico ou JSONB — ausência coberta por 8 testes **de fronteira** (`tests/booking-token*.test.js`, `81d5bb3`), sem busca `REAL` ponta a ponta; falta o teste integrado de logs/redaction |
| Barreira `REAL` pré-provider | ✅ | `assertOnlySimulatedProviders` antes de banco/rede |
| Barreira pós-normalização | ✅ | `assertOnlySimulatedOffers` |
| Barreira na persistência | ✅ | D5 em `persistOfferSnapshot` |
| Timeout | 🟡 | 30 s por requisição; sem orçamento total |
| Retry/backoff/jitter | ❌ | não implementado |
| Resultado parcial | ✅ | fail-closed; erro em qualquer expansão aborta o trip |
| Idempotência | ❌ | nova observação a cada execução; sem chave de idempotência |
| Rate limit / quota | ❌ | `/flights` aberto; sem limite por usuário/IP/período |
| Orçamento/custo | ❌ | sem contador de créditos nem alerta |
| Autenticação/multiusuário | ❌ | Fase 6; viagens globais |
| Cache/frescor | 🟡 | cache de 1 h aceito por default; sem política |
| Circuit breaker | ❌ | indisponibilidade vira erro genérico; sem disjuntor |
| Kill switch runtime | 🟡 | flags exigem restart; sem desligamento em quente |
| Observabilidade | ❌ | sem métricas de provider, latência, erro, cache ou custo |
| Logs/redaction | 🟡 | logger ativo; sem redaction explícita; teste integrado pendente |
| D5/D6/D7 | ✅ | preservados; nenhuma alteração nesta fase |
| Testes com provedor real | ❌ | somente fixtures sintéticas |

**Conclusão:** a barreira e a confidencialidade básica estão corretas, mas faltam controles essenciais para exposição comercial: orçamento, idempotência, rate limit, kill switch, observabilidade, disjuntor e teste integrado de logs.

### 15.10 Fatos, interpretações e lacunas

| Classe | Itens |
|---|---|
| **Fato documentado** | fluxo de duas requisições com `departure_token`; parâmetros de `type=1`; cache de 1 h por consulta exata; a documentação oficial informa contagem de buscas bem-sucedidas, mas a cobrança de falhas/token inválido não é presumida e deve ser medida no contador; planos e preços publicados; Legal Shield exibido nos cartões de todos os planos na página de pricing, mas restrito ao Production+ pela página específica do benefício e pelos Termos (Seção 13), que excluem Free/Starter/Developer; cobertura limitada a claims nos EUA; retenção de 31 dias na SerpApi; Termos que restringem exploração sem permissão escrita; decisão judicial de 09/11/2026. |
| **Interpretação** | a hipótese de que o `price` da segunda resposta seja o total do trip; a leitura de que a Seção 2 exige autorização escrita para o modelo; a estimativa de que o cache possa reduzir custos; a classificação de “inviável” para 15 min/N=10 sem preço de produto. |
| **Não encontrado** | cláusula expressa autorizando armazenamento indefinido, exibição a usuários finais, comercialização de produto derivado ou alertas; exigência de atribuição à SerpApi; definição oficial inequívoca do preço do round-trip; política de retenção para cópias do cliente; cobertura do Legal Shield para DMCA ou uso posterior. |
| **Exige confirmação escrita da SerpApi** | licença de uso dos resultados; armazenamento/exibição/comercialização; alertas derivados; atribuição; retenção; comportamento de planos/limites; eventual suporte a Google Flights. |
| **Exige advogado** | licença de dados e propriedade intelectual; Google Flights/termos do Google; marcas; DMCA; proteção ao consumidor; LGPD (base legal, transferência internacional, Resolução CD/ANPD 19/2024, DPA e subprocessadores); contratos com usuários; jurisdição e riscos de litígio. |
| **Lacuna de teste** | ~~ausência de teste específico de regressão para `booking_token`~~ **resolvida em 20/11/2026**: 8 testes em `tests/booking-token*.test.js` (publicados em `81d5bb3`) provam, **nas fronteiras** (§15.14), que o token nunca é enviado, permanece apenas no raw interno e não chega à oferta normalizada, à resposta HTTP, ao `flight_offers`, ao `price_history` nem ao JSONB de `monitoring_runs`; não houve busca `REAL` ponta a ponta e resta o teste integrado de logs/redaction. |

### 15.11 Critérios formais de liberação REAL

Todos são **impeditivos** até resolução documentada. Qualquer item aberto mantém `REAL` bloqueado.

- [ ] **D3 validado** com conta autorizada, evidências R1–R7 e fixtures reais sanitizadas.
- [ ] **Contador de créditos** verificado antes/depois de cada chamada, inclusive em falha e token inválido.
- [ ] **Preço round-trip** confirmado contra `booking_options`/UI, com seller e preço correspondente.
- [ ] **Cache e `no_cache=true`** testados separadamente (R7-C/R7-N).
- [ ] **Identidade da oferta** distingue a volta ou declara uma semântica estável e testada.
- [ ] **Base/impostos** com política definida; nenhum valor derivado ou inventado.
- [ ] **Moeda** validada; política para múltiplas moedas definida.
- [ ] **`Float`** resolvido (inteiro de menor unidade/decimal) ou risco formalmente aceito por escrito.
- [ ] **Direitos de dados** confirmados por escrito: armazenar, exibir, comercializar, alertar e reter.
- [ ] **Legal Shield** ativo em Production+, divergência de planos esclarecida por escrito e escopo/exclusões compreendidos; parecer jurídico.
- [ ] **LGPD**: base legal, papéis, transferência internacional, Resolução CD/ANPD 19/2024, DPA, subprocessadores, retenção e transparência documentados; parecer jurídico/DPO.
- [ ] **Viabilidade** demonstrada com plano, throughput, custo por viagem e orçamento máximo.
- [ ] **Autenticação/rate limit/multiusuário** implementados ou piloto fechado com allowlist explícita.
- [ ] **Idempotência** de observações e de requisições implementada.
- [ ] **Retry/backoff/jitter, circuit breaker e limite de consumo** implementados.
- [ ] **Kill switch em runtime** e plano de desativação emergencial testados.
- [ ] **Logs com redaction**, auditoria de falhas e teste integrado de vazamento.
- [ ] **Observabilidade** de latência, erros, cache, requisições e custo com alertas.
- [ ] **Testes de integração reais** no CI e **auditoria independente aprovada**.
- [ ] **Plano de contingência** para indisponibilidade, aumento de preço, mudança de termos e interrupção do provedor.

**Nenhum desses itens foi implementado ou validado nesta fase.** O objetivo foi produzi-los como critérios objetivos, não declarar aprovação.

### 15.12 Alterações documentais e estado final

**Alterações desta fase:**

- `docs/contexto.md`: roadmap atualizado (Fase 4 publicada; Fase 5 com planejamento concluído em 16/11/2026; liberação REAL bloqueada) e novo §12 com o planejamento detalhado.
- `docs/relatorio-continuidade.md`: cabeçalho e estado por funcionalidade atualizados para `a68bf73`; novo §15 com auditoria, protocolo, preços, custos, jurídico, segurança e critérios.
- `README.md`: quatro correções pontuais — (a) D3 registrado como **publicado em `6abba27`** (CI `43788295629`), não mais “implementado localmente/sem commit”; (b) `booking_token` restrito a “**nas requisições**” no bullet de cobertura; (c) item de tokens separando `departure_token` (usado só na 2ª requisição, removido do raw por cópia, com testes em `outbound`, `return` e no objeto normalizado) de `booking_token` (**nunca enviado**, não removido do raw `return`, não transportado para a oferta normalizada pelo fluxo atual, sem teste específico de regressão); (d) pendência (5) com o resumo do **protocolo R1–R7** (6 requisições HTTP positivas; 8 com R7-C/R7-N; teste negativo fora da conta), a **dependência de cache** (R4, R5/R6 condicionais, R7-C com cache padrão e R7-N com `no_cache=true`) e a **contabilidade de créditos** (requisição não equivale a crédito; cobrança não presumida em falha ou token inválido; contador conferido antes/depois de cada chamada; sem custo exato sem contador).

**Revisão documental pós-diff (16/11/2026):** correção dos checkpoints históricos (3.5, 3.6 e Fase 4); protocolo R1–R7 com duas execuções positivas completas (**6 requisições HTTP; 8 com R7-C/R7-N**), separação entre requisições HTTP e créditos potenciais, dependência de cache explicitada (R4, R5/R6 condicionais e R7-C) e **R7-N** com `no_cache=true`, contador de créditos e cobrança não presumida em falha/token inválido, sem prometer custo exato sem contador; captura ampliada de R3 (`selected_flights`, `separate_tickets`, `together`, `departing`, `returning`, `baggage_prices`, seller e preço); registro da **contradição do Legal Shield** entre a página de pricing (que exibe “U.S. Legal Shield” também nos cartões Free, Starter e Developer) e a página específica do benefício mais os Termos (Seção 13), que o restringem a Production+ — mantendo Production+ como premissa conservadora e a confirmação escrita como pendência; **contabilidade de créditos** descrita como perda de expectativa de cache hit (e não como consumo necessário) quando parâmetros mudam, o token expira ou o cache vence, com conferência do contador; subseção LGPD preliminar; separação documental entre `departure_token` (removido do raw) e `booking_token` (não enviado; não removido do raw; não transportado para a oferta normalizada pelo fluxo atual; teste específico de regressão ausente).

**Correção final de coerência (16/11/2026):** `§12.6` (contexto) e `§15.8` (este relatório) passaram a descrever o Legal Shield como **contradição entre a apresentação comercial e a condição específica do benefício** — a página de pricing exibe “U.S. Legal Shield” nos cartões Free, Starter e Developer, além dos superiores, enquanto a página específica do benefício e os Termos (Seção 13) o restringem a **Production+**; a premissa conservadora continua Production+ e a confirmação escrita da SerpApi permanece pendente. A frase sobre cache em `§12.2`/`§15.4` passou a registrar que a consulta **perde a expectativa de cache hit e pode consumir crédito ao resultar em busca bem-sucedida**, sem afirmar consumo necessário, mantendo a conferência do contador antes/depois de cada chamada. `§15.10` acompanhou as duas correções.

**Não alterado:** código de aplicação, `apps/api/src/**`, `prisma/schema.prisma`, migrations, `package.json`/lockfile, `.env.example`, barreira `REAL`, normalizador, contratos de providers, D5/D6/D7, testes ou fixtures. Nenhum staging, commit ou push.

**Estado Git final:** `main == origin/main == a68bf73`, com apenas os três arquivos de documentação modificados no working tree e staging vazio. Verificado por `git status`, `git diff --stat` e `git diff --check` (exit 0); nenhum arquivo de código, Prisma, migration, dependência ou teste foi alterado.

### 15.13 Riscos e próximos passos

**Riscos principais:**

1. **Jurídico/comercial:** ausência de autorização expressa para o modelo; Legal Shield não é licença e não cobre uso posterior/DMCA; cobertura apenas nos EUA; termos permitem interrupção.
2. **Produto/preço:** usar `P2` sem confirmar pode registrar preço errado; a identidade sem volta pode misturar produtos e invalidar histórico/oportunidades.
3. **Financeiro:** 15 min e N>1 elevam o custo a US$ 55–113,50/viagem/mês; Production não sustenta 3 viagens a 15 min; picos e chamadas manuais não têm limite.
4. **Operacional:** sem idempotência, rate limit, orçamento, disjuntor, kill switch em runtime ou observabilidade de custo.
5. **Privacidade/segurança:** cache implícito, logs sem redaction explícita, teste integrado de vazamento pendente e chave em query do provedor.
6. **Qualidade de dados:** `observedAt` local, base/taxes nulos, `Float`, moeda única e cobertura parcial de retornos.

**Próximos passos, em ordem, após revisão do usuário:**

1. Aprovar ou rejeitar este planejamento e definir o orçamento máximo da validação.
2. Autorizar a validação D3 em conta de teste, com protocolo R1–R7 e contador de créditos, sem tocar no ambiente de produção.
3. Capturar evidências e fixtures sanitizadas; comparar R3/R6/R7-C/R7-N e decidir a semântica do preço com `B`.
4. Em etapa de implementação separada, corrigir identidade de round-trip e política monetária.
5. Obter confirmação escrita da SerpApi e parecer jurídico antes de qualquer uso comercial.
6. Definir piloto, plano, cadência, N e orçamento; implementar controles de segurança.
7. Submeter a auditoria independente e só então propor a liberação de `REAL`.

### 15.14 Testes de regressão do `booking_token` (20/11/2026)

**Natureza:** primeira melhoria técnica da Fase 5, executada **somente em testes** — nenhuma alteração em `apps/api/**`, Prisma, migrations, dependências, barreira `REAL`, normalizador, D5/D6/D7 ou chamada à SerpApi.

**Escopo — testes de fronteira, não ponta a ponta:** a cobertura prova a ausência do token nas fronteiras do fluxo; ela **não** é uma execução ponta a ponta com a SerpApi real.

1. **Adaptador e normalização:** `tests/booking-token.test.js` (4) roda com **fixtures sintéticas e `fetch` injetado** — nenhuma chamada de rede e nenhuma credencial.
2. **HTTP:** `tests/booking-token-persistence.test.js` (1 dos 2) exercita `GET /trips/:tripId/flights` por `app.inject()` com **dados simulados** e **contrato fechado** (chaves exatas; sem `booking_token`, `departure_token`, `outbound`, `return` ou `raw`). **Nenhuma oferta `REAL` foi exposta pelo endpoint** — a barreira bloqueia antes da chamada.
3. **Persistência:** o outro teste do mesmo arquivo chama `persistOfferSnapshot` com **oferta sintética persistível** (`SIMULATED`, `baggagePieces`/`refundable` preenchidos) que carrega **propriedades extras** `booking_token`, `outbound` e `return`; a varredura de todas as colunas de `flight_offers`/`price_history` não encontra a sentinela.
4. **JSONB:** `tests/booking-token-monitoring.test.js` (2) exercita o **fluxo real de monitoramento** (`startMonitoringRun` → `runMonitoringCycle` → `UPDATE items`) com **PostgreSQL de verdade e provider sintético**, lendo o `items` gravado; o segundo teste usa o **adaptador SerpApi com `fetch` sintético** para a sanitização do erro externo, e o item FAILED chega ao JSONB sem o token.
5. **Limitação:** **não foi executada uma busca SerpApi `REAL` ponta a ponta**; a barreira `REAL` continua bloqueando esse caminho (503 antes da chamada, `calls.length === 0`). A **incompatibilidade `baggagePieces`/`refundable`** — o mapeador SerpApi os produz como `null` e o schema os exige `NOT NULL` — continua sendo um **bloqueador separado** para persistir uma oferta normalizada por esse mapeador; é alheio ao `booking_token` e é por isso que os testes de persistência e de JSONB usam oferta/raw do dialeto simulável.

**Arquivos novos:**

| Arquivo | Testes | Cobertura |
|---|---|---|
| `tests/booking-token.test.js` | 4 | fronteira adaptador/normalização (fixtures sintéticas, `fetch` injetado): token nunca vira parâmetro da 1ª nem da 2ª requisição; `departure_token` continua sendo enviado; `booking_token` permanece em `raw.outbound`/`raw.return`; ausência na oferta normalizada e nas mensagens de erro |
| `tests/booking-token-persistence.test.js` | 2 | fronteira HTTP (endpoint com dados simulados e contrato fechado; nenhuma oferta `REAL` exposta) e de persistência (`persistOfferSnapshot` com oferta sintética persistível e extras `booking_token`/`outbound`/`return`; varredura de `flight_offers`/`price_history`) |
| `tests/booking-token-monitoring.test.js` | 2 | fronteira JSONB: fluxo real de monitoramento em PostgreSQL com provider sintético (`monitoring_runs.items`, chaves exatas e varredura da sentinela) e adaptador SerpApi com `fetch` sintético na sanitização do erro externo; barreira `REAL` bloqueia antes da chamada (`503`, `calls.length === 0`) |

**Contagem:** 8 testes novos (4 + 2 + 2), somando **343 declarações `test(...)` em 28 arquivos**. A suíte completa **não foi reexecutada** nesta etapa; a expectativa de 344 resultados no runner depende de o helper `tests/helpers/test-database-url.js` continuar sendo descoberto, o que não foi medido.

**Publicação:** commit `81d5bb3e8a30e8e7559f60354863adcdef5a51c2` (`test: add booking token leakage regression coverage`), `9c2fe22..81d5bb3` em `main`. Após o push e o `git fetch origin`: `main == origin/main == 81d5bb3`, divergência `0/0`, working tree limpa. O CI (`ci.yml`) registrou a execução **#16** (`44829121134`, evento `push`, job `Testes (Node 24 + PostgreSQL 17)`) com conclusão **`success`** e todas as etapas concluídas; os logs detalhados do job exigem acesso administrativo e não foram lidos.

**O que continua pendente:** o `booking_token` **permanece** em `raw.outbound`/`raw.return` — os testes fixam esse comportamento, não pedem sua remoção. A cobertura é de fronteira e **não** substitui a validação integrada de logs e `redaction`, nem uma execução ponta a ponta com a SerpApi real; o bloqueador `baggagePieces`/`refundable` do mapeador SerpApi permanece aberto e é independente do token, assim como segue pendente a validação do protocolo D3 com provedor real e as demais pendências da Fase 5.

**Este relatório não declara o D3 validado com provedor real, não declara viabilidade comercial e não autoriza a remoção da barreira 503.**
