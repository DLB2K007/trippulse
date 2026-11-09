// Testes unitários do núcleo puro do ciclo de monitoramento (Dia 11.1).
// Sem banco e sem HTTP: pesquisa e oportunidades são stubs async injectáveis.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runMonitoringCycle,
  MONITORING_ITEM_STATUS,
  MONITORING_FAILURE_STAGE,
  MONITORING_SKIP_REASON,
} from '../apps/api/src/modules/monitoring/monitoring-core.js';

const NOW = new Date('2027-05-01T12:00:00.000Z');

function makeTrip(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Viagem teste',
    destination: 'Lisboa, Portugal',
    startDate: '2027-06-10',
    endDate: '2027-06-20',
    createdAt: new Date('2027-05-01T00:00:00.000Z'),
    updatedAt: new Date('2027-05-01T00:00:00.000Z'),
    ...overrides,
  };
}

// Dependências que registram chamadas (sem mutar as entradas do ciclo).
function recordingDependencies({ searches = [], opportunities = [] } = {}) {
  const calls = { search: [], opportunities: [] };

  return {
    calls,
    search: async (tripId) => {
      calls.search.push(tripId);
      return searches.shift() ?? { offers: [] };
    },
    opportunities: async (tripId) => {
      calls.opportunities.push(tripId);
      return opportunities.shift() ?? {
        summary: { evaluatedOfferCount: 2, containsSimulatedData: true },
        opportunities: [],
      };
    },
  };
}

test('viagem que comeca HOJE e monitoravel e executada', async () => {
  const trip = makeTrip({ id: 't-hoje', startDate: '2027-05-01' });
  const deps = recordingDependencies();

  const result = await runMonitoringCycle({ trips: [trip], now: NOW, ...deps });

  assert.deepEqual(deps.calls.search, ['t-hoje']);
  assert.equal(result.okCount, 1);
  assert.equal(result.items[0].status, MONITORING_ITEM_STATUS.OK);
  assert.equal(result.monitorableCount, 1);
  assert.equal(result.skippedCount, 0);
});

test('viagem futura e executada e viagem inativa e pulada sem chamadas', async () => {
  const future = makeTrip({ id: 't-future', startDate: '2027-06-10' });
  const past = makeTrip({ id: 't-past', startDate: '2027-01-15' });
  const deps = recordingDependencies();

  const result = await runMonitoringCycle({ trips: [future, past], now: NOW, ...deps });

  assert.deepEqual(deps.calls.search, ['t-future']);
  assert.deepEqual(deps.calls.opportunities, ['t-future']);

  assert.equal(result.items[0].status, MONITORING_ITEM_STATUS.OK);
  assert.equal(result.items[1].status, MONITORING_ITEM_STATUS.SKIPPED);
  assert.equal(result.items[1].reason, MONITORING_SKIP_REASON.TRIP_NOT_ACTIVE);
  assert.match(result.items[1].detail, /partida/);
  assert.equal(result.monitorableCount, 1);
  assert.equal(result.skippedCount, 1);
});

test('nenhuma viagem monitoravel: ciclo vacuo consistente, zero chamadas', async () => {
  const past1 = makeTrip({ id: 't-a', startDate: '2026-12-31' });
  const past2 = makeTrip({ id: 't-b', startDate: '2027-04-30' });
  const deps = recordingDependencies();

  const result = await runMonitoringCycle({ trips: [past1, past2], now: NOW, ...deps });

  assert.deepEqual(deps.calls.search, []);
  assert.deepEqual(deps.calls.opportunities, []);
  assert.equal(result.tripCount, 2);
  assert.equal(result.monitorableCount, 0);
  assert.equal(result.skippedCount, 2);
  assert.equal(result.okCount, 0);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(result.items.map((item) => item.reason), [
    MONITORING_SKIP_REASON.TRIP_NOT_ACTIVE,
    MONITORING_SKIP_REASON.TRIP_NOT_ACTIVE,
  ]);
});

test('sem viagens: zeros e lista vazia', async () => {
  const deps = recordingDependencies();

  const result = await runMonitoringCycle({ trips: [], now: NOW, ...deps });

  assert.deepEqual(deps.calls.search, []);
  assert.deepEqual(result, {
    now: NOW.toISOString(),
    tripCount: 0,
    monitorableCount: 0,
    skippedCount: 0,
    okCount: 0,
    failedCount: 0,
    opportunityCount: 0,
    items: [],
  });
});

test('sucesso: conta oportunidades oferecidas pelo modulo de oportunidades', async () => {
  const trip = makeTrip({ id: 't-ok' });
  const deps = recordingDependencies({
    opportunities: [
      {
        summary: { evaluatedOfferCount: 6, containsSimulatedData: true },
        opportunities: [{ rank: 1 }, { rank: 2 }],
      },
    ],
  });

  const result = await runMonitoringCycle({ trips: [trip], now: NOW, ...deps });

  assert.equal(result.items[0].status, MONITORING_ITEM_STATUS.OK);
  assert.equal(result.items[0].opportunityCount, 2);
  assert.equal(result.items[0].evaluatedOfferCount, 6);
  assert.equal(result.items[0].containsSimulatedData, true);
  assert.equal(result.opportunityCount, 2);
});

test('falha de pesquisa isolada: item FAILED, oportunidades NAO chamada, ciclo segue', async () => {
  const boom = makeTrip({ id: 't-boom' });
  const fine = makeTrip({ id: 't-fine', startDate: '2027-06-11' });
  const deps = recordingDependencies();
  deps.search = async (tripId) => {
    deps.calls.search.push(tripId);
    if (tripId === 't-boom') {
      throw new Error('banco indisponivel');
    }
    return { offers: [] };
  };

  const result = await runMonitoringCycle({ trips: [boom, fine], now: NOW, ...deps });

  assert.deepEqual(deps.calls.opportunities, ['t-fine']);
  assert.equal(result.items[0].status, MONITORING_ITEM_STATUS.FAILED);
  assert.equal(result.items[0].stage, MONITORING_FAILURE_STAGE.SEARCH);
  assert.equal(result.items[0].error, 'banco indisponivel');
  assert.equal(result.items[0].opportunityCount, 0);
  assert.equal(result.items[1].status, MONITORING_ITEM_STATUS.OK);
  assert.equal(result.okCount, 1);
  assert.equal(result.failedCount, 1);
});

test('falha de oportunidades isolada: pesquisa CONTA (produziu observacoes), stage OPPORTUNITIES', async () => {
  const trip = makeTrip({ id: 't-opp-boom' });
  const deps = recordingDependencies();
  deps.opportunities = async () => {
    deps.calls.opportunities.push('t-opp-boom');
    throw new Error('politica violada');
  };

  const result = await runMonitoringCycle({ trips: [trip], now: NOW, ...deps });

  assert.deepEqual(deps.calls.search, ['t-opp-boom']);
  assert.equal(result.items[0].status, MONITORING_ITEM_STATUS.FAILED);
  assert.equal(result.items[0].stage, MONITORING_FAILURE_STAGE.OPPORTUNITIES);
  assert.equal(result.items[0].error, 'politica violada');
  assert.equal(result.failedCount, 1);
});

test('multiplas viagens: succeso, falha e pulo se misturam com contagens fechadas', async () => {
  const okTrip = makeTrip({ id: 't-ok', startDate: '2027-06-10' });
  const searchBoom = makeTrip({ id: 't-search', startDate: '2027-06-10' });
  const oppBoom = makeTrip({ id: 't-opp', startDate: '2027-06-10' });
  const skippedTrip = makeTrip({ id: 't-skip', startDate: '2027-01-01' });
  const malformed = 'nao-e-uma-viagem';

  const deps = recordingDependencies();
  const baseSearch = deps.search;
  deps.search = async (tripId) => {
    baseSearch(tripId);
    if (tripId === 't-search') {
      throw new Error('falha de pesquisa');
    }
    return { offers: [] };
  };
  const baseOpps = deps.opportunities;
  deps.opportunities = async (tripId) => {
    baseOpps(tripId);
    if (tripId === 't-opp') {
      throw new Error('falha de oportunidades');
    }
    return { summary: { evaluatedOfferCount: 3, containsSimulatedData: true }, opportunities: [{ rank: 1 }] };
  };

  const result = await runMonitoringCycle({
    trips: [okTrip, searchBoom, oppBoom, skippedTrip, malformed],
    now: NOW,
    ...deps,
  });

  assert.equal(result.tripCount, 5);
  assert.equal(result.monitorableCount, 3);
  assert.equal(result.skippedCount, 2);
  assert.equal(result.okCount, 1);
  assert.equal(result.failedCount, 2);
  assert.equal(result.okCount + result.failedCount, result.monitorableCount);
  assert.equal(result.monitorableCount + result.skippedCount, result.tripCount);
  assert.deepStrictEqual(
    result.items.map((item) => item.status),
    ['OK', 'FAILED', 'FAILED', 'SKIPPED', 'SKIPPED']
  );
  assert.equal(result.items[1].stage, MONITORING_FAILURE_STAGE.SEARCH);
  assert.equal(result.items[2].stage, MONITORING_FAILURE_STAGE.OPPORTUNITIES);
  assert.equal(result.items[3].reason, MONITORING_SKIP_REASON.TRIP_NOT_ACTIVE);
  assert.equal(result.items[4].reason, MONITORING_SKIP_REASON.MALFORMED_TRIP);
  assert.equal(result.opportunityCount, 1);
});

test('determinismo: mesma entrada, mesmo resultado (deepStrictEqual)', async () => {
  const trips = [
    makeTrip({ id: 't-1', startDate: '2027-06-10' }),
    makeTrip({ id: 't-2', startDate: '2026-01-01' }),
  ];

  // Stub devolve SEMPRE o mesmo conteúdo (não é fila: cada rodada precisa
  // receber exatamente o mesmo valor para o resultado comparar deepStrictEqual).
  const stubResult = {
    summary: { evaluatedOfferCount: 4, containsSimulatedData: true },
    opportunities: [{ rank: 1 }],
  };

  const runOnce = () =>
    runMonitoringCycle({
      trips,
      now: NOW,
      search: async () => ({ offers: [] }),
      opportunities: async () => stubResult,
    });

  const [first, second] = await Promise.all([runOnce(), runOnce()]);

  assert.deepStrictEqual(first, second);
  assert.deepEqual(first.now, NOW.toISOString());
});

test('entradas nao sao mutadas pelo ciclo', async () => {
  const trips = [
    makeTrip({ id: 't-1', startDate: '2027-06-10' }),
    makeTrip({ id: 't-2', startDate: '2027-01-01' }),
  ];
  // Cópias frescas e idênticas (JSON serializaria Date como string).
  const pristine = [
    makeTrip({ id: 't-1', startDate: '2027-06-10' }),
    makeTrip({ id: 't-2', startDate: '2027-01-01' }),
  ];
  const deps = recordingDependencies();

  const result = await runMonitoringCycle({ trips, now: NOW, ...deps });

  assert.equal(Object.isFrozen(result.items), true);
  assert.deepEqual(trips, pristine);
  assert.equal(trips.length, 2);
});

test('dependencias invalidas falham alto: search ou opportunities nao-funcao', async () => {
  const trips = [makeTrip()];

  await assert.rejects(
    () => runMonitoringCycle({ trips, search: 'nao-e-funcao', opportunities: async () => ({}), now: NOW }),
    TypeError
  );
  await assert.rejects(
    () => runMonitoringCycle({ trips, search: async () => ({}), opportunities: 42, now: NOW }),
    TypeError
  );
  await assert.rejects(
    () => runMonitoringCycle({ trips: 'nao-e-array', search: async () => ({}), opportunities: async () => ({}), now: NOW }),
    TypeError
  );
});

test('now invalido falha alto e nenhuma dependencia e acionada', async () => {
  const deps = recordingDependencies();

  for (const now of ['agora', null, undefined, new Date('nao-e-data')]) {
    await assert.rejects(() => runMonitoringCycle({ trips: [makeTrip()], now, ...deps }), TypeError);
  }

  assert.deepEqual(deps.calls.search, []);
  assert.deepEqual(deps.calls.opportunities, []);
});
