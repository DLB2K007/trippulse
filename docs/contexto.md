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
| 4 | **OpenAPI 3.1 + Swagger UI** | ✅ Concluída, corrigida e publicada em `a68bf73`; CI #14 success |
| 5 | Preparação para integração real (SerpApi/Google Flights: validação, preço, custos, jurídico e segurança) | 🟡 Planejamento concluído em 16/11/2026; `REAL` continua bloqueado |
| 5.1 | Liberação do provider `REAL` (decisão explícita após todos os critérios da Fase 5) | ⛔ Bloqueada |
| 6 | Publicação da API (empacotamento, ambiente, TLS, CORS, rate limit) | ⏳ Pendente |

### Fase 4 — OpenAPI 3.1 / Swagger (implementação)

**Status:** implementada, corrigida e publicada em `a68bf73` em 16/11/2026, sem alteração de regras de negócio, schema Prisma, migrations, `normalize.js`, barreira `REAL` ou D5/D6/D7. O CI #14 concluiu com `success`.

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

O detalhamento operacional, riscos, decisões e a correção estão no **§14 de `docs/relatorio-continuidade.md`** (§14.13 implementação; §14.14 correção pós-auditoria). A implementação foi publicada em `a68bf73` e o CI #14 concluiu com `success`.
---

## 12. Fase 5 — preparação para integração real (planejamento)

**Status:** planejamento concluído em **16/11/2026**. Nenhuma chamada real à SerpApi foi feita, nenhuma credencial foi usada e a barreira `REAL` (503) permanece intacta. `REAL` continua **bloqueado**.

### 12.1 Estado de referência

- Código de referência: `main == origin/main == a68bf73eb001bc9d70484186a4b98a4a53b82334`.
- Fase 4 publicada; CI #14 (`43884861309`) concluída com `success`.
- O adaptador `serpapi` existe e é testado apenas com `fetch` injetado e fixtures **sintéticas**.
- Nenhuma oferta `REAL` é exposta ou persistida: a barreira bloqueia o registro de providers antes da chamada externa e há defesa pós-normalização e na persistência.

### 12.2 Protocolo mínimo de validação manual (D3)

**Pré-condições:** autorização escrita específica, conta de teste dedicada, limite de gasto, ambiente isolado, nenhuma credencial de produção e barreira `REAL` mantida. A validação deve chamar o adaptador diretamente (ou o endpoint público do SerpApi), nunca remover a barreira da API.

**Cenário principal:** GRU → LIS, 2027-03-10 a 2027-03-20, economia, 1 adulto, BRL, `hl=pt-BR`, `gl=br`, `SERPAPI_MAX_OUTBOUND_EXPANSIONS=1`.

| Ordem | Chamada | Requisições HTTP | Créditos potenciais | Dependência de cache | Evidência a capturar |
|---|---|---|---|---|---|
| R1 | Execução A: `type=1` inicial, com `return_date` | 1 | até 1; não presumida | primeira consulta; sem cache | parâmetros, `search_metadata.status`, moeda, `P1` da ida, presença de `departure_token` |
| R2 | Execução A: parâmetros da R1 + `type=1` + `departure_token` | 1 | até 1; não presumida | token novo; sem cache | parâmetros preservados, `P2`, itinerário de volta, presença de `booking_token` |
| R3 | Execução A: booking options com o `booking_token` do retorno escolhido | 1 | até 1; não presumida | token novo; sem cache | `booking_options`; `selected_flights`; `separate_tickets`; `together`; `departing`; `returning`; `baggage_prices`; seller e preço `B` correspondente |
| R4 | Execução B: repetir R1 com os mesmos parâmetros | 1 | 0 ou 1; **não garantido** | repetição exata de R1; pode usar cache de 1 h, mas só evita cobrança com parâmetros idênticos e cache válido | determinismo do mercado e eventuais divergências |
| R5 | Execução B: repetir R2 com o token da R4 | 1 | 0 ou 1; **não garantido** | se o token da R4 for idêntico ao da R1, repete R2 e pode usar cache; caso contrário, consulta nova | contrato preservado e novo `P2` |
| R6 | Execução B: repetir R3 com o token da R5 | 1 | 0 ou 1; **não garantido** | se o token da R5 for idêntico ao da R2, repete R3 e pode usar cache; caso contrário, consulta nova | mesmos campos de R3 e novo `B` |
| R7-C | Repetir booking options de R3 com cache padrão | 1 | 0 ou 1; **não garantido** | mesma consulta de R3; depende de parâmetros idênticos e cache válido | cache hit/miss, `B`, campos de R3 e delta do contador |
| R7-N | Repetir booking options de R3 com `no_cache=true` | 1 | até 1; não presumida | `no_cache=true` força consulta nova; sem cache | `B`, campos de R3 e delta do contador |

**Quantidade e custo:** duas execuções positivas completas = **6 requisições HTTP** (R1–R3 e R4–R6). O R7 é adicional e deve ser executado como **duas requisições separadas** (R7-C e R7-N), totalizando **8 requisições positivas** se ambas forem feitas; se o orçamento permitir apenas uma, priorizar R7-N e registrar que o cache não foi testado. **Requisições não equivalem a créditos:** cada requisição pode consumir até 1 crédito, mas R4, R5, R6 e R7-C podem ser atendidas pelo cache padrão. Isso só evita cobrança quando os parâmetros são exatamente os mesmos e o cache está válido; **não presumir gratuidade** por repetição. Sem consultar o contador da conta, não há custo exato: registrar o valor antes/depois e, se o contador não estiver disponível, declarar a limitação em vez de apresentar estimativa como cobrança confirmada. O teste negativo com token inválido/expirado é opcional e fica **fora** das 8 requisições positivas: **não presumir que seja gratuito**; medir o contador antes/depois.

**Contador de créditos:** registrar o valor do painel/consumo antes de R1 e depois de **cada** chamada, sem capturar credenciais, IDs de conta ou dados pessoais. Registrar o delta mesmo quando a chamada falhar; a cobrança de falhas e de tokens inválidos não é presumida. Se o contador não estiver disponível, declarar a limitação e **não afirmar custo exato**.

**Cache:** as chamadas positivas que podem depender de cache são **R4** (repetição exata de R1), **R5/R6** (somente se o token retornado for idêntico ao da execução A) e **R7-C** (mesma consulta de R3 com cache padrão). A eventual gratuidade exige correspondência exata dos parâmetros e cache válido; se qualquer parâmetro mudar, o token expirar ou o cache estiver vencido, a consulta **deixa de ter expectativa de cache hit** e **pode consumir crédito** caso resulte em busca bem-sucedida — conferindo o contador da conta antes/depois de cada chamada. **R7-N** usa `no_cache=true` e força consulta nova — não depende de cache. Comparar `B`, seller e contador entre R3, R7-C e R7-N. Executar R7 imediatamente após R3 para reduzir o risco de expiração do token; se ele expirar, repetir R1–R3 e registrar o desvio. Se o endpoint de booking options não aceitar `no_cache`, registrar como “não testável” e não inferir cache hit. O cache de 1 h é por consulta exata e não garante frescor.

**Resultado esperado:** R1/R2 e R4/R5 com HTTP 200, `search_metadata.status = Success`, moeda BRL e itinerários válidos; R2/R5 preservando exatamente os parâmetros; R3/R6 devolvendo `booking_options`; R7-C/R7-N comparáveis; mercado vazio retornando `[]` sem erro. A semântica do preço só é decidida após comparar `B` com `P1`/`P2`.

**Evidências obrigatórias:** data/hora UTC, SHA do código, parâmetros sanitizados, status HTTP, `search_metadata.status`, `search_parameters.currency`, contagens de ida/volta, `P1`, `P2`, `B`, presença booleana de tokens, `price_insights.lowest_price`, todos os campos de R3, o contador antes/depois e a comparação manual com a mesma consulta na UI do Google Flights. Não armazenar resposta bruta, `api_key`, `departure_token`, `booking_token` ou URLs completas.

**Fixtures reais sem credenciais:** usar uma execução única com `SERPAPI_API_KEY` somente em variável de ambiente; capturar a resposta em memória e gravar, no máximo, um JSON sanitizado por allowlist em `tests/fixtures/real/serpapi/` (futuro), com tokens substituídos por placeholders determinísticos e metadados de proveniência (rota, datas, moeda, data da captura, SHA do código, checksum). O arquivo bruto e o `.env` nunca são versionados.

### 12.3 Semântica do preço round-trip

**Decisão:** não assumir que `price` da 2ª resposta é o total combinado. O código atual usa `chosenReturn.price` como total, mas a documentação oficial consultada não define essa semântica de forma inequívoca.

Hipóteses a testar com R1–R3 (execução A) e R4–R6 (execução B); R7 compara cache:

- `B ≈ P2` → `P2` é o total do itinerário selecionado (ida + volta); a implementação atual estaria alinhada.
- `B ≈ P1 + P2` → `P1` é a ida e `P2` é a volta; o total exigiria soma.
- `B ≈ P1` e `P2` for o retorno → `P1` já seria o total; `P2` não poderia ser usado como total.

**Decisão provisória:** manter `REAL` bloqueado até a comparação com `B`. Se confirmado que `P2` é total, usar `P2` para o itinerário selecionado; se for apenas a volta, corrigir a composição antes de qualquer liberação. Não alterar `PriceHistory` nesta fase.

**Achado adicional bloqueante:** a oferta canônica guarda apenas rota, voo e data da **ida**; o `externalKey` também ignora voo/data da volta. Retornos diferentes para a mesma ida colidem na mesma oferta histórica. Antes de `REAL`, a identidade precisa incluir a volta ou o produto precisa definir explicitamente que acompanha “a volta mais barata para esta ida” — e essa definição precisa ser estável entre ciclos.

### 12.4 Base, impostos e moeda

- `total` é o único valor monetário comprovado. O adaptador grava `base = null` e `taxes = null`.
- Não derivar impostos por subtração, proporção ou arredondamento; não converter `null` em zero.
- Se o provedor fornecer componentes explícitos, só persistir quando a semântica e a moeda forem conhecidas; `total` continua autoritativo. Divergência entre `total` e `base + taxes` deve ser registrada como qualidade de dados, sem “corrigir” o total.
- Não somar `base + taxes` ao `total`: isso seria dupla contagem.
- Uma moeda por observação; sem conversão cambial e sem misturar moedas na mesma série. O adaptador atual só aceita BRL e falha alto em divergência.
- `observedAt` é o instante local da captura, não necessariamente o instante da cotação do provedor; com cache de 1 h, o dado pode ser mais antigo que o registro.
- `Float` é dívida para dinheiro: o PostgreSQL/JS usa ponto flutuante binário. A análise converte para centavos, mas o histórico persistido continua `Float`. Antes de `REAL`, decidir entre inteiro de menor unidade monetária (com expoente da moeda) ou decimal exato; **não criar migration nesta fase**.

### 12.5 Custos e viabilidade

Fórmula do adaptador: **requisições por ciclo = 1 + N**, onde `N = SERPAPI_MAX_OUTBOUND_EXPANSIONS` (1–10). Cada requisição pode consumir 1 crédito; cache exato de 1 h pode não consumir; **não presumir** que erro, falha ou token inválido sejam gratuitos; resultado vazio, se cobrado, conta 1. O plano precisa ser **Production ou superior** para incluir o U.S. Legal Shield, premissa conservadora diante da contradição documental registrada no §12.6.

Cenários com preços oficiais de 16/11/2026 (antes de impostos; planos com Legal Shield; pior caso sem cache):

| Cenário | Viagens | Cadência | N | Requisições/mês | Plano mínimo | Custo/mês | Custo/viagem |
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

**Leituras obrigatórias:**

- O plano Production (15k) cobre apenas **2 viagens** a 15 min com N=1; a terceira já excede. Com N=10, uma única viagem a 15 min consome 31.680 créditos e não cabe no Production.
- O throughput do Production é 3.000 buscas/hora; 1.500 viagens em uma mesma hora com N=1 já ocupam o limite. O agendador atual é sequencial, mas chamadas manuais a `/flights` não têm rate limit e podem furar esse orçamento.
- A 15 min, o custo sobe uma ordem de magnitude: 50 viagens chegam a US$ 55/viagem/mês e 50 viagens com N=10 a US$ 113,50/viagem/mês. Esse é o ponto em que a API compromete a viabilidade de um produto de assinatura de baixo ticket.
- A 6 h, 500 viagens N=1 custam US$ 2,95/viagem/mês só de API; 5.000 viagens N=1 caem para US$ 1,14/viagem/mês, mas o custo absoluto é US$ 5.675/mês.
- O cache de 1 h pode reduzir o consumo, mas não é garantia de economia e compromete a promessa de monitoramento a cada 15 min. O adaptador atual **não envia `no_cache`**, portanto aceita o cache padrão.
- Viabilidade não pode ser concluída sem preço do produto: a margem exige `receita_líquida_por_viagem > custo_api + infraestrutura + suporte + taxas`. O piloto real recomendado é N=1, cadência diária ou 6 h, base pequena (50–500 viagens), nunca 15 min/N>1 por padrão.

### 12.6 Revisão jurídica e comercial

Fontes oficiais consultadas em 16/11/2026: [Google Flights API](https://serpapi.com/google-flights-api), [Booking Options](https://serpapi.com/google-flights-booking-options), [Pricing](https://serpapi.com/pricing), [Legal](https://serpapi.com/legal) (atualizado em 27/08/2026) e [U.S. Legal Shield](https://serpapi.com/us-legal-shield). Caso judicial: [Google LLC v. SerpApi LLC, No. 4:25-cv-10826-YGR (N.D. Cal.), ordem de 09/11/2026](https://storage.courtlistener.com/recap/gov.uscourts.cand.461513/gov.uscourts.cand.461513.62.0.pdf).

| Pergunta | Situação documentada | Conclusão provisória |
|---|---|---|
| Armazenar indefinidamente? | A SerpApi retém dados de busca por 31 dias; o contrato público não define prazo para cópias do cliente. | **Não autorizado expressamente**; exige confirmação escrita. |
| Exibir aos usuários finais? | Não há licença explícita de exibição; a Seção 2 restringe reproduzir, vender, revender ou explorar o Serviço sem permissão escrita. | **Não autorizado expressamente**; exige confirmação escrita e revisão jurídica. |
| Comercializar produto baseado nos dados? | Legal Shield cobre coleta/parsing, não o uso posterior; a Seção 2 restringe exploração comercial. | **Não autorizado expressamente**; não confundir com Legal Shield. |
| Alertas derivados da variação histórica? | Não há cláusula específica sobre obras derivadas ou produtos analíticos. | **Pendente**; exige confirmação escrita. |
| Atribuição? | Não foi encontrada exigência de atribuição à SerpApi nos termos públicos. Marcas do Google/companhias aéreas e regras de tarifa podem exigir. | **Pendente**; confirmar com SerpApi e advogado. |
| Responsabilidades do cliente? | Uso lícito, indenização à SerpApi, conformidade legal e exclusão de usos ilegais. | **Documentado**, mas amplo e unilateral. |
| O que o Legal Shield cobre? | Coleta/parsing lícitos de dados públicos de busca, até US$ 2 milhões; não cobre o uso posterior e exclui, entre outros, violação de copyright, DMCA e privacidade. | **Não é licença de dados**; cobertura limitada. |
| Quais planos são elegíveis? | A página de pricing **exibe “U.S. Legal Shield” nos cartões Free, Starter e Developer**, além dos planos superiores (apresentação comercial); a página específica do benefício e os Termos (Seção 13) afirmam que o benefício existe **somente no Production+** e excluem expressamente Free, Starter e Developer. | **Production+ como premissa conservadora**; a contradição entre apresentação comercial e condições específicas exige confirmação escrita. |
| Limitação territorial? | A FAQ limita a claims sob lei estadual/federal dos EUA em tribunal dos EUA; leis estrangeiras e tribunais não americanos ficam fora. O título “worldwide” refere-se a clientes, não a cobertura global. | **Cobertura apenas nos EUA**, apesar do marketing. |
| Interrupção sem aviso? | As Seções 4, 13 e 16 permitem modificar, suspender, remover ou terminar o serviço sem aviso, sem responsabilidade; há SLA de 99,95% com créditos. | **Sim, contratualmente possível**; risco operacional. |
| Autorização clara para o modelo? | Não foi encontrada autorização específica para armazenar, exibir, comercializar ou gerar alertas. | **Não**; exige aditivo/confirmação escrita e advogado. |

O caso **Google LLC v. SerpApi LLC** é sobre Google Search/SearchGuard e DMCA, **não sobre Google Flights**. Em 09/11/2026 o tribunal rejeitou a segunda versão da acusação, com autorização para emenda em 21 dias; não há sentença final. O Legal Shield exclui DMCA, portanto não deve ser apresentado como proteção para esse tipo de alegação. Isso é fator de risco, não prova de legalidade ou ilegalidade do produto.

**Decisão:** não há autorização contratual clara, na documentação pública, para o modelo comercial completo. Obter confirmação escrita da SerpApi e parecer de advogado antes de liberar `REAL`. Não apresentar o Legal Shield como licença de uso, armazenamento ou exibição.

**Contradição documental sobre o Legal Shield:** a página oficial de pricing **exibe “U.S. Legal Shield” também nos cartões Free, Starter e Developer**, além dos planos superiores. Já a página específica do benefício (“Production Plan and above”) e os Termos de Serviço (Seção 13), que excluem expressamente “the Free, Starter, and Developer plans”, afirmam que o benefício está disponível **somente no Production+**. As duas apresentações não coincidem: a página de pricing sugere disponibilidade nos planos inferiores, enquanto a condição específica do benefício e o contrato a negam. Não tratar a exibição comercial como autorização para Free/Starter/Developer. Manter **Production+** como premissa conservadora até a confirmação escrita da SerpApi sobre elegibilidade, cobertura e uso comercial.

#### 12.6.1 LGPD — análise preliminar (não é parecer jurídico)

**Fluxo e categorias de dados.** O TripPulse recebe dados da viagem (origem, destino, datas e nome da viagem), que podem ser pessoais ou vinculados a uma pessoa; hoje não há autenticação, então a titularidade ainda não está individualizada. O adaptador envia à SerpApi apenas a consulta de voo (aeroportos, datas, moeda, locale e classe), não nome, e-mail, documento ou dados de pagamento. A SerpApi pode processar IP, metadados de requisição e resultados; o TripPulse persiste ofertas, histórico de preços e itens de monitoramento. A oferta normalizada não tem campo de token e o `booking_token` não é transportado para ela pelo fluxo atual, mas a ausência no raw/persistência ainda carece de teste específico de regressão. A chave da API é segredo de serviço, não dado pessoal do usuário.

**Papéis dos agentes.** Em análise preliminar: TripPulse como controladora dos dados das viagens e do histórico; SerpApi como operadora/subprocessadora para a consulta e o parsing; Google Flights e demais fornecedores como terceiros/subprocessadores da SerpApi; provedores de hospedagem, banco e observabilidade como subprocessadores do TripPulse. Os papéis definitivos dependem do contrato, do DPA e da arquitetura de autenticação futura.

**Base legal.** Não há conclusão definitiva. Hipóteses a validar: execução de contrato ou procedimentos preliminares (art. 7º, V, LGPD) para a pesquisa solicitada; legítimo interesse (art. 7º, IX) para segurança, prevenção a fraude e melhoria do serviço; consentimento específico para marketing ou comunicações não necessárias; obrigação legal ou regulatória quando aplicável. Registrar a base escolhida no inventário de tratamentos e no aviso de privacidade.

**Transferência internacional.** A SerpApi está nos Estados Unidos e pode usar subprocessadores em outras jurisdições. A transferência precisa de hipótese legal e mecanismo do art. 33 da LGPD (decisão de adequação, cláusulas contratuais padrão, normas corporativas globais ou outra hipótese legal), com avaliação documentada. A **Resolução CD/ANPD nº 19/2024** disciplina a transferência internacional e deve ser verificada quanto a escopo, cláusulas, prazos e obrigações de transparência; a aplicabilidade concreta exige confirmação jurídica.

**DPA e subprocessadores.** Solicitar à SerpApi o DPA vigente e a lista de subprocessadores; verificar finalidade, instruções, confidencialidade, segurança, notificação de incidentes, subcontratação, auditoria, retenção/eliminação e cooperação com titulares e ANPD. A política pública lista AWS, Cloudflare, Wasabi, Airbrake, Intercom, FrontApp, ActiveCampaign, MaxMind, Stripe, Postmark, Prelude, provedores de proxy e Google, entre outros; a lista pode mudar. O TripPulse precisa de mecanismo de aviso/objeção e de inventário próprio.

**Minimização e transparência.** Não enviar à SerpApi dados que a consulta não exige; não persistir tokens, corpos brutos ou credenciais; sanitizar logs e itens de monitoramento; definir retenção e eliminação; informar no aviso de privacidade a finalidade, os destinatários, a transferência internacional e os direitos do titular. A minimização não elimina a necessidade de base legal, DPA e avaliação de transferência.

**Conclusão preliminar:** a LGPD exige análise e documentação antes de `REAL`, mas esta subseção **não conclui** que o tratamento é lícito ou ilícito. DPA, base legal, transferência internacional, retenção e transparência devem ser confirmados por advogado/DPO e pela SerpApi.

### 12.7 Segurança e preparação técnica

| Controle | Estado | Observação |
|---|---|---|
| Chave só no backend | ✅ | closure do adaptador; `SERPAPI_API_KEY` não versionada |
| Chave em logs/erros | 🟡 | erros do adaptador sanitizados; falta teste integrado de logs e redaction explícita |
| `departure_token` | ✅ | usado só na 2ª requisição; removido por cópia dos raw offers; testes cobrem `outbound`, `return` e normalizado |
| `booking_token` | 🟡 | nunca enviado pelo adaptador; **não é removido do raw `return`**; não é transportado para a oferta normalizada pelo fluxo atual; falta teste específico de regressão para ausência no raw/persistência |
| Barreira `REAL` | ✅ | pré-provider, pós-normalização e persistência |
| Timeout | 🟡 | 30 s por requisição; sem orçamento total do ciclo |
| Retry/backoff | ❌ | falha aborta a viagem; sem retry/backoff/jitter |
| Resultado parcial | ✅ | fail-closed; nenhuma oferta parcial em round-trip |
| Idempotência | ❌ | cada execução grava nova observação; retry pode duplicar histórico |
| Rate limit / orçamento | ❌ | `/flights` é aberto e sem limite de consumo |
| Autenticação/multiusuário | ❌ | Fase 6; hoje todas as viagens são globais |
| Cache | 🟡 | cache de 1 h do SerpApi é aceito por default; política não definida |
| Desativação imediata | 🟡 | flags lidas no boot; exige restart |
| Circuit breaker | ❌ | indisponibilidade externa vira erro genérico (tendência 500) |
| Observabilidade de custo | ❌ | sem contador de requisições/créditos nem alerta |
| D5/D6/D7 | ✅ | preservados; nenhuma alteração nesta fase |

**Conclusão:** a barreira e a confidencialidade básica estão boas, mas o produto ainda não está pronto para consumo pago real: faltam orçamento, idempotência, rate limit, kill switch em runtime, observabilidade e tratamento de indisponibilidade.

### 12.8 Critérios formais de liberação REAL

Todos são **bloqueantes** até resolução explícita:

- [ ] D3 validado com conta autorizada e evidências de R1–R7 registradas.
- [ ] Fixtures reais capturadas, sanitizadas e versionadas com proveniência.
- [ ] Contador de créditos verificado antes/depois de cada chamada, inclusive em falha e token inválido.
- [ ] Semântica do preço round-trip confirmada com `booking_options`/UI, incluindo seller e preço correspondente.
- [ ] Cache e `no_cache=true` testados separadamente (R7-C/R7-N).
- [ ] Identidade da oferta de round-trip inclui a volta ou semântica equivalente aprovada.
- [ ] Política de base/impostos definida, sem decomposição inventada.
- [ ] Moeda validada e política de múltiplas moedas definida.
- [ ] Dívida de `Float` resolvida ou risco formalmente aceito.
- [ ] Direitos de armazenamento, exibição, comercialização e alertas confirmados por escrito.
- [ ] Legal Shield ativo (Production+), divergência de planos esclarecida por escrito e escopo/exclusões compreendidos; parecer jurídico.
- [ ] LGPD: base legal, papéis, transferência internacional, Resolução CD/ANPD 19/2024, DPA, subprocessadores, retenção e transparência documentados; parecer jurídico/DPO.
- [ ] Viabilidade financeira demonstrada com plano, throughput e orçamento.
- [ ] Autenticação/rate limit/multiusuário ou piloto com allowlist explícita.
- [ ] Idempotência, retry/backoff, circuit breaker e limite de consumo implementados.
- [ ] Logs com redaction, auditoria de falhas e teste integrado de vazamento.
- [ ] Kill switch em runtime e plano de desativação emergencial.
- [ ] Testes de integração reais, CI e auditoria independente aprovada.

**Enquanto qualquer item acima estiver aberto, `REAL` permanece bloqueado.** Esta fase não remove a barreira 503, não habilita `SERPAPI_ENABLED`, não cria migration e não executa chamadas pagas.

### 12.9 Próximos passos (após revisão do usuário)

1. Revisar este plano e autorizar, ou não, a validação manual com orçamento máximo.
2. Executar o protocolo R1–R7 em conta de teste, com contador de créditos, sem tocar no ambiente de produção.
3. Sanitizar fixtures e decidir a semântica do preço com evidência.
4. Corrigir a identidade de round-trip e a política monetária em etapa de implementação separada.
5. Obter confirmação escrita da SerpApi e parecer jurídico.
6. Definir piloto comercial, plano, frequência, N e orçamento.
7. Auditar segurança e só então propor a liberação de `REAL`.

O detalhamento completo, as fontes e o registro da auditoria estão no **§15 de `docs/relatorio-continuidade.md`**.
