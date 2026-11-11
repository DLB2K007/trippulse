# TripPulse

Plataforma inteligente de monitoramento e comparação de preços de viagens.

O usuário cadastra o contexto de uma viagem e recebe atualizações periódicas sobre oportunidades de economia envolvendo passagens aéreas, hospedagens, aluguel de veículos e passeios turísticos.

## Estado atual

Projeto em construção da **fundação backend** (primeira etapa). Atualmente entrega:

- Servidor Node.js com API REST em [Fastify](https://fastify.dev/).
- Endpoint de verificação de saúde `GET /health`.
- Configuração por variáveis de ambiente.
- Banco de dados PostgreSQL em Docker com Prisma ORM.
- CRUD completo de viagens (`/trips`) com validação e tratamento de erros, **origem canônica** (Dia 11.6) e imutabilidade de rota/período após a primeira oferta (`409`), com pesquisas e atualizações serializadas por lock de linha no PostgreSQL.
- Pesquisa de passagens aéreas por viagem (`GET /trips/:id/flights`) com provedor **simulado**, origem e destino canônicos da viagem, ofertas normalizadas para o padrão interno e classificação obrigatória `SIMULATED`.
- Persistência das ofertas observadas e **histórico de preços** com comparativo (`FIRST_OBSERVATION`, `DROPPED`, `ROSE`, `UNCHANGED`) e melhor preço observado.
- **Análise de preços por viagem** (`GET /trips/:tripId/analysis`), descritiva do histórico de cada oferta: `INSUFFICIENT_DATA`, `OPPORTUNITY`, `FAIR` e `ABOVE_HISTORY`, com critérios e limitações explícitos.
- **Oportunidades de compra** (`GET /trips/:tripId/opportunities`): identificação determinística sobre a análise, com portões de elegibilidade, motivo explícito para cada exclusão, ranking separado por moeda e diferença histórica observada (não economia garantida).
- **Suíte de testes automatizados** (`npm test`, runner nativo do Node com `app.inject()`).
- **CI no GitHub Actions**: testes rodados a cada push na `main` e em pull requests, com PostgreSQL efêmero.
- **Agendador automático do monitoramento** (Dias 11.4–11.5): executa o ciclo com `trigger: SCHEDULED` em intervalo configurável, **desativado por padrão**, com encerramento gracioso (timeout configurável), heartbeat e recuperação automática de execuções órfãs.
- **Origem, imutabilidade de rota e serialização transacional** (Dia 11.6): viagens com origem canônica obrigatória em novos cadastros, campos de rota/período congelados após a primeira oferta e persistência de ofertas atômica (ofertas e observações commitam juntas), serializada por `SELECT ... FOR UPDATE` na linha da viagem.

[![CI](https://github.com/DLB2K007/trippulse/actions/workflows/ci.yml/badge.svg)](https://github.com/DLB2K007/trippulse/actions/workflows/ci.yml)

Funcionalidades futuras (exposição de provedores reais aos usuários, agente de IA, notificações) ainda **não** estão liberadas. O **adaptador experimental SerpApi** (Dia 11.8) existe e é testável, mas fica atrás da barreira `REAL` (503) e desligado por padrão — ver seção abaixo.

## Stack

- JavaScript com ES Modules (Node.js >= 20.6)
- Fastify
- PostgreSQL (Docker) + Prisma ORM 7
- Git e GitHub

## Testes

```bash
npm test    # requer o banco ativo (docker compose up -d)
```

- Executor: `node --test` nativo (sem dependências de teste), chamadas pela Fastify `app.inject()` — não abre porta.
- Cobertura atual: validação e regras do CRUD (**origem canônica, imutabilidade de rota/período após ofertas e serialização pesquisa × PUT com provedor estacionado — Dia 11.6**); normalização para o padrão canônico e a barreira anti-`REAL`; identidade/`externalKey` da oferta; snapshot do histórico (`FIRST_OBSERVATION` → `UNCHANGED`) e `best`, **atomicidade do snapshot**; cascade de exclusão; regressão da validade das datas do provedor simulado e **determinismo da rota (origem derivada do texto)**; métricas puras de preço (limiares, mediana sem o preço atual, arredondamento, limites numéricos); endpoint de análise (`404`/`400`, viagem sem ofertas, classificações, dados simulados, repetibilidade); políticas de oportunidade (portões, motivos de exclusão, piso absoluto, recência, ranking por moeda, determinismo) e seu endpoint; agendador (timer único, after-complete, stop/start, `idle()`, 409 como skip, falha de logger); recuperação de `RUNNING` órfão por heartbeat, proteção de posse, renovação do heartbeat em ciclo real e timeout de shutdown; bootstrap (wiring só após `listen()`, shutdown idempotente, falhas de listen × pós-listen); parsing/isolamento das variáveis de ambiente; **pós-auditoria do Dia 11.8**: parser CSV estrito com linha nos erros e linha correta do cabeçalho após linhas vazias (D2), `flight_number` obrigatório e normalizado no mapeador SerpApi (D1), bloqueio fail-closed de provider REAL **antes** da chamada externa (D6), defesa fail-closed D5 em `persistOfferSnapshot`, round-trip com `return_date`/resposta mista/dedup de tokens/aborto total na 2ª requisição (D4) e registro de provedores memoizado e hermético nos testes (D7).

## CI

`.github/workflows/ci.yml` roda em cada push para `main` e em pull requests direcionados a `main`:

1. Sobe um serviço efêmero `postgres:17-alpine` na rede do runner.
2. `npm ci` (o `postinstall` executa `prisma generate`).
3. `npm run db:deploy` (`prisma migrate deploy`) aplica as migrations no banco de teste.
4. `npm test` — qualquer teste falhando interrompe o workflow (❌ falha verificável no PR).

O banco de teste usa as mesmas credenciais de exemplo do desenvolvimento local (`docker-compose.yml`/`.env.example`, porta 5432 no runner) — nenhum dado real ou segredo de produção está envolvido.

O job aparece como check nos pull requests. Para que o merge seja **bloqueado automaticamente** quando ele falhar, o check `Testes (Node 24 + PostgreSQL 17)` precisa ser exigido em **Settings → Branches → Branch protection rules** da `main` (opção "Require status checks to pass"). Sem essa configuração, o check é executado e exibido, mas não impede o merge.

## Próximos passos para publicação

A API ainda não é publicada em nenhum ambiente. Antes disso:

1. **Empacotamento**: criar um `Dockerfile` para a API (Node 24 + `npm ci --omit=dev`), reaproveitando o `docker-compose.yml` apenas para o banco local.
2. **Configuração de produção**: `DATABASE_URL` apontando para um PostgreSQL gerenciado, `NODE_ENV=production`, `HOST`/`PORT` definidos pelo ambiente e segredos fora do repositório.
3. **Migrations no deploy**: executar `npm run db:deploy` como etapa de release (nunca `migrate dev`), com backup antes de mudanças destrutivas.
4. **Operação**: healthcheck em `/health`, logs, TLS no proxy de entrada, e CORS/rate limit — hoje ausentes (ver pendências no relatório de continuidade).
5. **Contrato público**: publicar OpenAPI/Swagger antes de expor a API a terceiros.

## Estrutura

```text
trippulse/
├── apps/
│   └── api/
│       └── src/
│           ├── config/      # Configurações (ambiente, acesso ao banco)
│           ├── modules/     # Módulos de negócio
│           │   ├── trips/   # CRUD de viagens
│           │   ├── flights/ # Pesquisa de passagens de uma viagem
│           │   ├── offers/  # Persistência de ofertas e histórico de preços
│           │   ├── analysis/ # Métricas puras + análise consolidada por viagem
│           │   ├── opportunities/ # Política determinística de oportunidades
│           │   └── monitoring/    # Núcleo puro, service/rotas e agendador (scheduler.js)
│           ├── integrations/# Provedores externos
│           │   └── flight-providers/  # registro + provedor simulado + normalização
│           ├── shared/      # Código compartilhado
│           ├── app.js       # Montagem da aplicação e rotas
│           └── server.js    # Bootstrap: listen + wiring do agendador + shutdown gracioso
├── docs/                    # Documentação do projeto
├── prisma/
│   ├── schema.prisma        # Modelagem do banco de dados
│   └── migrations/          # Migrations versionadas
├── prisma.config.ts         # Configuração do Prisma CLI (conexão)
├── docker-compose.yml       # PostgreSQL para ambiente local
├── .env.example             # Modelo de variáveis de ambiente
└── package.json
```

## Como executar

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Suba o banco de dados PostgreSQL:

   ```bash
   docker compose up -d
   ```

   O container escuta na porta **5433** do host para não conflitar com um PostgreSQL local na 5432.

3. Configure as variáveis de ambiente:

   ```bash
   cp .env.example .env
   ```

   Edite o `.env` se necessário (padrões: `PORT=3000`, `HOST=0.0.0.0`, `DATABASE_URL` apontando para `localhost:5433`). O agendador automático fica **desativado** (`MONITORING_SCHEDULER_ENABLED=false`); para ligá-lo, veja a seção do agendador.

4. Aplique as migrations do banco:

   ```bash
   npm run db:migrate
   ```

5. Inicie o servidor:

   ```bash
   npm run dev        # desenvolvimento, com recarga automática
   npm start          # execução normal
   npm run start:no-env   # executa sem carregar o .env (usa padrões)
   ```

6. Verifique a saúde da API:

   ```bash
   curl http://localhost:3000/health
   ```

   Resposta esperada:

   ```json
   { "status": "ok", "service": "trippulse-api" }
   ```

## Endpoints

### Saúde da API

- `GET /health` — verifica se a API está no ar.
  Resposta: `{ "status": "ok", "service": "trippulse-api" }`

### Viagens (`/trips`)

| Método   | Rota            | Descrição                    | Sucesso |
|----------|-----------------|------------------------------|---------|
| `POST`   | `/trips`        | Cadastra uma viagem          | `201`   |
| `GET`    | `/trips`        | Lista todas as viagens       | `200`   |
| `GET`    | `/trips/:id`    | Busca uma viagem por UUID    | `200`   |
| `PUT`    | `/trips/:id`    | Atualiza uma viagem inteira  | `200`   |
| `DELETE` | `/trips/:id`    | Remove uma viagem            | `204`   |
| `GET`    | `/trips/:tripId/flights` | Pesquisa voos (simulado) e persiste snapshot    | `200`   |
| `GET`    | `/trips/:tripId/offers/history` | Histórico consolidado das ofertas observadas | `200`   |
| `GET`    | `/trips/:tripId/analysis` | Análise de preços por viagem (somente leitura)  | `200`   |
| `GET`    | `/trips/:tripId/opportunities` | Oportunidades determinísticas de compra (somente leitura) | `200` |

### Monitoramento (`/monitoring`)

| Método | Rota | Descrição | Sucesso |
|--------|------|-----------|---------|
| `POST` | `/monitoring/runs` | Executa um ciclo de monitoramento e **persiste o registro** da execução | `200` |
| `GET`  | `/monitoring/runs` | Histórico real de execuções (mais recentes primeiro) | `200` |


### Corpo de viagens (`POST` / `PUT`)

```json
{
  "name": "Viagem Lisboa",
  "origin": "São Paulo, SP, Brasil",
  "destination": "Lisboa, Portugal",
  "startDate": "2027-03-10",
  "endDate": "2027-03-20"
}
```

Erros retornados (`400`, `404`, `409`) seguem o formato padrão do Fastify, com `statusCode`, `error` e `message`. Em `POST` os campos mostrados são obrigatórios (inclusive `origin`, texto canônico de localização no mesmo padrão do `destination`); em `PUT` o `origin` é opcional (ausente = preserva a armazenada). `startDate` deve ser anterior ou igual a `endDate`; a forma do corpo é validada pelo JSON Schema do Fastify e as regras de negócio pelo service.

**Imutabilidade de rota/período (Dia 11.6):** após a primeira oferta persistida, `origin`, `destination`, `startDate` e `endDate` ficam congelados — alterar qualquer um deles retorna `409` e o `name` continua editável. Para pesquisar outra rota ou período, crie outra viagem. Viagens criadas antes do Dia 11.6 (sem origem) podem receber uma enquanto não tiverem ofertas; uma viagem sem origem não executa novas pesquisas (`409`) e a remoção continua liberada. As atualizações e as pesquisas são serializadas por lock de linha no PostgreSQL: uma alteração durante uma pesquisa em voo faz a pesquisa abortar com `409` sem persistir nada.

Exemplos:

```bash
# cadastrar
curl -X POST http://localhost:3000/trips -H "Content-Type: application/json" \
  -d '{"name":"Viagem Lisboa","origin":"São Paulo, SP, Brasil","destination":"Lisboa, Portugal","startDate":"2027-03-10","endDate":"2027-03-20"}'

# listar
curl http://localhost:3000/trips

# detalhar
curl http://localhost:3000/trips/<id>

# atualizar
curl -X PUT http://localhost:3000/trips/<id> -H "Content-Type: application/json" \
  -d '{"name":"Viagem Lisboa","destination":"Lisboa, Portugal","startDate":"2027-03-10","endDate":"2027-03-22"}'

# remover
curl -X DELETE http://localhost:3000/trips/<id>
```

### Pesquisa de passagens — simulado (`GET /trips/:tripId/flights`)

Pesquisa ofertas de passagens para a viagem informada, usando **a origem cadastrada na viagem** (`query.origin` ecoa a origem canônica; a rota das ofertas é derivada deterministicamente do texto). **Todas as ofertas são simuladas** — a resposta traz `simulated: true` no envelope e `dataClassification: "SIMULATED"` em cada oferta, em conformidade com a regra de não apresentar dados fictícios como reais. Viagens sem origem (legadas) recebem `409` em vez de pesquisar.

```bash
curl http://localhost:3000/trips/<tripId>/flights
```

Resposta (resumida):

```json
{
  "simulated": true,
  "persisted": true,
  "providerCount": 1,
  "query": { "origin": "São Paulo, SP, Brasil", "destination": "Lisboa, Portugal", "departureDate": "2027-03-10", "returnDate": "2027-03-20" },
  "offers": [
    {
      "provider": "simulated-airways",
      "isSimulated": true,
      "dataClassification": "SIMULATED",
      "type": "flight",
      "route": { "origin": "SOP", "destination": "LIS" },
      "dates": { "departureDate": "...", "arrivalDate": "..." },
      "flight": { "airline": "...", "flightNumber": "...", "stops": 0, "cabinClass": "ECONOMY", "baggagePieces": 0, "refundable": false },
      "price": { "currency": "BRL", "total": 0, "base": 0, "taxes": 0 },
      "history": {
        "observedAt": "...",
        "current": { "total": 0, "currency": "BRL" },
        "previous": { "total": 0, "currency": "BRL", "observedAt": "..." },
        "best": { "total": 0, "currency": "BRL", "observedAt": "..." },
        "trend": "DROPPED"
      }
    }
  ]
}
```

Notas técnicas:

- A pesquisa é **simulada e determinística na identidade**: a mesma viagem referencia sempre os mesmos voos (companhias, números, rota) — **incluindo a rota**: origem e destino derivam deterministicamente do texto canônico da viagem. Os **preços variam a cada pesquisa** (semente por observação), simulando a oscilação do mercado e exercitando o histórico.
- Cada pesquisa **persiste um snapshot atomicamente**: ofertas novas (por identidade de provedor/rota/voo/partida) criam registros em `flight_offers`; toda observação cria uma linha em `price_history` — ofertas e observações commitam ou roll back juntas, e a persistência só ocorre se a configuração da viagem não mudou durante a pesquisa (`SELECT ... FOR UPDATE` na linha da viagem).
- Cada oferta devolvida inclui `history` com `current`, `previous`, `best` (menor preço observado) e `trend` (`FIRST_OBSERVATION`, `DROPPED`, `ROSE` ou `UNCHANGED`).
- A origem é texto canônico cadastrado na viagem (Dia 11.6); a resolução em aeroportos/códigos IATA reais permanece pendente para o provedor real.
- A exclusão de uma viagem apaga em cascata suas ofertas e observações de preço.
- Provedores reais serão adicionados na pasta `integrations/flight-providers/` mantendo o mesmo contrato — o restante do sistema não muda.

### Histórico consolidado (`GET /trips/:tripId/offers/history`)

Retorna, lendo **apenas do banco**, todas as ofertas já observadas para a viagem com a série completa de observações de preço:

```json
{
  "tripId": "...",
  "offerCount": 1,
  "offers": [
    {
      "id": "uuid-da-oferta",
      "provider": "simulated-airways",
      "dataClassification": "SIMULATED",
      "type": "flight",
      "route": { "origin": "SOP", "destination": "LIS" },
      "dates": { "departureDate": "...", "arrivalDate": "..." },
      "flight": { "airline": "...", "flightNumber": "...", "stops": 0, "cabinClass": "ECONOMY", "baggagePieces": 0, "refundable": false },
      "externalKey": "simulated-airways|GRU|LIS|...",
      "observations": [
        { "currency": "BRL", "total": 0, "base": 0, "taxes": 0, "observedAt": "..." }
      ],
      "current": { "currency": "BRL", "total": 0, "base": 0, "taxes": 0, "observedAt": "..." },
      "previous": null,
      "best": { "currency": "BRL", "total": 0, "base": 0, "taxes": 0, "observedAt": "..." },
      "trend": "FIRST_OBSERVATION"
    }
  ]
}
```

```bash
curl http://localhost:3000/trips/<tripId>/offers/history
```

### Análise de preços (`GET /trips/:tripId/analysis`)

Analisa, **somente lendo do banco**, a série de preços de cada oferta já observada na viagem. O endpoint não cria observações, não consulta provedores e não aceita parâmetros (`?qualquer=coisa` responde `400`). Os critérios aplicados são devolvidos em `criteria`.

```bash
curl http://localhost:3000/trips/<tripId>/analysis
```

Resposta (exemplo ilustrativo; valores de uma oferta com 4 observações):

```json
{
  "trip": { "id": "...", "name": "Viagem Lisboa", "destination": "Lisboa, Portugal", "startDate": "2027-03-10", "endDate": "2027-03-20" },
  "summary": {
    "offerCount": 1,
    "classifiedOfferCount": 1,
    "classificationCounts": { "INSUFFICIENT_DATA": 0, "OPPORTUNITY": 1, "FAIR": 0, "ABOVE_HISTORY": 0 },
    "currencies": ["BRL"],
    "mixedCurrencyOfferCount": 0
  },
  "dataQuality": {
    "observationCount": 4,
    "invalidObservationCount": 0,
    "simulatedOfferCount": 1,
    "realOfferCount": 0,
    "unclassifiedOfferCount": 0,
    "containsSimulatedData": true,
    "offersWithEnoughHistory": 1,
    "offersWithoutEnoughHistory": 0
  },
  "criteria": { "minPreviousObservations": 3, "opportunityDropPct": 10, "aboveHistoryPct": 10 },
  "offers": [
    {
      "offerId": "uuid-da-oferta",
      "provider": "simulated-airways",
      "dataClassification": "SIMULATED",
      "simulated": true,
      "type": "flight",
      "route": { "origin": "SOP", "destination": "LIS" },
      "dates": { "departureDate": "...", "arrivalDate": "..." },
      "flight": { "airline": "...", "flightNumber": "...", "stops": 0, "cabinClass": "ECONOMY", "baggagePieces": 0, "refundable": false },
      "externalKey": "simulated-airways|GRU|LIS|...",
      "analysis": {
        "observationCount": 4,
        "invalidObservationCount": 0,
        "currency": "BRL",
        "mixedCurrency": false,
        "current": { "total": 1200, "currency": "BRL", "observedAt": "..." },
        "previous": { "total": 1300, "currency": "BRL", "observedAt": "..." },
        "historicalMedian": { "total": 1400, "currency": "BRL", "sampleSize": 3 },
        "historical": { "sampleSize": 3, "mean": { "total": 1400, "currency": "BRL" } },
        "variationVsPreviousPct": -7.69,
        "variationVsMedianPct": -14.29,
        "trend": "DROPPED",
        "classification": "OPPORTUNITY",
        "classificationReason": null,
        "criteria": { "minPreviousObservations": 3, "opportunityDropPct": 10, "aboveHistoryPct": 10 }
      },
      "explanation": {
        "reason": "BELOW_MEDIAN_BY_THRESHOLD",
        "reference": { "type": "HISTORICAL_MEDIAN", "total": 1400, "currency": "BRL", "sampleSize": 3 },
        "thresholds": { "minPreviousObservations": 3, "opportunityDropPct": 10, "aboveHistoryPct": 10 }
      }
    }
  ],
  "limitations": ["...", "..."]
}
```

Leitura do resultado:

- `INSUFFICIENT_DATA` — não há preço atual, há menos de 3 observações anteriores, a série mistura moedas ou não há mediana de referência. O motivo exato vem em `classificationReason`.
- `OPPORTUNITY` — preço atual pelo menos 10% **abaixo** da mediana apenas das observações anteriores.
- `FAIR` — dentro do intervalo entre esses limiares.
- `ABOVE_HISTORY` — preço atual pelo menos 10% **acima** da mediana histórica.
- `trend` é independente da classificação: um preço pode `DROPPED` e continuar `ABOVE_HISTORY`.
- A análise é **descritiva do histórico da própria oferta**, não do mercado, e **não é recomendação de compra**.
- Ofertas `SIMULATED` trazem `simulated: true` e são contabilizadas em `dataQuality`; seus preços não representam ofertas reais. A contagem é **estrita pelo valor armazenado**: qualquer classificação que não seja `SIMULATED` nem `REAL` cai em `unclassifiedOfferCount`, nunca em `realOfferCount`.
- A resposta é repetível para o mesmo estado do banco (sem carimbo de tempo) e a ordem das ofertas é determinística.

Indicadores do envelope:

| Campo | Significado |
|---|---|
| `summary.offerCount` | Ofertas observadas na viagem. |
| `summary.classifiedOfferCount` | Ofertas que receberam `OPPORTUNITY`, `FAIR` ou `ABOVE_HISTORY`. |
| `summary.classificationCounts` | Quantas ofertas em cada rótulo (a soma é `offerCount`). |
| `summary.currencies` | Moedas das séries comparáveis. |
| `summary.mixedCurrencyOfferCount` | Séries com mais de uma moeda, que não são comparadas. |
| `dataQuality.observationCount` | Observações **válidas** somadas, incluindo a atual de cada oferta. |
| `dataQuality.invalidObservationCount` | Observações descartadas (total inválido, moeda vazia, data inválida, teto de centavos). |
| `dataQuality.simulatedOfferCount` / `realOfferCount` / `unclassifiedOfferCount` | Contagem **estrita** pela classificação armazenada (`SIMULATED` / `REAL` / outra). |
| `dataQuality.containsSimulatedData` | Existe pelo menos uma oferta `SIMULATED`. |
| `dataQuality.offersWithEnoughHistory` | Ofertas com histórico anterior suficiente para tentar classificar (`analysis.historical.sampleSize >= minPreviousObservations`). |
| `dataQuality.offersWithoutEnoughHistory` | As demais. |

**Amostra e resultado são eixos diferentes.** `offersWithEnoughHistory` mede se a oferta tinha observações anteriores suficientes para *tentar* classificar; `classifiedOfferCount` mede quantas foram classificadas de fato. Uma oferta com amostra suficiente mas moeda mista continua `INSUFFICIENT_DATA`, então `classifiedOfferCount` pode ser menor que `offersWithEnoughHistory` — isso é esperado, não inconsistência.

### Oportunidades (`GET /trips/:tripId/opportunities`)

Identifica, **somente lendo do banco**, quais ofertas são oportunidades de compra segundo uma política **fixa e determinística**. Não persiste oportunidade, não cria observação, não consulta provedor e não aceita parâmetros (`?qualquer=coisa` responde `400`). A classificação descritiva não é recalculada: vem de `analysis` e aqui passa por **portões de elegibilidade**.

```bash
curl http://localhost:3000/trips/<tripId>/opportunities
```

Resposta (exemplo ilustrativo; avaliou 2 ofertas, 1 elegível e 1 simulada):

```json
{
  "trip": { "id": "...", "name": "Viagem Lisboa", "destination": "Lisboa, Portugal", "startDate": "2027-03-10", "endDate": "2027-03-20" },
  "policy": {
    "minHistoricalSampleSize": 5,
    "minDistinctObservationDays": 2,
    "maxObservationAgeHours": 24,
    "minAbsoluteSavingCentsByCurrency": { "BRL": 10000 },
    "maxOpportunitiesPerCurrency": 10
  },
  "summary": {
    "evaluatedOfferCount": 2,
    "opportunityCount": 1,
    "excludedCount": 1,
    "excludedByReason": { "SIMULATED_DATA": 1, "NOT_BELOW_THRESHOLD": 0, "...": "as 13 chaves do vocabulário estão sempre presentes, mesmo com zero" },
    "currencies": ["BRL"],
    "containsSimulatedData": true
  },
  "opportunities": [
    {
      "rank": 1,
      "offerId": "uuid-da-oferta",
      "externalKey": "fixture-airlines|GRU|LIS|...",
      "provider": "fixture-airlines",
      "dataClassification": "REAL",
      "route": { "origin": "SOP", "destination": "LIS" },
      "dates": { "departureDate": "...", "arrivalDate": "..." },
      "flight": { "airline": "...", "flightNumber": "...", "stops": 0, "cabinClass": "ECONOMY", "baggagePieces": 0, "refundable": false },
      "current": { "total": 800, "currency": "BRL" },
      "reference": { "type": "HISTORICAL_MEDIAN", "total": 1000, "currency": "BRL", "sampleSize": 5 },
      "historicalSample": { "previousObservations": 5, "distinctObservationDays": 3 },
      "variationVsMedianPct": -20,
      "historicalDifference": { "total": 200, "currency": "BRL" },
      "observedAt": "..."
    }
  ],
  "excluded": [
    { "offerId": "...", "externalKey": "...", "reason": "SIMULATED_DATA", "detail": "Preço gerado pelo provedor simulado: não representa oferta real." }
  ],
  "limitations": ["..."]
}
```

`summary.excludedByReason` sempre traz **todas** as chaves do vocabulário, inclusive com zero.

**O que o número significa.** `historicalDifference` é a mediana das observações **anteriores** da própria oferta menos o preço atual: é **economia histórica observada**, não economia garantida, não projeção futura e **não recomendação de compra**. O sistema não conhece preço de mercado.

Política aplicada (constantes do módulo, sem configuração por HTTP):

| Portão | Critério |
|---|---|
| Viagem | `startDate` (data de calendário) ainda não passou, comparada ao **dia UTC** do relógio de referência; viagem que começa hoje é elegível; data impossível (`2027-13-45`) é tratada como viagem não ativa |
| Dado | somente `dataClassification: REAL`; `SIMULATED` e desconhecidos são sempre excluídos |
| Comparabilidade | moeda única e preço atual presente |
| Amostra | pelo menos 5 observações anteriores em 2 dias distintos |
| Recência | observação atual com no máximo 24 horas, relativa ao relógio do servidor |
| Magnitude | classificação `OPPORTUNITY` **e** diferença de pelo menos R$ 100,00 |
| Ranking | por moeda: diferença decrescente, percentual mais negativo, `externalKey`; limite de 10 por moeda |

Motivos de exclusão: `TRIP_NOT_ACTIVE`, `SIMULATED_DATA`, `UNCLASSIFIED_DATA`, `MALFORMED_OFFER`, `NO_CURRENT_PRICE`, `MIXED_CURRENCY`, `SMALL_SAMPLE`, `INVALID_OBSERVATION_TIME`, `STALE_OBSERVATION`, `NOT_BELOW_THRESHOLD`, `NO_CURRENCY_FLOOR`, `BELOW_ABSOLUTE_FLOOR`, `RANK_LIMIT_EXCEEDED`.

`RANK_LIMIT_EXCEEDED` não é reprovação por qualidade de dado: a oferta passou por todos os portões de elegibilidade, mas ficou **fora das primeiras posições do ranking da sua moeda** (limite de 10 por moeda).

**Moedas nunca se misturam:** o ranking é feito dentro de cada moeda, o limite é por moeda e não existe conversão cambial. Uma moeda sem piso absoluto declarado é excluída (`NO_CURRENCY_FLOOR`) em vez de herdar o piso de outra.

**Com os dados atuais a lista é vazia por construção**, porque o único provedor é simulado e toda oferta `SIMULATED` é excluída. Isso é comportamento esperado, não defeito: o endpoint expõe o funil de exclusões até existir provedor real.

### Monitoramento (`POST` / `GET` `/monitoring/runs`)

Executa o ciclo de monitoramento e persiste **uma linha por execução** em `monitoring_runs`. Respostas são honestas sobre dados simulados e sobre falhas individuais por viagem (estágio `SEARCH`/`OPPORTUNITIES`).

```bash
# executar ciclo (sem body/query; {} é aceito, propriedades → 400)
curl -X POST http://localhost:3000/monitoring/runs

# histórico (limit: 1–100, default 20; fora da faixa → 400)
curl http://localhost:3000/monitoring/runs?limit=10
```

Resposta do ciclo concluído (registro persistido):

```json
{
  "runId": "uuid-da-execucao",
  "status": "COMPLETED",
  "trigger": "MANUAL",
  "startedAt": "...",
  "finishedAt": "...",
  "durationMs": 57,
  "failureReason": null,
  "tripCount": 2,
  "monitorableCount": 1,
  "skippedCount": 1,
  "okCount": 1,
  "failedCount": 0,
  "opportunityCount": 0,
  "items": [
    { "tripId": "...", "status": "OK", "opportunityCount": 0, "evaluatedOfferCount": 4, "containsSimulatedData": true },
    { "tripId": "...", "status": "SKIPPED", "reason": "TRIP_NOT_ACTIVE", "detail": "..." }
  ]
}
```

Contratos e regras:

- **Status da execução:** `RUNNING` → `COMPLETED` (ciclo terminou) ou `FAILED` (ciclo **abortou** globalmente, ou a execução foi recuperada como órfã). Falha **individual** de viagem **não** torna a execução `FAILED` — é dado do relatório (`items[].status: FAILED` + `stage`), e a execução continua `COMPLETED` com `failedCount > 0`. `failureReason` explica o `FAILED` (aborto ou recuperação).
- **Contagens fechadas:** `okCount + failedCount = monitorableCount` e `monitorableCount + skippedCount = tripCount`.
- **Concorrência:** é proibida em dois níveis — lock in-process (mesmo processo) **e** índice parcial único do Postgres em `status = 'RUNNING'` (processos/workers diferentes). A segunda tentativa recebe `409` com "Já existe uma execução de monitoramento em andamento." Em falhas normais, o `finally` libera o lock. Se o processo morrer (crash/SIGKILL) ou o banco falhar na finalização, o heartbeat para de ser renovado e a execução é convertida em `FAILED` antes da próxima tentativa, em vez de bloquear o índice para sempre.
- **Heartbeat / recuperação:** cada execução renova `heartbeatAt` antes e depois de cada pesquisa e avaliação de oportunidades. Um `RUNNING` sem heartbeat por 30 min é considerado órfão e marcado `FAILED` automaticamente antes da próxima execução; uma execução com heartbeat recente **nunca** é recuperada. O `UPDATE` final só ocorre com `status = 'RUNNING'`, então um ciclo atrasado não sobrescreve a recuperação.
- **Cada ciclo real escreve no banco:** pesquisa cria/atualiza ofertas `SIMULATED` e grava observações em `price_history` — o resultado de oportunidades continua **vazio por construção** com o único provedor atual.
- `GET` não aceita filtro além de `limit` e só devolve execuções **persistidas de verdade** — sem dado fictício (`?force=1` → `400`).

### Agendador automático de monitoramento

O ciclo também pode rodar sozinho. O agendador executa `startMonitoringRun` com `trigger: SCHEDULED` e **vem desativado por padrão** — nada roda no boot nem em `buildApp()`; quem liga é `loadEnv()`.

| Variável | Default | Efeito |
|---|---|---|
| `MONITORING_SCHEDULER_ENABLED` | `false` | Só `true` ou `1` ativam; qualquer outro valor desativa (valor não reconhecido gera `warn`). |
| `MONITORING_SCHEDULER_INTERVAL_MS` | `900000` | Inteiro entre `60000` (1 min) e `86400000` (24 h). Ausente usa o default; presente e inválido com o agendador ativo falha o boot (`TypeError`). |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Inteiro entre `1000` (1 s) e `60000` (60 s); tempo máximo de espera pelo ciclo em voo no shutdown. Presente e inválido falha o boot (`TypeError`). |

Comportamento:

- **Primeiro ciclo somente após o intervalo completo** — subir ou reiniciar o processo não dispara ciclo imediato.
- **Sem sobreposição no mesmo processo**: o próximo tick só é agendado **depois** que o ciclo corrente termina (`after-complete`); o intervalo real entre ciclos é `duração + intervalo` e um ciclo lento nunca é atropelado. Entre processos, o índice parcial único de `monitoring_runs` continua sendo o árbitro (o ciclo concorrente é ignorado com `409` e log `.info`).
- **Ciclos são persistidos**: cada execução automática grava uma linha `MonitoringRun` com `trigger: SCHEDULED` e o resultado do ciclo (contagens, itens, `COMPLETED`/`FAILED`) — visível no mesmo `GET /monitoring/runs`.
- **Shutdown gracioso** (`SIGTERM`/`SIGINT`): cancela o timer pendente (nenhum ciclo novo começa), aguarda o ciclo **em voo** terminar — sem abortá-lo — e só então fecha o servidor; sinais repetidos compartilham o mesmo encerramento. A espera tem timeout configurável (`SHUTDOWN_TIMEOUT_MS`, default 10 s); se expirar, registra `warn` e prossegue com o encerramento. O ciclo não é abortado; a recuperação por heartbeat cobre a linha se o processo for encerrado.
- **Erros não derrubam o agendador**: falha de um ciclo é logada e o próximo tick é reagendado; falha de logger também não interrompe a cadeia nem gera `unhandledRejection`.

```bash
# ligar o agendador em um .env local (exemplo)
MONITORING_SCHEDULER_ENABLED=true
MONITORING_SCHEDULER_INTERVAL_MS=900000
```

### Provedor experimental SerpApi (Google Flights) — Dia 11.8

Integração **experimental e isolada** a um primeiro provedor real de voos, sem compromisso comercial nesta etapa: nenhuma chamada paga é feita pelo código (o adaptador só é validado com fixtures sintéticas em teste, via `fetch` injetado).

**Importante — barreira REAL intacta (duas camadas):** mesmo com o SerpApi registrado, **nenhuma oferta `REAL` é exposta aos usuários nem persistida no histórico de produção** nesta etapa. A pesquisa de viagens falha com `503` e o bloqueio acontece em **duas camadas** (`apps/api/src/modules/flights/flights.service.js`): (1) **antes da execução de qualquer provedor REAL** — a chamada externa nunca acontece (nem em pesquisa manual nem no ciclo do agendador), evitando créditos queimados sem resultado utilizável; (2) **após a normalização**, como defesa adicional para um provedor REAL que eventualmente chegue por caminho futuro. Nada é escrito no banco em nenhum caso. Além disso, `persistOfferSnapshot` (`apps/api/src/modules/offers/offers.service.js`) tem verificação própria: uma oferta `REAL` entregue diretamente à persistência falha com `503` antes da primeira escrita (defesa em profundidade). Liberar dados `REAL` é uma decisão explícita e futura.

| Variável | Default | Efeito |
|---|---|---|
| `SERPAPI_ENABLED` | `false` | A camada de ambiente aceita texto `true` ou `1` e normaliza para boolean; qualquer outro valor desativa (não reconhecido gera `warn`). A configuração tipada entregue a `buildFlightProviders()` só ativa com `enabled === true`. |
| `SERPAPI_API_KEY` | *(vazio)* | Chave da API, opcional e **não versionada**. Sem chave, o provedor não é registrado mesmo com a flag ativa. Existe exclusivamente no backend; nunca aparece em logs ou erros. |
| `SERPAPI_MAX_OUTBOUND_EXPANSIONS` | `1` | Inteiro entre `1` e `10`. Quantos itinerários de ida são expandidos por ciclo em round-trips (via `departure_token`). Presente e inválido com a flag ativa falha o boot (`TypeError`); com a flag desativada é ignorado. |

Como funciona:

- **Registro condicional e memoizado** (`apps/api/src/integrations/flight-providers/index.js`): o simulado é sempre o padrão; o SerpApi só entra no registro com `enabled === true` **e** chave string não vazia. A camada de ambiente converte o texto explicitamente permitido (`SERPAPI_ENABLED=true` ou `1`) em boolean; `buildFlightProviders()` não aceita `1`, `'true'` ou `'false'` injetados diretamente como equivalentes a boolean. A config é validada no boot (`startServer` → `loadEnv()`) e o registro efetivo é construído **uma única vez**, antes de abrir a porta, sem reavaliar o ambiente a cada pesquisa.
- **Resolver de aeroportos agnóstico** (`apps/api/src/integrations/airports/`): localidades canônicas da viagem (ex.: `São Paulo, São Paulo, Brasil`) são resolvidas em códigos IATA por um snapshot **local** do [OurAirports](https://ourairports.com/) (domínio público, 4.008 aeroportos com serviço comercial regular, gerado por `build-airport-snapshot.mjs`). Nenhuma requisição de rede acontece em runtime. `ident` é a chave canônica (o IATA nunca é primária); localidades ambíguas ou desconhecidas viram `UNRESOLVED` explícito — nunca o "primeiro match". Cidades multi-aeroporto e grafias divergentes (ex.: `Lisboa` → município `Lisbon` na fonte) passam por uma **tabela curada** auditável (São Paulo → GRU, CGH, VCP; Rio de Janeiro → GIG, SDU; etc.).
- **Adaptador** (`apps/api/src/integrations/flight-providers/serpapi/serpapi-flight-provider.js`): `fetch` nativo injetável, suporte a IATA e `kgmid`, erros HTTP/timeout (AbortController)/JSON inválido tratados sem expor a chave, respostas vazias válidas (`[]`), round-trip em duas requisições via `departure_token`, com `return_date` na primeira requisição `type=1`. Um itinerário de round-trip **sem** `departure_token` é tratado como anomalia (erro), não como mercado vazio. O `flight_number` da ida é **obrigatório e normalizado**: ausente, `null`, vazio, só de espaços, números não positivos ou identificadores artificiais falham alto; espaços nas extremidades são removidos para não criar identidade externa artificial.
- **Custo e cobertura**: `requisições por ciclo = 1 + tokens expandidos`. Com o default (`1`), um round-trip custa 2 requisições. **Cobertura parcial por desenho**: expandir apenas o(s) melhor(es) itinerário(s) de ida (seleção determinística por preço, duração, horário e companhia) não cobre todas as combinações ida × volta. Viagens só de ida não usam expansão.
- **Round-trip — comportamentos documentados** (Dia 11.8, pós-auditoria): (a) a primeira requisição envia `type=1`, `outbound_date` e `return_date`; one-way envia `type=2` e não envia `return_date`; (b) em uma resposta com itinerários de ida com e sem `departure_token`, os **sem-token são descartados sem registro** — uma ida mais barata sem token pode ficar fora do resultado (coerente com a cobertura parcial; a anomalia só existe quando **nenhum** itinerário tem token); (c) `departure_token` **duplicado** é dedupado de forma determinística (mantém a 1ª ocorrência na ordem de seleção); (d) **falha em qualquer 2ª requisição** (HTTP, rede, JSON ou retorno vazio) **aborta a busca inteira** — não há resultado parcial de round-trip.
- **Pendências registradas** (não assumidas): (1) a semântica exata do preço do round-trip combinado — hoje o preço do retorno da 2ª resposta é usado como preço do trip completo, a confirmar com fixtures reais; (2) base/impostos não decompostos pelo SerpApi (`null`); (3) horários dos legs são locais sem offset — as datas normalizadas usam apenas o dia; (4) `price_insights` é metadado de contexto do provedor (`relatedQuery.priceInsights`, não persistido) e **não** se mistura ao `PriceHistory` do TripPulse; (5) **D3 permanece aberta**: o conjunto mínimo de parâmetros da 2ª requisição do round-trip (a que envia `departure_token`) não pôde ser confirmado sem conta autorizada. A primeira requisição já envia `return_date`; a segunda continua com a conformidade real a validar com fixtures capturadas e proveniência quando houver ambiente adequado.

```bash
# ligar o provedor experimental em um .env local (exemplo; NÃO versionado)
SERPAPI_ENABLED=true
SERPAPI_API_KEY=sua-chave-do-serpapi
SERPAPI_MAX_OUTBOUND_EXPANSIONS=1
```

Como atualizar o snapshot de aeroportos (manutenção de dados, sem rede em runtime):

```bash
node apps/api/src/integrations/airports/build-airport-snapshot.mjs
```

O script rebaixa os CSVs do OurAirports, aplica o filtro (serviço comercial regular + IATA + tipos large/medium/small) e regenera `apps/api/src/integrations/airports/data/airports-snapshot.json` com metadados de proveniência (data, SHA-256 das fontes, contagens, licença). O parser CSV (`csv.js`) é **estrito**: aspas em posição inválida, citação nunca fechada, conteúdo após o fechamento de uma citação e registros com contagem de colunas divergente do cabeçalho **falham alto com o número da linha** — dados malformados nunca são engolidos em silêncio. Para regeneração determinística, use `AIRPORT_SNAPSHOT_GENERATED_AT='2026-11-11T03:39:54.857Z'`; se os dados gerados diferirem do snapshot atual, o script aborta e exige `--force` após revisão. O snapshot atual está no **working tree**, ainda não rastreado, e precisa entrar na futura consolidação; ele não está commitado. A comparação 1:1 com os CSVs externos relatada em etapa anterior é histórica e não é reproduzível apenas com o repositório atual, pois os CSVs originais não estão versionados.
