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
import { arraySchema } from '../../openapi/schemas.js';

// Formato fechado (comportamento verificado empiricamente no Fastify 5):
//  - POST sem body chega como `null` no Fastify → aceitamos `null` (sem body);
//  - `{}` (body vazio) é aceito;
//  - qualquer propriedade no body ou querystring → 400.
// Mesma convenção dos demais endpoints de leitura do projeto.
const EMPTY_QUERYSTRING = {
  type: 'object',
  maxProperties: 0,
  properties: {},
};

const EMPTY_BODY = {
  // `type: ['object', 'null']` funciona na validação do Fastify, mas o
  // @fastify/swagger 9 o converte em parâmetros de query inválidos no
  // documento. `anyOf` preserva a mesma validação e gera OpenAPI 3.1 válido.
  anyOf: [
    { type: 'object', maxProperties: 0 },
    { type: 'null' },
  ],
};

const LIST_QUERYSTRING = {
  type: 'object',
  additionalProperties: false,
  maxProperties: 1,
  properties: {
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
      description: 'Quantidade máxima de execuções (1–100). Default 20.',
    },
  },
};

export async function monitoringRoutes(app) {
  app.post(
    '/runs',
    {
      schema: {
        tags: ['Monitoring'],
        operationId: 'startMonitoringRun',
        summary: 'Executa um ciclo de monitoramento',
        description:
          'Executa o ciclo manualmente e persiste uma linha por execução. Não aceita body com propriedades nem querystring; ausência de body e {} são aceitos.',
        body: EMPTY_BODY,
        querystring: EMPTY_QUERYSTRING,
        response: {
          200: { $ref: 'MonitoringRun#' },
          400: { $ref: 'ErrorResponse#' },
          409: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async () => {
      return monitoringService.startMonitoringRun();
    }
  );

  app.get(
    '/runs',
    {
      schema: {
        tags: ['Monitoring'],
        operationId: 'listMonitoringRuns',
        summary: 'Lista execuções de monitoramento',
        description:
          'Retorna o histórico real de execuções persistidas, mais recentes primeiro, limitado por `limit` (1–100, default 20).',
        querystring: LIST_QUERYSTRING,
        response: {
          200: arraySchema('MonitoringRun'),
          400: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
      return monitoringService.listMonitoringRuns({ limit: request.query.limit });
    }
  );
}
