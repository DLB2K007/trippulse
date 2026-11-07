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
- Cobertura atual: validação e regras do CRUD; normalização para o padrão canônico e a barreira anti-`REAL`; identidade/`externalKey` da oferta; snapshot do histórico (`FIRST_OBSERVATION` → `UNCHANGED`) e `best`; cascade de exclusão; regressão da validade das datas do provedor simulado.

## CI

`.github/workflows/ci.yml` roda em cada push para `main` e em pull requests direcionados a `main`:

1. Sobe um serviço efêmero `postgres:17-alpine` na rede do runner.
2. `npm ci` (o `postinstall` executa `prisma generate`).
3. `npx prisma migrate deploy` aplica as migrations no banco de teste.
4. `npm test` — qualquer teste falhando interrompe o workflow (❌ falha verificável no PR).

O banco de teste usa as mesmas credenciais de exemplo do desenvolvimento local (`docker-compose.yml`/`.env.example`, porta 5432 no runner) — nenhum dado real ou segredo de produção está envolvido. Falhas no job bloqueiam o merge do pull request.

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
│           │   └── offers/  # Persistência de ofertas e histórico de preços
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
