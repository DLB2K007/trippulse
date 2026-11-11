import * as tripsService from './trips.service.js';

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
    id: { type: 'string' },
  },
};

export async function tripsRoutes(app) {
  app.post('/', { schema: { body: createTripBodySchema } }, async (request, reply) => {
    const trip = await tripsService.createTrip(request.body);
    return reply.code(201).send(trip);
  });

  app.get('/', async () => {
    return tripsService.listTrips();
  });

  app.get(
    '/:id',
    { schema: { params: tripParamsSchema } },
    async (request) => {
      return tripsService.getTripById(request.params.id);
    }
  );

  app.put(
    '/:id',
    { schema: { params: tripParamsSchema, body: updateTripBodySchema } },
    async (request) => {
      return tripsService.updateTrip(request.params.id, request.body);
    }
  );

  app.delete(
    '/:id',
    { schema: { params: tripParamsSchema } },
    async (request, reply) => {
      await tripsService.deleteTrip(request.params.id);
      return reply.code(204).send();
    }
  );
}
