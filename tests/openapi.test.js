// Contrato OpenAPI (Fase 4) — puro: não abre porta e não consulta o banco.
// Valida o documento gerado pelo próprio Fastify, a UI e o flag de ambiente.

import test from 'node:test';
import assert from 'node:assert/strict';

import { validate, compileErrors } from '@readme/openapi-parser';

import { buildApp, OPENAPI_INFO } from '../apps/api/src/app.js';
import { loadEnv } from '../apps/api/src/config/env.js';
import { validateMonitoringItems } from '../apps/api/src/modules/monitoring/monitoring.service.js';

const EXPECTED_OPERATIONS = [
  ['get', '/health', 'getHealth', 'Health'],
  ['post', '/trips', 'createTrip', 'Trips'],
  ['get', '/trips', 'listTrips', 'Trips'],
  ['get', '/trips/{id}', 'getTrip', 'Trips'],
  ['put', '/trips/{id}', 'updateTrip', 'Trips'],
  ['delete', '/trips/{id}', 'deleteTrip', 'Trips'],
  ['get', '/trips/{tripId}/flights', 'searchFlights', 'Flights'],
  ['get', '/trips/{tripId}/offers/history', 'getOfferHistory', 'Offers'],
  ['get', '/trips/{tripId}/analysis', 'getTripAnalysis', 'Analysis'],
  ['get', '/trips/{tripId}/opportunities', 'getTripOpportunities', 'Opportunities'],
  ['post', '/monitoring/runs', 'startMonitoringRun', 'Monitoring'],
  ['get', '/monitoring/runs', 'listMonitoringRuns', 'Monitoring'],
];

function collectAdditionalTrue(value, path = '#', refs = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectAdditionalTrue(item, `${path}/${index}`, refs));
    return refs;
  }
  if (value && typeof value === 'object') {
    if (value.additionalProperties === true) refs.push(path);
    for (const [key, item] of Object.entries(value)) {
      collectAdditionalTrue(item, `${path}/${key}`, refs);
    }
  }
  return refs;
}

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return refs;
  }
  if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string') refs.push(value.$ref);
    for (const item of Object.values(value)) collectRefs(item, refs);
  }
  return refs;
}

async function getDocument(app) {
  const res = await app.inject({ method: 'GET', url: '/documentation/json' });
  assert.equal(res.statusCode, 200, 'JSON da documentação deve responder 200');
  return res.json();
}

test('documento gerado é OpenAPI 3.1 válido', async () => {
  const app = buildApp({ docsEnabled: true });
  try {
    const document = await getDocument(app);

    assert.equal(document.openapi, '3.1.0');
    assert.equal(document.info.title, OPENAPI_INFO.title);
    assert.equal(document.info.version, OPENAPI_INFO.version);
    assert.deepEqual(document.servers, []);

    const result = await validate(document);
    assert.equal(result.valid, true, compileErrors(result));
  } finally {
    await app.close();
  }
});

test('documenta exatamente as 12 operações reais, com operação/tag únicas', async () => {
  const app = buildApp({ docsEnabled: true });
  try {
    const document = await getDocument(app);
    const operations = [];

    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method)) continue;
        operations.push({ method, path, operation });
      }
    }

    assert.equal(operations.length, EXPECTED_OPERATIONS.length);

    for (const [method, path, operationId, tag] of EXPECTED_OPERATIONS) {
      const found = document.paths[path]?.[method];
      assert.ok(found, `${method.toUpperCase()} ${path} ausente`);
      assert.equal(found.operationId, operationId);
      assert.deepEqual(found.tags, [tag]);
      assert.ok(found.summary?.trim(), `${operationId} sem summary`);
      assert.ok(found.description?.trim(), `${operationId} sem description`);
      assert.ok(found.responses, `${operationId} sem responses`);

      for (const [status, response] of Object.entries(found.responses)) {
        assert.notEqual(response.description, 'Default Response', `${operationId} ${status} sem descrição`);
        const content = response.content?.['application/json'];
        if (!content) continue;
        assert.ok(content.examples?.exemplo?.value, `${operationId} ${status} sem exemplo`);
      }
    }

    const ids = operations.map((entry) => entry.operation.operationId);
    assert.equal(new Set(ids).size, ids.length, 'operationId duplicado');
  } finally {
    await app.close();
  }
});

test('schemas de resposta preservam campos reais e erros reais', async () => {
  const app = buildApp({ docsEnabled: true });
  try {
    const document = await getDocument(app);
    const schemas = document.components?.schemas ?? {};

    assert.deepEqual([...schemas.Trip.required].sort(), [
      'createdAt',
      'destination',
      'endDate',
      'id',
      'name',
      'origin',
      'startDate',
      'updatedAt',
    ]);
    assert.equal(schemas.Trip.properties.origin.type.includes('null'), true);
    assert.equal(schemas.Trip.properties.createdAt.format, 'date-time');
    assert.equal(schemas.Trip.additionalProperties, false);

    assert.deepEqual(schemas.ErrorResponse.required, ['statusCode', 'error', 'message']);
    assert.ok(schemas.ErrorResponse.properties.code);
    assert.ok(schemas.ErrorResponse.properties.validation);
    assert.ok(schemas.ErrorResponse.properties.validationContext);
    assert.ok(schemas.ValidationIssue);
    assert.equal(schemas.ValidationError, undefined);
    assert.ok(schemas.MonitoringRun.properties.items);
    assert.ok(schemas.AnalysisEnvelope.properties.dataQuality);
    assert.ok(schemas.OpportunitiesEnvelope.properties.excluded);
  } finally {
    await app.close();
  }
});

test('todos os objetos de resposta são fechados; só mapas dinâmicos permitem extras', async () => {
  const app = buildApp({ docsEnabled: true });
  try {
    const document = await getDocument(app);
    const schemas = document.components?.schemas ?? {};
    const permissive = collectAdditionalTrue(document);

    assert.deepEqual(permissive, [
      '#/components/schemas/ValidationIssue/properties/params',
    ]);

    for (const [name, schema] of Object.entries(schemas)) {
      if (name === 'CurrencyFloors' || name === 'MonitoringItem') continue;
      if (schema.type === 'object') {
        assert.equal(schema.additionalProperties, false, `${name} deveria ser fechado`);
      }
    }

    assert.deepEqual(schemas.CurrencyFloors.additionalProperties, { type: 'integer' });
    assert.equal(schemas.MonitoringItem.oneOf.length, 3);
    assert.equal(schemas.MonitoringItemOk.additionalProperties, false);
    assert.equal(schemas.MonitoringItemFailed.additionalProperties, false);
    assert.equal(schemas.MonitoringItemSkipped.additionalProperties, false);
    assert.deepEqual(schemas.MonitoringItemOk.required, ['tripId', 'status']);
    assert.deepEqual(schemas.MonitoringItemFailed.properties.status.enum, ['FAILED']);
    assert.deepEqual(schemas.MonitoringItemSkipped.properties.status.enum, ['SKIPPED']);

    const insights = schemas.RelatedQuery.properties.priceInsights;
    assert.equal(insights.additionalProperties, false);
    assert.deepEqual(Object.keys(insights.properties).sort(), [
      'lowest_price',
      'price_history',
      'price_level',
      'typical_price_range',
    ]);

    const issue = schemas.ValidationIssue;
    assert.equal(issue.additionalProperties, false);
    assert.deepEqual(Object.keys(issue.properties).sort(), [
      'instancePath',
      'keyword',
      'message',
      'params',
      'schemaPath',
    ]);
    assert.deepEqual(issue.required, []);
    assert.equal(issue.properties.params.additionalProperties, true);
  } finally {
    await app.close();
  }
});

test('a fronteira de leitura aceita as três variantes e rejeita extras', () => {
  const ok = { tripId: 'trip-ok', status: 'OK' };
  const okWithCounts = {
    tripId: 'trip-ok-2',
    status: 'OK',
    opportunityCount: 2,
    evaluatedOfferCount: 6,
    containsSimulatedData: true,
  };
  const failed = {
    tripId: 'trip-failed',
    status: 'FAILED',
    stage: 'SEARCH',
    error: 'pesquisa quebrou',
    opportunityCount: 0,
    evaluatedOfferCount: 0,
    containsSimulatedData: false,
  };
  const skipped = {
    tripId: 'trip-skipped',
    status: 'SKIPPED',
    reason: 'TRIP_NOT_ACTIVE',
    detail: 'partida já passou',
    opportunityCount: 0,
    evaluatedOfferCount: 0,
    containsSimulatedData: false,
  };

  assert.deepEqual(validateMonitoringItems([ok, okWithCounts, failed, skipped]), [
    ok,
    okWithCounts,
    failed,
    skipped,
  ]);
  assert.throws(
    () => validateMonitoringItems([{ ...ok, internal: 'não pode sair' }]),
    /propriedade não prevista/
  );
  assert.throws(
    () => validateMonitoringItems([{ tripId: 't', status: 'FAILED' }]),
    /campo obrigatório ausente/
  );
  assert.throws(
    () => validateMonitoringItems([{ tripId: 't', status: 'UNKNOWN' }]),
    /status não reconhecido/
  );
});

test('erro de validação expõe ValidationIssue com os campos conhecidos', async () => {
  const app = buildApp({ docsEnabled: true });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/trips',
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.ok(Array.isArray(body.validation));
    assert.ok(body.validation.length > 0);
    for (const issue of body.validation) {
      assert.deepEqual(Object.keys(issue).sort(), [
        'instancePath',
        'keyword',
        'message',
        'params',
        'schemaPath',
      ]);
      assert.equal(typeof issue.instancePath, 'string');
      assert.equal(typeof issue.schemaPath, 'string');
      assert.equal(typeof issue.keyword, 'string');
      assert.equal(typeof issue.params, 'object');
      assert.equal(typeof issue.message, 'string');
    }
  } finally {
    await app.close();
  }
});

test('todas as referências do documento apontam para componentes existentes', async () => {
  const app = buildApp({ docsEnabled: true });
  try {
    const document = await getDocument(app);
    const refs = collectRefs(document);
    const components = document.components?.schemas ?? {};

    assert.ok(refs.length > 0);
    assert.equal(Object.keys(components).some((name) => name.startsWith('def-')), false);
    for (const ref of refs) {
      const match = /^#\/components\/schemas\/(.+)$/.exec(ref);
      assert.ok(match, `referência não suportada: ${ref}`);
      assert.ok(components[match[1]], `componente ausente: ${match[1]}`);
    }
  } finally {
    await app.close();
  }
});

test('documento não expõe segredos, hosts ou URLs de infraestrutura', async () => {
  const app = buildApp({ docsEnabled: true });
  try {
    const document = await getDocument(app);
    const serialized = JSON.stringify(document);

    assert.deepEqual(document.servers, []);
    for (const forbidden of [
      'DATABASE_URL',
      'TEST_DATABASE_URL',
      'SERPAPI_API_KEY',
      'api_key',
      'localhost',
      '127.0.0.1',
      'postgresql://',
      'https://',
      'http://',
    ]) {
      assert.equal(serialized.includes(forbidden), false, `documento contém ${forbidden}`);
    }
  } finally {
    await app.close();
  }
});

test('UI Swagger habilitada serve HTML e assets locais com CSP', async () => {
  const app = buildApp({ docsEnabled: true });
  try {
    const html = await app.inject({ method: 'GET', url: '/documentation' });
    assert.equal(html.statusCode, 200);
    assert.match(html.headers['content-type'], /text\/html/);
    assert.match(html.body, /swagger-ui/i);
    const csp = html.headers['content-security-policy'] ?? '';
    assert.match(csp, /default-src/i);
    assert.match(csp, /style-src 'self'/);
    assert.match(csp, /img-src 'self' data:/);
    assert.doesNotMatch(csp, /https:/);
    assert.doesNotMatch(csp, /validator\.swagger\.io/);

    const initializer = await app.inject({
      method: 'GET',
      url: '/documentation/static/swagger-initializer.js',
    });
    assert.equal(initializer.statusCode, 200);
    assert.match(initializer.body, /validatorUrl:\s*null/);

    const json = await app.inject({ method: 'GET', url: '/documentation/json' });
    assert.equal(json.statusCode, 200);
    assert.equal(json.json().openapi, '3.1.0');
  } finally {
    await app.close();
  }
});

test('documentação fica desabilitada por padrão e responde 404', async () => {
  const app = buildApp();
  try {
    for (const url of ['/documentation', '/documentation/json', '/documentation/static/swagger-ui.css']) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 404, `${url} deveria responder 404`);
    }
  } finally {
    await app.close();
  }
});

test('erros HTTP continuam serializando statusCode/error/message, sem campos opcionais falsos', async () => {
  const app = buildApp();
  try {
    const res = await app.inject({ method: 'GET', url: '/trips/nao-um-uuid' });
    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.statusCode, 400);
    assert.equal(body.error, 'Bad Request');
    assert.match(body.message, /UUID/);
    assert.equal('code' in body, false);
    assert.equal('validation' in body, false);
  } finally {
    await app.close();
  }
});

test('API_DOCS_ENABLED é booleano estrito, padrão false', () => {
  const saved = process.env.API_DOCS_ENABLED;
  const originalWarn = console.warn;
  try {
    console.warn = () => {};

    delete process.env.API_DOCS_ENABLED;
    assert.equal(loadEnv().apiDocs.enabled, false);

    for (const raw of ['true', 'TRUE', '1', ' 1 ']) {
      process.env.API_DOCS_ENABLED = raw;
      assert.equal(loadEnv().apiDocs.enabled, true, `raw='${raw}'`);
    }

    for (const raw of ['false', '0', 'off', 'no', '', 'sim']) {
      process.env.API_DOCS_ENABLED = raw;
      assert.equal(loadEnv().apiDocs.enabled, false, `raw='${raw}'`);
    }
  } finally {
    console.warn = originalWarn;
    if (saved === undefined) delete process.env.API_DOCS_ENABLED;
    else process.env.API_DOCS_ENABLED = saved;
  }
});
