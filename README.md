# FareHunter AI

Plataforma inteligente de monitoramento e comparação de preços de viagens.

O usuário cadastra o contexto de uma viagem e recebe atualizações periódicas sobre oportunidades de economia envolvendo passagens aéreas, hospedagens, aluguel de veículos e passeios turísticos.

## Estado atual

Projeto em construção da **fundação backend** (primeira etapa). Atualmente entrega:

- Servidor Node.js com API REST em [Fastify](https://fastify.dev/).
- Endpooint de verificação de saúde `GET /health`.
- Configuração por variáveis de ambiente.

Funcionalidades futuras (banco de dados, CRUD de viagens, coleta de ofertas, agente de IA) ainda **não** estão implementadas.

## Stack

- JavaScript com ES Modules (Node.js >= 20.6)
- Fastify
- PostgreSQL + Prisma (planejado para as próximas etapas)
- Docker para ambiente local (planejado)

## Estrutura

```text
farehunter-ai/
├── apps/
│   └── api/
│       └── src/
│           ├── config/      # Configurações (variáveis de ambiente)
│           ├── modules/     # Módulos de negócio (etapas futuras)
│           ├── integrations/# Provedores externos (etapas futuras)
│           ├── shared/      # Código compartilhado (etapas futuras)
│           ├── app.js       # Montagem da aplicação e rotas
│           └── server.js    # Inicialização do servidor
├── docs/                    # Documentação do projeto
├── .env.example             # Modelo de variáveis de ambiente
└── package.json
```

## Como executar

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Configure as variáveis de ambiente:

   ```bash
   cp .env.example .env
   ```

   Edite o `.env` se necessário (padrões: `PORT=3000`, `HOST=0.0.0.0`).

3. Inicie o servidor:

   ```bash
   npm run dev        # desenvolvimento, com recarga automática
   npm start          # execução normal
   npm run start:no-env   # executa sem carregar o .env (usa padrões)
   ```

4. Verifique a saúde da API:

   ```bash
   curl http://localhost:3000/health
   ```

   Resposta esperada:

   ```json
   { "status": "ok", "service": "farehunter-api" }
   ```
