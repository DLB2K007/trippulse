// Execução MANUAL do monitoramento via HTTP — recursos em /monitoring.
// Regra zero: a rota não contém lógica; chama o service (que chama o núcleo
// puro do Dia 11.1) e o Fastify converte HttpError em resposta.
//
// Sem GET nesta etapa (Dia 11.2): não existe persistência de execuções, e
// não há histórico fictício. `GET /monitoring/runs` entra no Dia 11.3.

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
}
