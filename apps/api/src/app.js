import Fastify from 'fastify';
import { tripsRoutes } from './modules/trips/trips.routes.js';
import { flightRoutes } from './modules/flights/flights.routes.js';
import { offerRoutes } from './modules/offers/offers.routes.js';

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'trippulse-api',
    };
  });

  app.register(tripsRoutes, { prefix: '/trips' });
  app.register(flightRoutes, { prefix: '/trips' });
  app.register(offerRoutes, { prefix: '/trips' });

  return app;
}
