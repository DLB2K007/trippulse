# TripPulse

Plataforma inteligente de monitoramento e comparação de preços de viagens.

O usuário cadastra o contexto de uma viagem e recebe atualizações periódicas sobre oportunidades de economia envolvendo passagens aéreas, hospedagens, aluguel de veículos e passeios turísticos.

## Estado atual

Projeto em construção da **fundação backend** (primeira etapa). Atualmente entrega:

- Servidor Node.js com API REST em [Fastify](https://fastify.dev/).
- Endpoint de verificação de saúde `GET /health`.
- Configuração por variáveis de ambiente.
- Banco de dados PostgreSQL em Docker com Prisma ORM.
- CRUD completo de viagens (`/trips`) com validação e tratamento de erros.
- Pesquisa de passagens aéreas por viagem (`GET /trips/:id/flights`) com provedor **simulado**, ofertas normalizadas para o padrão interno e classificação obrigatória `SIMULATED`.
- Persistência das ofertas observadas e **histórico de preços** com comparativo (`FIRST_OBSERVATION`, `DROPPED`, `ROSE`, `UNCHANGED`) e melhor preço observado.
- **Análise de preços por viagem** (`GET /trips/:tripId/analysis`), descritiva do histórico de cada oferta: `INSUFFICIENT_DATA`, `OPPORTUNITY`, `FAIR` e `ABOVE_HISTORY`, com critérios e limitações explícitos.
- **Oportunidades de compra** (`GET /trips/:tripId/opportunities`): identificação determinística sobre a análise, com portões de elegibilidade, motivo explícito para cada exclusão, ranking separado por moeda e diferença histórica observada (não economia garantida).
- **Suíte de testes automatizados** (`npm test`, runner nativo do Node com `app.inject()`).
- **CI no GitHub Actions**: testes rodados a cada push na `main` e em pull requests, com PostgreSQL efêmero.

[![CI](https://github.com/DLB2K007/trippulse/actions/workflows/ci.yml/badge.svg)](https://github.com/DLB2K007/trippulse/actions/workflows/ci.yml)

Funcionalidades futuras (provedores reais, agente de IA, monitoramento programado) ainda **não** estão implementadas.

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
- Cobertura atual: validação e regras do CRUD; normalização para o padrão canônico e a barreira anti-`REAL`; identidade/`externalKey` da oferta; snapshot do histórico (`FIRST_OBSERVATION` → `UNCHANGED`) e `best`; cascade de exclusão; regressão da validade das datas do provedor simulado; métricas puras de preço (limiares, mediana sem o preço atual, arredondamento, limites numéricos); endpoint de análise (`404`/`400`, viagem sem ofertas, classificações, dados simulados, repetibilidade); políticas de oportunidade (portões, motivos de exclusão, piso absoluto, recência, ranking por moeda, determinismo) e seu endpoint.

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
│           │   └── opportunities/ # Política determinística de oportunidades
│           ├── integrations/# Provedores externos
│           │   └── flight-providers/  # registro + provedor simulado + normalização
│           ├── shared/      # Código compartilhado
│           ├── app.js       # Montagem da aplicação e rotas
│           └── server.js    # Inicialização do servidor
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

   Edite o `.env` se necessário (padrões: `PORT=3000`, `HOST=0.0.0.0`, `DATABASE_URL` apontando para `localhost:5433`).

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

### Corpo de viagens (`POST` / `PUT`)

```json
{
  "name": "Viagem Lisboa",
  "destination": "Lisboa, Portugal",
  "startDate": "2027-03-10",
  "endDate": "2027-03-20"
}
```

Erros retornados (`400`, `404`) seguem o formato padrão do Fastify, com `statusCode`, `error` e `message`. Em `POST`/`PUT` os campos mostrados são obrigatórios e `startDate` deve ser anterior ou igual a `endDate`; a forma do corpo é validada pelo JSON Schema do Fastify e as regras de negócio pelo service.

Exemplos:

```bash
# cadastrar
curl -X POST http://localhost:3000/trips -H "Content-Type: application/json" \
  -d '{"name":"Viagem Lisboa","destination":"Lisboa, Portugal","startDate":"2027-03-10","endDate":"2027-03-20"}'

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

Pesquisa ofertas de passagens para a viagem informada. **Todas as ofertas são simuladas** — a resposta traz `simulated: true` no envelope e `dataClassification: "SIMULATED"` em cada oferta, em conformidade com a regra de não apresentar dados fictícios como reais.

```bash
curl http://localhost:3000/trips/<tripId>/flights
```

Resposta (resumida):

```json
{
  "simulated": true,
  "persisted": true,
  "providerCount": 1,
  "query": { "destination": "Lisboa, Portugal", "departureDate": "2027-03-10", "returnDate": "2027-03-20" },
  "offers": [
    {
      "provider": "simulated-airways",
      "isSimulated": true,
      "dataClassification": "SIMULATED",
      "type": "flight",
      "route": { "origin": "GRU", "destination": "LIS" },
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

- A pesquisa é **simulada e determinística na identidade**: a mesma viagem referencia sempre os mesmos voos (companhias, números, rota). Os **preços variam a cada pesquisa** (semente por observação), simulando a oscilação do mercado e exercitando o histórico.
- Cada pesquisa **persiste um snapshot**: ofertas novas (por identidade de provedor/rota/voo/partida) criam registros em `flight_offers`; toda observação cria uma linha em `price_history`.
- Cada oferta devolvida inclui `history` com `current`, `previous`, `best` (menor preço observado) e `trend` (`FIRST_OBSERVATION`, `DROPPED`, `ROSE` ou `UNCHANGED`).
- A origem é fictícia, pois o modelo de viagem ainda não possui cidade de origem.
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
      "route": { "origin": "GRU", "destination": "LIS" },
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
      "route": { "origin": "GRU", "destination": "LIS" },
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
      "route": { "origin": "GRU", "destination": "LIS" },
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
