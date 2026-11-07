import Fastify from 'fastify';
import { tripsRoutes } from './modules/trips/trips.routes.js';

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

  return app;
}
