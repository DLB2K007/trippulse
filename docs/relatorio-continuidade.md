# Relatório de continuidade — TripPulse

> Gerado em 2026-11-07, após o commit `8a185f8` (`main`, sincronizado com `origin/main`).
> Documento de contexto oficial do projeto: **`docs/contexto.md`** (o usuário pode referir-se a ele por outros nomes, como "PROJECT_CONTEXT.md" — é sempre este arquivo).
> Nada no código foi alterado durante a elaboração deste relatório.

---

## 1. Visão geral

### Objetivo do projeto
Construir uma plataforma inteligente de **monitoramento e comparação de preços de viagens**: o usuário cadastra o contexto de uma viagem e recebe atualizações periódicas de oportunidades de economia (passagens aéreas, hospedagens, aluguel de veículos, passeios), evoluindo até um agente de IA de monitoramento automatizado.

### Problema resolvido atualmente
Fundação backend funcional para cadastro de contexto de viagem e observação de **ofertas de passagens (simuladas)** com **histórico de preços e comparativo de tendências** — base para o futuro monitoramento automatizado.

### Estado por funcionalidade (conforme `docs/contexto.md`)

| Funcionalidade (contexto) | Estado |
|---|---|
| Servidor Node.js + API REST (Fastify) | ✅ Implementado e testado (Dia 1) |
| Conexão ao PostgreSQL (Docker + Prisma 7) | ✅ Implementado e testado (Dia 2) |
| Cadastro e consulta de viagens (CRUD) | ✅ Implementado e testado (Dia 3) |
| Pesquisa **simulada** de ofertas de voos | ✅ Implementado e testado (Dia 4) |
| Persistência de ofertas + histórico de preços | ✅ Implementado e testado (Dia 5) |
| Documentação e testes dos principais fluxos | ⏳ Parcial — testes **manuais** via HTTP; sem suíte automatizada |
| Integração **real** com provedores | ❌ Não iniciado (bloqueio de escopo do MVP) |
| Análise por agente de IA | ❌ Não iniciado |
| Monitoramento programado, notificações (Telegram/e-mail/dashboard) | ❌ Não iniciado |
| Hotéis, veículos, atividades | ❌ Não iniciado |
| Publicação do produto | ❌ Não iniciado |

---

## 2. Arquitetura

### Stack e versões (do `package.json` e ambiente)

- **JavaScript puro com ES Modules** (`"type": "module"`), sem TypeScript no código de aplicação
- **Node.js**: v24.14.0 no ambiente (mínimo declarado: `>=20.6.0`, pelo `--env-file` nativo)
- **fastify**: `^5.12.8` (HTTP + JSON Schema nativo para validação)
- **prisma**: `^7.10.1` e **@prisma/client**: `^7.10.1` (CLI fixado deliberadamente — `latest` do npm aponta para `8.0.0-rc`, não estável)
- **@prisma/adapter-pg**: `^7.10.1` (driver adapter **obrigatório** no Prisma 7)
- **dotenv**: `^18.0.9` (consumido pelo `prisma.config.ts`)
- **PostgreSQL 17** (imagem `postgres:17-alpine`) em Docker (Docker 29.9.2, Compose v5.6.1)
- **Git/GitHub**: https://github.com/DLB2K007/trippulse.git — branch `main`

### Estrutura de diretórios

```text
trippulse/
├── apps/api/src/
│   ├── config/
│   │   ├── env.js                        # carrega/valida PORT e HOST (com defaults)
│   │   └── prisma.js                     # instância única de PrismaClient (adapter-pg)
│   ├── modules/
│   │   ├── trips/
│   │   │   ├── trips.service.js          # regras de negócio + acesso a dados (CRUD)
│   │   │   └── trips.routes.js           # rotas HTTP finas + JSON Schema
│   │   ├── flights/
│   │   │   ├── flights.service.js        # orquestra pesquisa → normalização → snapshot
│   │   │   └── flights.routes.js         # GET /trips/:tripId/flights (plugin, prefixo /trips)
│   │   └── offers/
│   │       └── offers.service.js         # externalKey, persistOfferSnapshot, tendências
│   ├── integrations/
│   │   └── flight-providers/
│   │       ├── index.js                  # registro de provedores (contrato + array)
│   │       ├── normalize.js              # normalização bruto→canônico + garantia SIMULATED
│   │       └── simulated/
│   │           └── simulated-flight-provider.js  # provedor externo simulado
│   ├── shared/
│   │   └── errors.js                     # HttpError(statusCode, message)
│   ├── app.js                            # monta Fastify + /health + registro de plugins
│   └── server.js                         # bootstrap (listen)
├── docs/
│   ├── contexto.md                       # fonte única de verdade dos requisitos
│   └── relatorio-continuidade.md         # este arquivo
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│       ├── 20261107211054_init_create_trips/
│       └── 20261107214055_add_flight_offers_and_price_history/
├── prisma.config.ts                      # conexão do Prisma CLI (dotenv/Database_URL)
├── docker-compose.yml                    # postgres:17-alpine, porta host 5433
├── .env.example / .env (não versionado)  # PORT, HOST, DATABASE_URL
├── .gitignore / README.md / package.json / package-lock.json
```

### Responsabilidades por módulo

| Módulo | Responsabilidade |
|---|---|
| `config/` | Somente ambiente (PORT/HOST) e conexão com banco. Único lugar que lê `process.env` (prisma.js lê `DATABASE_URL`) |
| `modules/trips` | CRUD de viagens; validação de forma na rota (JSON Schema do Fastify), regras de negócio no service |
| `modules/flights` | Orquestra a pesquisa de voos de uma viagem: carrega viagem → chama provedores → normaliza → persiste snapshot → anexa `history` |
| `modules/offers` | Domínio de ofertas: identidade (`externalKey`), snapshot de preço, melhor preço observado, tendência |
| `integrations/flight-providers` | Contrato de provedores de voos `{ name, isSimulated, search(query, options) }`; registro único; normalizadores por provedor |
| `shared/` | `HttpError` reconhecido pelo serializador padrão do Fastify |
| `app.js` | Instância Fastify (logger), rota `/health`, registro de plugins (`tripsRoutes`, `flightRoutes` ambos no prefixo `/trips`) |

### Fluxo principal (pesquisa de voos)

```
GET /trips/:tripId/flights
  → flights.routes (valida forma)
  → flights.service:
      1. carrega Trip (404 se ausente)
      2. monta query { destination, departureDate, returnDate }  [origem não existe no modelo]
      3. variationSeed = floor(histórico/quantidade de ofertas previamente conhecidas)
      4. para cada provedor do registro (Promise.all):
           provider.search(query, { variationSeed })  → ofertas BRUTAS
           normalizeFlightOffer(provider, raw, query) → oferta CANÔNICA (classifica SIMULATED)
      5. persistOfferSnapshot(tripId, offers)  [modules/offers]
           - find-or-create FlightOffer por (tripId, externalKey)
           - cria PriceHistory (total/base/taxes/observedAt)
           - tendência vs. observação anterior real do banco
      6. resposta: { simulated, persisted, providerCount, query, offers[] + history }
```

---

## 3. Implementações

### Endpoints concluídos

| Método | Rota | Status de sucesso | Notas |
|---|---|---|---|
| `GET` | `/health` | 200 | `{ "status": "ok", "service": "trippulse-api" }` |
| `POST` | `/trips` | 201 | JSON Schema: name, destination, startDate, endDate (obrigatórios, datas `YYYY-MM-DD`) |
| `GET` | `/trips` | 200 | Lista, ordenada por startDate asc |
| `GET` | `/trips/:id` | 200 / 400 / 404 | UUID validado no service |
| `PUT` | `/trips/:id` | 200 / 400 / 404 | Atualização completa (mesmo schema do POST) |
| `DELETE` | `/trips/:id` | 204 | Cascade apaga ofertas e histórico |
| `GET` | `/trips/:tripId/flights` | 200 / 404 | Pesquisa simulada, snapshot persistido, `history` por oferta |

### Principais funções implementadas

- `trips.service.js`: `createTrip`, `listTrips`, `getTripById`, `updateTrip`, `deleteTrip`, helpers `assertValidTripId` (regex UUID), `assertValidTripData` (endDate ≥ startDate), `parseTripDates` (datas serializadas como `YYYY-MM-DD` na resposta)
- `offers.service.js`: `buildOfferExternalKey(offer)` (provedor|origem|destino|companhia|nº voo|partida), `persistOfferSnapshot(tripId, offers)` → `Map<externalKey, { observedAt, current, previous, best, trend }>`
- `flights.service.js`: `searchFlightsForTrip(tripId)` com cálculo de `variationSeed`
- `normalize.js`: `normalizeFlightOffer(provider, rawOffer, relatedQuery)` + `assertNormalizedOffer` (campos obrigatórios do padrão interno) + **barreira** que lança erro se classificação sair como `REAL`
- `simulated-flight-provider.js`: `search(query, { variationSeed })` — PRNG com semente própria (`createSeededRandom`, `deriveAirportCode`, `addHours`)

### Padrão canônico de oferta (definido em `normalize.js`)

```js
{
  provider: string, isSimulated: boolean, dataClassification: 'SIMULATED'|'REAL',
  type: 'flight',
  route: { origin, destination },
  dates: { departureDate, arrivalDate },
  flight: { airline, flightNumber, stops, cabinClass, baggagePieces, refundable },
  price: { currency, total, base, taxes },
  relatedQuery: { destination, departureDate, returnDate }
}
// + history: { observedAt, current, previous, best, trend }
//   trend ∈ FIRST_OBSERVATION | DROPPED | ROSE | UNCHANGED
```

### Scripts npm

- `start` / `dev` (`--watch`) / `start:no-env` — servidor (Node carrega `.env` via `--env-file`)
- `db:migrate` → `prisma migrate dev` · `db:deploy` → `prisma migrate deploy`
- **Importante**: não existe script/automatização do `prisma generate` (ver Problemas conhecidos)

### Dependências instaladas

`fastify`, `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `dotenv`. Aceito que só `fastify`, `prisma`, `@prisma/client`, `@prisma/adapter-pg` e `dotenv` são usadas (nenhuma outra presente). Nenhuma dependência de teste instalada.

---

## 4. Banco de dados

### Modelos e relacionamentos (Prisma 7, PostgreSQL, tabela snake_case)

```text
trips (Trip)
  id uuid pk · name · destination · start_date date · end_date date · created_at · updated_at
  └─< flight_offers (FlightOffer)  [trip_id FK, onDelete CASCADE]
        id uuid pk · trip_id · provider · data_classification · type · origin · destination ·
        departure_date · arrival_date · airline · flight_number · stops · cabin_class ·
        baggage_pieces · refundable · external_key · created_at · updated_at
        @@unique(trip_id, external_key)
        └─< price_history (PriceHistory)  [offer_id FK, onDelete CASCADE]
              id uuid pk · offer_id · currency · total float · base float · taxes float · observed_at
              @@index(offer_id, observed_at)
```

### Migrações aplicadas

1. `20261107211054_init_create_trips` — cria `trips`
2. `20261107214055_add_flight_offers_and_price_history` — cria `flight_offers`, `price_history` e FKs/índices

### Ambiente de banco

- Container `trippulse-db` (`postgres:17-alpine`), healthcheck `pg_isready`, volume `trippulse_trippulse-db-data`
- **Porta 5433 no host** → 5432 no container (escolha obrigatória: o Windows do desenvolvedor já possui um serviço PostgreSQL na 5432)
- `DATABASE_URL=postgresql://trippulse:trippulse@localhost:5433/trippulse?schema=public` (credenciais locais de ambiente de desenvolvimento — documentadas em `.env.example`)

---

## 5. Decisões técnicas

| # | Decisão | Justificativa | Alternativas descartadas |
|---|---|---|---|
| 1 | **Prisma 7.10.1 (estável) em vez de 8.x** | `latest` do npm = `8.0.0-rc` (release candidate); o contexto exige versões estáveis | Prisma 8 (novo CLI em 3 etapas: contract emit / migration plan / db migrate) |
| 2 | **`prisma.config.ts` + dotenv** | No Prisma 7 a `url` saiu do schema (validação falha sem o config); guia oficial recomenda `import "dotenv/config"` | Passar `--env-file` para o CLI (frágil com `npx`) |
| 3 | **Generator `prisma-client-js` (deprecado) em vez do `prisma-client` (padrão v7)** | O padrão v7 emite **TypeScript** e o projeto é **JavaScript puro** sem pipeline de build; `prisma-client-js` gera para `node_modules`, consumível nativamente pelo Node ESM | Converter projeto para TS / usar `tsx` (fora de escopo; reavaliar se o projeto migrar) |
| 4 | **`@prisma/adapter-pg` obrigatório** | O client do Prisma 7 é "Rust-free" — erro explícito "A driver adapter is required"; constatado também com o generator clássico | `@prisma/client` sem adapter (impossível na v7) |
| 5 | **Porta **5433** do host** | Serviço PostgreSQL nativo do Windows ocupa a 5432 (PID `postgres`); conexões em `localhost:5432` caiam nele e geravam `P1000` | Alterar credenciais do PostgreSQL local (invasivo) |
| 6 | **Validação de forma via JSON Schema do Fastify** | Mecanismo nativo; respeita "não instalar dep. sem justificativa" | `zod`/`@fastify/type-provider-zod` |
| 7 | **`HttpError(statusCode, message)` em vez de plugin de erros** | `@fastify/sensible` seria dep. extra para o mesmo efeito (Fastify já honra `err.statusCode`) | `@fastify/sensible` |
| 8 | **Registro de provedores (`index.js`) como "costura"** | Adicionar provedor real = pasta nova + 1 linha; services/rotas/padrão de oferta não mudam (isolamento de heterogeneidade por normalizador) | Dependência de DI/framework |
| 9 | **`SIMULATED` garantida por construção** | Classificação vem do **registro** (`isSimulated`), nunca dos dados do provedor (externo não pode atestar a própria honestidade — contexto, regra 4); barreira no normalizador rejeita `REAL` | Confiar em flag devolvida pelo provedor |
| 10 | **Provedor simulado com identidade estável + preço variável** | Sem variação de preço o histórico sempre seria `UNCHANGED`, inutilizando o desenho de tendências; variação injetada por `variationSeed` (nº de observações anteriores) mantém o provedor puro e reprodutível | Preços 100% determinísticos (determinismo só da identidade) |
| 11 | **Dados de datas: `startDate/endDate` como `Date` (`@db.Date`), oferta com `DateTime`** | Viagem usa data pura; observações de voo usam instante | Guardar datas como strings |
| 12 | **`@db.Uuid` + uuid v4 do Prisma** | UUID como PK; Postgres valida formato, service valida com regex antes de consultar | Serial/cuid |
| 13 | **Tendência calculada comparando com a observação anterior **real** (query por `observedAt <`)** | Correto mesmo com pesquisar concorrentes; em memória seria frágil | Contar linhas e comparar posições |
| 14 | **Ofertas modeladas como `FlightOffer` (vertical específica)** | Simples e escopo atual; generalizar (`Offer` polimórfica) prematuro antes de hotéis/veículos | Model genérico `Offer` + campos nulos ou JSON |

---

## 6. Problemas conhecidos

### Bugs (resolvidos, mas que revelam riscos)
1. **`prisma generate` não roda automaticamente** após novas migrations (`migrate dev` não regenerou): causou erro 500 `Cannot read properties of undefined (reading 'count')` no Dia 5, corrigido executando `npx prisma generate`. **É débito operacional ativo**: qualquer nova migration exige rodar generate manualmente. Único bug real conhecido encontrado; todos os demais fluxos testados sem falhas.

### Funcionalidades incompletas (planejadas, não implementadas)
- Nenhuma cidade de **origem** no modelo Trip (pesquisa usa origem fictícia do simulador)
- **Ofertas sem nenhuma rota dedicada de consulta ao histórico** (só via `GET /trips/:id/flights`); não há endpoint "best price por viagem"
- Sem perfis/usuários/autenticação (qualquer chamada é anônima)

### Débitos técnicos
- **Sem suíte de testes automatizados** — tudo foi verificado manualmente via PowerShell/HTTP
- **Sem `postinstall` / automação de `prisma generate`** (ver bug 1)
- Sem CI, linting, ou formatter configurados
- `variationSeed` deriva contagens do banco (histórico acumulado/oferta prévia) — funciona, mas fica sutil; documentar ou instrumentar melhor ao aproximar do monitoramento programado
- `docker-compose` sem limites de recursos nem versão de compose declarada explicitamente
- Credenciais triviais (`trippulse/trippulse`) hardcoded no compose — aceitável só em dev local

### Riscos de segurança e operacionais
- **CORS e rate limit não configurados** (API exposta em 0.0.0.0, incluindo interfaces de rede)
- Sem sanitização adicional além do JSON Schema — SQL injection mitigado pelo Prisma (consultas parametrizadas)
- Sem tratamento explícito de PII (não há PII hoje: nome de viagem e destino são informados voluntariamente pelo usuário)
- ServerError 500 expõe apenas mensagem genérica (padrão Fastify com logger ligado) — ok, mas logs contêm payloads completos
- `.env` com `DATABASE_URL` de banco local em texto plano (fora do versionamento, previsto pelo `.gitignore`)

---

## 7. Testes

### Testes implementados (automatizados)
**Nenhum.** Não existe pasta `tests/` nem dependências de teste. Toda verificação foi manual.

### Testes executados manualmente (via HTTP real contra o servidor rodando)

| Dia | Cenários verificados | Resultados |
|---|---|---|
| 1 | Servidor inicia; `GET /health` | 200 + corpo padrão ✔ |
| 2 | Migration aplicada; query `select now()` + listagem de tabelas via módulo commitado | OK ✔ |
| 3 | CRUD completo (10 fluxos): POST válido/inválido (400 schema)/datas invertidas (400 negócio); GET lista/detalhe/404/400 não-uuid; PUT; DELETE; GET pós-delete; lista final vazia | Todos ✔ (status codes exatamente como projetados) |
| 4 | Pesquisa de voos: envelope `simulated:true`, 3 ofertas, todas `SIMULATED`, determinismo entre 2 chamadas ✔, `404` para viagem inexistente | ✔ |
| 5 | 3 pesquisas seguidas: `FIRST_OBSERVATION` ×3 → `ROSE,DROPPED,ROSE` (`previous` = preços da 1ª) → `best ≤ current`; banco: 3 ofertas / 9 observações; cascade: 0/0 após DELETE da viagem | ✔ |

### Falhas observadas durante o desenvolvimento (já resolvidas)
- Dia 5: erro 500 por client desatualizado (ver bug 1) — identificado, corrigido, revalidado
- Dia 5: uma checagem defensiva redundante e logicamente errada no `flights.service.js` foi detectada **antes do commit** e removida (o normalizador já garante a classificação)
- Um servidor testado foi sempre finalizado manualmente após os testes (o "Exited with code 1" nos logs é o encerramento forçado, não um bug)

---

## 8. Próximas etapas (ordem recomendada)

| Ordem | Tarefa | Motivo / dependência |
|---|---|---|
| 1 | **Suíte de testes automatizados** (test runner nativo do Node, fazendo chamadas com `app.inject()` do Fastify — sem dependencias extras) | O sistema já acumula fluxos críticos; testes travam as garantias (`SIMULATED`, externalKey, tendências) antes de expandir |
| 2 | **Automação do `prisma generate`** (script `db:migrate` encadeado ou `postinstall`) | Elimina o único bug repetível já logado |
| 3 | **Endpoint dedicado de histórico por viagem** (ex.: `GET /trips/:id/offers/history` consolidado) | A camada de dados já existe; agrega valor para o agente de IA |
| 4 | **Análises de preço** ("melhor momento", deltas, alertas de queda) | Item 6 da visão futura do contexto; depende de 3 |
| 5 | **Monitoramento programado** (execução periódica da pesquisa por viagem — agendador simples, sem filas) | Item 7 da visão futura; depende de 3–4 |
| 6 | **Documentação de API formal (OpenAPI/Swagger)** via plugin fastify-swagger, apoiado nos schemas existentes | Vale quando a API estabilizar mais |
| 7 | **Campo de origem no modelo Trip (+ migration e input)** | Prepara pesquisa física real; tocar junto com 8 |
| 8 | **Integração com provedor real** (remover barreira `REAL` do normalizador) | Requer credenciais de provedor, budget e a camada de persistência pronta; por último por decisão de escopo |

---

## 9. Instruções para a próxima IA

### Onde continuar
Comece pelo passo 1 (suíte de testes) em uma nova sessão. **Leia antes de implementar qualquer coisa**:
1. `docs/contexto.md` (requisitos, regras da seção 6, limites do MVP)
2. `apps/api/src/app.js` → fluxo de plugins
3. `apps/api/src/modules/flights/flights.service.js` + `apps/api/src/modules/offers/offers.service.js`
4. `apps/api/src/integrations/flight-providers/index.js` + `normalize.js`
5. `prisma/schema.prisma`

### O que NÃO alterar sem necessidade
- **`docs/contexto.md`** — requirements governantes; alterações de escopo são decisão do dono
- **As credenciais/porta do banco local**: porta 5433 existe por causa do PostgreSQL nativo do Windows — 5432 está ocupado
- **A barreira anti-`REAL`** em `normalize.js` — só deve ser removida no dia da integração real, com persistência pronta e decisão explícita
- **`prisma.config.ts` e o uso do driver adapter** (`config/prisma.js`) — mudanças exigem reler `pris.ly/d/config-datasource` (Prisma 7 mudou a API)
- **O estado do projeto: JavaScript ESM puro** — não introduzir TypeScript/tsx sem decisão formal

### Decisões a preservar
- Validação de forma nas rotas (JSON Schema nativo) e regras de negócio nos services
- Nenhuma consulta ao banco dentro de arquivos de rota
- `SIMULATED` classificado no normalizador a partir do registro
- Provedor simulado permanece **puro** (persistência vive em `modules/offers`)
- Identidade de oferta por `externalKey`; tendências vindas sempre do banco
- Somente dependências com justificativa registrada (padrão atual: fastify, prisma/@prisma/client, @prisma/adapter-pg, dotenv)

### Polêmicas pendentes para decisão do dono
- Origem no modelo Trip: guardar como texto livre ou código IATA? (impacta o padrão de dados)
- Política de `variationSeed` (como documentar no monitoramento programado)
- Estratégia de testes: `node:test` + `app.inject()` (recomendado) ou HTTP de verdade (e2e)

### Comandos úteis para retomar o ambiente

```bash
npm install                 # depois de clonar
docker compose up -d        # sobe o banco (porta 5433)
cp .env.example .env        # configurar ambiente
npm run db:migrate          # aplicar migrations (e REGERAR o client se houver novo schema: npx prisma generate)
npm run dev                 # servidor com recarga
curl http://localhost:3000/health
```

> **Resumo de integridade:** 6 commits em `main`, working tree limpa, backend funcional ponta a ponta (CRUD → pesquisa simulada → snapshot persistido → histórico com tendências), banco com 2 migrations, zero testes automatizados, um débito operacional conhecido (`prisma generate` manual).
