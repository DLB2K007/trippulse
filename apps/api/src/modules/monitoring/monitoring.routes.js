// Recursos de monitoramento em /monitoring (Dia 11.3).
// Regra zero: a rota não contém lógica; chama o service (que orquestra o
// núcleo puro do Dia 11.1 + persistência) e o Fastify converte HttpError.
//
//  - POST /runs: executa o ciclo e devolve o REGISTRO PERSISTIDO
//    (runId, status, contagens, itens). Contrato evoluiu no 11.3 —
//    documentado no README e nos testes (nunca quebra silenciosa).
//  - GET  /runs: histórico real de execuções persistidas (mais recentes
//    primeiro, limit 1–100, default 20). Sem dado fictício.

import * as monitoringService from './monitoring.service.js';

// Formato fechado (comportamento verificado empiricamente no Fastify 5):
//  - POST sem body chega como `null` no Fastify → aceitamos `null` (sem body);
//  - `{}` (body vazio) é aceito;
//  - qualquer propriedade no body ou querystring → 400.
// Mesma convenção dos demais endpoints de leitura do projeto.
const EMPTY_QUERYSTRING = {
  type: 'object',
  maxProperties: 0,
};

const EMPTY_BODY = {
  type: ['object', 'null'],
  maxProperties: 0,
};

const LIST_QUERYSTRING = {
  type: 'object',
  additionalProperties: false,
  maxProperties: 1,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  },
};

export async function monitoringRoutes(app) {
  app.post(
    '/runs',
    {
      schema: {
        body: EMPTY_BODY,
        querystring: EMPTY_QUERYSTRING,
      },
    },
    async () => {
      return monitoringService.startMonitoringRun();
    }
  );

  app.get(
    '/runs',
    { schema: { querystring: LIST_QUERYSTRING } },
    async (request) => {
      return monitoringService.listMonitoringRuns({ limit: request.query.limit });
    }
  );
}
