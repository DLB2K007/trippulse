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

Funcionalidades futuras (histórico de preços, provedores reais, agente de IA) ainda **não** estão implementadas.

## Stack

- JavaScript com ES Modules (Node.js >= 20.6)
- Fastify
- PostgreSQL (Docker) + Prisma ORM 7
- Git e GitHub

## Estrutura

```text
trippulse/
├── apps/
│   └── api/
│       └── src/
│           ├── config/      # Configurações (ambiente, acesso ao banco)
│           ├── modules/     # Módulos de negócio
│           │   ├── trips/   # CRUD de viagens
│           │   └── flights/ # Pesquisa de passagens de uma viagem
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

### Passagens de uma viagem — simulado (`GET /trips/:tripId/flights`)

Pesquisa ofertas de passagens para a viagem informada. **Todas as ofertas são simuladas** — a resposta traz `simulated: true` no envelope e `dataClassification: "SIMULATED"` em cada oferta, em conformidade com a regra de não apresentar dados fictícios como reais.

Resposta (resumida):

```json
{
  "simulated": true,
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
      "price": { "currency": "BRL", "total": 0, "base": 0, "taxes": 0 }
    }
  ]
}
```

Notas técnicas:

- A pesquisa é **determinística**: a mesma viagem retorna sempre as mesmas ofertas (semente derivada da consulta).
- A origem é fictícia, pois o modelo de viagem ainda não possui cidade de origem.
- Provedores reais serão adicionados na pasta `integrations/flight-providers/` mantendo o mesmo contrato — o restante do sistema não muda.

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
