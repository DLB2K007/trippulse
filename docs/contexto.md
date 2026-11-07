# FareHunter AI — Project Context

## 1. Visão geral

O FareHunter AI é uma plataforma inteligente de monitoramento e comparação de preços de viagens.

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
farehunter-ai/
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
  "service": "farehunter-api"
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