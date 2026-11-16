# TripPulse — Project Context

## 1. Visão geral

O TripPulse é uma plataforma inteligente de monitoramento e comparação de preços de viagens.

Seu objetivo é permitir que usuários cadastrem o contexto de uma viagem e recebam atualizações periódicas sobre oportunidades de economia envolvendo:

- Passagens aéreas.
- Hospedagens.
- Aluguel de veículos.
- Passeios e atividades turísticas.

O sistema deverá coletar informações de provedores externos, armazenar históricos de preços, comparar ofertas e utilizar inteligência artificial para analisar tendências e gerar recomendações.

O projeto deverá evoluir gradualmente até se tornar um agente de IA capaz de monitorar viagens de maneira automatizada.

## 2. Objetivo do MVP

A primeira versão não deverá implementar todas as funcionalidades previstas.

O objetivo inicial é construir uma fundação backend organizada, funcional e escalável.

A primeira entrega deverá permitir:

1. Inicializar um servidor Node.js.
2. Disponibilizar uma API REST.
3. Conectar ao PostgreSQL.
4. Cadastrar e consultar viagens.
5. Executar pesquisas simuladas de ofertas.
6. Persistir ofertas e históricos de preços.
7. Documentar e testar os principais fluxos.

Não implementar ainda o agente autônomo, notificações ou integração real com provedores de viagens.

## 3. Stack tecnológica

- JavaScript com ES Modules.
- Node.js.
- Fastify para construção da API.
- PostgreSQL como banco de dados.
- Prisma ORM.
- Docker para ambiente local.
- Git e GitHub para versionamento.

Utilizar versões estáveis e compatíveis das dependências.

## 4. Arquitetura

O projeto utilizará inicialmente uma arquitetura de monólito modular.

Cada funcionalidade deverá possuir responsabilidades bem definidas.

Estrutura inicial planejada:

```text
trippulse/
├── apps/
│   └── api/
│       └── src/
│           ├── config/
│           ├── modules/
│           │   ├── trips/
│           │   ├── flights/
│           │   └── offers/
│           ├── integrations/
│           ├── shared/
│           ├── app.js
│           └── server.js
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docs/
├── tests/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
└── README.md
```

A estrutura poderá evoluir conforme as necessidades reais do projeto.

Evitar criar arquivos, abstrações ou módulos vazios sem finalidade.

## 5. Primeira etapa — Fundação

### Dia 1: Preparação do ambiente

Implementar:

- Inicialização do repositório.
- Configuração do Node.js.
- Configuração de ES Modules.
- Instalação e configuração do Fastify.
- Organização inicial das pastas.
- Configuração de variáveis de ambiente.
- Arquivo `.gitignore`.
- README inicial.
- Endpoint de saúde `/health`.

### Endpoint esperado

`GET /health`

Resposta esperada:

```json
{
  "status": "ok",
  "service": "trippulse-api"
}
```

O endpoint deverá indicar que a API está funcionando.

## 6. Regras de desenvolvimento

- Priorizar código simples, legível e organizado.
- Utilizar nomes descritivos para variáveis, funções e arquivos.
- Separar responsabilidades.
- Não misturar regras de negócio com rotas HTTP.
- Não armazenar credenciais diretamente no código.
- Não utilizar dados fictícios como se fossem informações reais.
- Não implementar funcionalidades fora do escopo da etapa atual.
- Não instalar dependências sem necessidade justificada.
- Utilizar Git desde o início.
- Documentar decisões técnicas relevantes.

## 7. Diretrizes para utilização de IA

A IA deverá atuar como assistente de desenvolvimento e mentor técnico.

Antes de implementar qualquer funcionalidade:

1. Analisar a estrutura existente.
2. Entender os arquivos e configurações atuais.
3. Identificar o que já está implementado.
4. Apresentar um plano de execução.
5. Implementar somente o escopo solicitado.
6. Explicar as alterações realizadas.
7. Informar como testar o resultado.

Não reescrever arquivos ou modificar a arquitetura sem necessidade.

Não gerar o projeto inteiro de uma só vez.

O desenvolvedor deverá compreender as decisões e o funcionamento do código.

## 8. Critérios de conclusão da primeira etapa

A etapa será considerada concluída quando:

- O projeto estiver versionado no GitHub.
- O servidor Fastify iniciar corretamente.
- O endpoint `/health` responder corretamente.
- As variáveis de ambiente estiverem configuradas.
- A estrutura inicial estiver organizada.
- O README apresentar o projeto e suas instruções de execução.

## 9. Visão futura

Após a fundação, o projeto deverá evoluir para:

1. Banco de dados e modelagem de viagens.
2. CRUD de viagens.
3. Integração com provedores de passagens.
4. Normalização e comparação de ofertas.
5. Histórico de preços.
6. Agente de IA para análise.
7. Monitoramento programado.
8. Notificações por Telegram, e-mail e dashboard.
9. Expansão para hotéis, veículos e atividades.
10. Publicação e disponibilização do produto.

## 10. Instrução inicial

Comece exclusivamente pela primeira etapa: preparação do ambiente e estrutura inicial do backend.

Não implemente funcionalidades futuras.

Primeiro, analise os requisitos e apresente um plano de implementação. Depois, desenvolva cada parte de maneira incremental, explicando as decisões técnicas e fornecendo instruções para testar cada entrega.

## 11. Roadmap de evolução

| Fase | Entrega | Estado |
|---|---|---|
| 1 | Fundação: Fastify, ambiente, PostgreSQL/Prisma, `/health`, README | ✅ Concluída |
| 2 | CRUD de viagens e testes automatizados | ✅ Concluída |
| 3 | Ofertas, histórico, análise, oportunidades e monitoramento | ✅ Concluída e publicada |
| 4 | **OpenAPI 3.1 + Swagger UI** | ✅ Concluída e corrigida em 16/11/2026 (worktree; sem commit) |
| 5 | Liberação do provider `REAL` (decisão explícita, validação e requisitos comerciais/legais) | ⏳ Pendente |
| 6 | Publicação da API (empacotamento, ambiente, TLS, CORS, rate limit) | ⏳ Pendente |

### Fase 4 — OpenAPI 3.1 / Swagger (implementação)

**Status:** implementada e corrigida no working tree em 16/11/2026, sem alteração de regras de negócio, schema Prisma, migrations, `normalize.js`, barreira `REAL` ou D5/D6/D7. Nada foi staged/commitado/pushado.

**Objetivo:** formalizar o contrato HTTP realmente implementado e oferecer documentação interativa da API, sem criar uma segunda fonte de verdade.

**Escopo:**

- Documento OpenAPI **3.1.0** gerado dinamicamente a partir dos schemas e metadados das rotas Fastify.
- Cobertura dos **12 endpoints** atuais: `/health`; CRUD `/trips`; `/trips/:tripId/flights`; `/trips/:tripId/offers/history`; `/trips/:tripId/analysis`; `/trips/:tripId/opportunities`; `POST` e `GET` `/monitoring/runs`.
- Schemas compartilhados de request, response e erro; códigos HTTP e exemplos coerentes com os testes/fixtures reais.
- Swagger UI servida pelo próprio processo, com assets locais e rota `/documentation`; documento em `/documentation/json`.
- Rota controlada por `API_DOCS_ENABLED` (boolean estrito, padrão **`false`**), sem exposição pública por padrão em produção.
- Testes de validade do documento, cobertura de paths/operações e comportamento da rota habilitada/desabilitada.

**Estratégia:** `@fastify/swagger@9.9.4` + `@fastify/swagger-ui@5.2.6` (linhas compatíveis com Fastify 5; a UI 6.x ainda não está na tabela oficial para Fastify 5). Validação do documento com `@readme/openapi-parser` como dependência de desenvolvimento. Response schemas serão a fonte única do contrato e também o serializer do Fastify, portanto devem cobrir todos os campos reais; a suíte existente deve continuar verde. Não haverá autenticação simulada, migration, alteração de regra de negócio ou liberação de `REAL`.

**Critérios de conclusão:** documento 3.1 válido com os 12 endpoints; requests, responses e erros cobrindo o comportamento real; `/documentation` habilitada/desabilitada conforme ambiente; nenhum segredo ou host interno exposto; teste de contrato verde no CI; README e relatório atualizados somente após a implementação.

**Fora do escopo:** autenticação/autorização, versionamento de API, SDK/geração de clientes, CORS, rate limit, TLS, deploy, novas rotas, migrations e liberação do provider `REAL`.

**Implementação entregue:**

- Dependências `@fastify/swagger@9.9.4`, `@fastify/swagger-ui@5.2.6` e `@readme/openapi-parser@10.0.0` (dev), com versões explícitas e `package-lock.json` atualizado.
- `apps/api/src/openapi/schemas.js` com componentes compartilhados (`Trip`, `FlightSearchEnvelope`, `OfferHistoryEnvelope`, `AnalysisEnvelope`, `OpportunitiesEnvelope`, `MonitoringRun`, `ErrorResponse`, `ValidationIssue`, entre outros) usados também como serializers Fastify. Os schemas são fechados (`additionalProperties: false`), exceto os mapas dinâmicos explicitamente justificados (`CurrencyFloors` e `ValidationIssue.params`).
- `buildApp({ docsEnabled = false })`, registro condicional de Swagger/UI, 12 operações com `operationId` único, tags, summaries, descriptions, parâmetros, request/response schemas, códigos HTTP reais, descrições e exemplos.
- `API_DOCS_ENABLED` estrito em `config/env.js` (ausente/`false` = desligado; `true`/`1` = ligado; valor desconhecido desliga com `warn`), repassado por `server.js`.
- `/documentation` (HTML, assets locais e `staticCSP`) e `/documentation/json` quando habilitados; `404` quando desabilitados.
- `tests/openapi.test.js` cobre validade 3.1, 12 operações, IDs únicos, tags/summaries/descrições/exemplos, componentes/refs, erros reais, ausência de segredos/hosts, gate habilitado/desabilitado e parsing estrito da flag.

**Correção pós-auditoria independente (A1–A4):** o helper `object()` passou a gerar schemas fechados; `MonitoringItem` foi dividido nas variantes `OK`, `FAILED` e `SKIPPED`, com validação do JSONB na leitura; `RelatedQuery.priceInsights` declara apenas `lowest_price`, `price_level`, `typical_price_range` e `price_history`; `ErrorResponse.validation` usa `ValidationIssue` com os campos do Ajv; o componente duplicado `ValidationError` foi removido; a CSP foi restringida a assets locais e o validador externo desabilitado; o JSDoc de `buildApp` voltou para a função correta. A suíte completa passou **336/336** e `tests/openapi.test.js` **12/12**.

O detalhamento operacional, riscos, decisões e a correção estão no **§14 de `docs/relatorio-continuidade.md`** (§14.13 implementação; §14.14 correção pós-auditoria). A implementação está no working tree; commit/push dependem de autorização específica.