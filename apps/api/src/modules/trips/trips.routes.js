import * as tripsService from './trips.service.js';
import { arraySchema, noContentSchema } from '../../openapi/schemas.js';

// Validação de forma (campos obrigatórios e tipos) feita pelo próprio Fastify,
// via JSON Schema — mecanismo nativo do framework, sem dependências extras.
// POST exige origin (Dia 11.6: novos cadastros precisam de origem); PUT a
// torna opcional (ausente = manter a armazenada) para preservar viagens
// legadas sem origem, que só podem receber uma enquanto não têm ofertas.
const tripBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'destination', 'startDate', 'endDate'],
  properties: {
    name: { type: 'string', minLength: 1 },
    destination: { type: 'string', minLength: 1 },
    startDate: { type: 'string', format: 'date' },
    endDate: { type: 'string', format: 'date' },
  },
};

const createTripBodySchema = {
  ...tripBodySchema,
  required: [...tripBodySchema.required, 'origin'],
  properties: {
    ...tripBodySchema.properties,
    origin: { type: 'string', minLength: 1 },
  },
};

const updateTripBodySchema = {
  ...tripBodySchema,
  properties: {
    ...tripBodySchema.properties,
    origin: { type: 'string', minLength: 1 },
  },
};

const tripParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', description: 'UUID da viagem.' },
  },
};

export async function tripsRoutes(app) {
  app.post(
    '/',
    {
      schema: {
        tags: ['Trips'],
        operationId: 'createTrip',
        summary: 'Cadastra uma viagem',
        description:
          'Cria uma viagem com origem e destino canônicos, período e nome. O intervalo de datas é validado pelo service.',
        body: createTripBodySchema,
        response: {
          201: { $ref: 'Trip#' },
          400: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      const trip = await tripsService.createTrip(request.body);
      return reply.code(201).send(trip);
    }
  );

  app.get(
    '/',
    {
      schema: {
        tags: ['Trips'],
        operationId: 'listTrips',
        summary: 'Lista viagens',
        description: 'Lista todas as viagens cadastradas, ordenadas por data de início.',
        response: {
          200: arraySchema('Trip'),
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async () => {
      return tripsService.listTrips();
    }
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['Trips'],
        operationId: 'getTrip',
        summary: 'Busca uma viagem por UUID',
        description: 'Retorna a viagem, incluindo origem, período e timestamps de criação/atualização.',
        params: tripParamsSchema,
        response: {
          200: { $ref: 'Trip#' },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
      return tripsService.getTripById(request.params.id);
    }
  );

  app.put(
    '/:id',
    {
      schema: {
        tags: ['Trips'],
        operationId: 'updateTrip',
        summary: 'Atualiza uma viagem',
        description:
          'Atualiza nome, destino, período e, opcionalmente, origem. Após a primeira oferta, rota e período ficam imutáveis.',
        params: tripParamsSchema,
        body: updateTripBodySchema,
        response: {
          200: { $ref: 'Trip#' },
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          409: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request) => {
      return tripsService.updateTrip(request.params.id, request.body);
    }
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags: ['Trips'],
        operationId: 'deleteTrip',
        summary: 'Remove uma viagem',
        description:
          'Remove a viagem e, em cascata, suas ofertas e observações de preço.',
        params: tripParamsSchema,
        response: {
          204: noContentSchema,
          400: { $ref: 'ErrorResponse#' },
          404: { $ref: 'ErrorResponse#' },
          500: { $ref: 'ErrorResponse#' },
        },
      },
    },
    async (request, reply) => {
      await tripsService.deleteTrip(request.params.id);
      return reply.code(204).send();
    }
  );
}
