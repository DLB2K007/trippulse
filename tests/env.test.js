// Testes da configuração do agendador em env.js (Dia 11.4 — Fase A).
// Puro: nenhuma dependência, nenhuma I/O além de process.env (salvo/restaurado).

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadEnv } from '../apps/api/src/config/env.js';

// Fase B.1 (M3): PORT/HOST entram no isolamento — a suíte não pode depender
// de variáveis exportadas no shell (o `--env-file` não sobrescreve o ambiente).
const ENV_KEYS = [
  'MONITORING_SCHEDULER_ENABLED',
  'MONITORING_SCHEDULER_INTERVAL_MS',
  'SHUTDOWN_TIMEOUT_MS',
  'PORT',
  'HOST',
  'SERPAPI_ENABLED',
  'SERPAPI_API_KEY',
  'SERPAPI_MAX_OUTBOUND_EXPANSIONS',
];

// Guarda restaura o ambiente após cada bloco (nenhuma variável "vaza").
function withEnv(overrides, execute) {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) {
      if (key in overrides) {
        process.env[key] = overrides[key];
      } else {
        delete process.env[key];
      }
    }
    return execute();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function captureWarn() {
  const original = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  return { restore() { console.warn = original; return warned; } };
}

test('ENABLED estrito: apenas true/1 ativam (D4)', () => {
  for (const raw of ['true', 'TRUE', ' 1 ', '1']) {
    withEnv({ MONITORING_SCHEDULER_ENABLED: raw }, () => {
      assert.equal(loadEnv().monitoringScheduler.enabled, true, `raw='${raw}'`);
    });
  }
});

test('ENABLED estrito: todo o resto desativa, sem warn para valores explícitos', () => {
  const explicitOff = ['false', '0', 'off', 'no', ''];
  const typos = ['yes', 'ENABLED', 'sim', 'truee'];

  for (const raw of explicitOff) {
    const capture = captureWarn();
    try {
      withEnv({ MONITORING_SCHEDULER_ENABLED: raw }, () => {
        assert.equal(loadEnv().monitoringScheduler.enabled, false, `raw='${raw}'`);
      });
    } finally {
      assert.equal(capture.restore(), false, `raw='${raw}' é desligamento de propósito`);
    }
  }

  // Digitação comum: desativa E avisa — não pode virar silêncio de operação.
  for (const raw of typos) {
    const capture = captureWarn();
    try {
      withEnv({ MONITORING_SCHEDULER_ENABLED: raw }, () => {
        assert.equal(loadEnv().monitoringScheduler.enabled, false, `raw='${raw}'`);
      });
    } finally {
      assert.equal(capture.restore(), true, `raw='${raw}' deveria warn`);
    }
  }
});

test('default: scheduler OFF por padrão e intervalo 900000 ms', () => {
  withEnv({}, () => {
    assert.deepEqual(loadEnv().monitoringScheduler, { enabled: false, intervalMs: 900000 });
    assert.equal(loadEnv().shutdownTimeoutMs, 10000);
  });
});

test('SHUTDOWN_TIMEOUT_MS: default 10000, fronteiras válidas e inválidos fail-fast', () => {
  withEnv({}, () => {
    assert.equal(loadEnv().shutdownTimeoutMs, 10000);
  });

  for (const raw of ['1000', '10000', '60000']) {
    withEnv({ SHUTDOWN_TIMEOUT_MS: raw }, () => {
      assert.equal(loadEnv().shutdownTimeoutMs, Number(raw), `raw='${raw}'`);
    });
  }

  for (const raw of ['0', '999', '60001', '-1', 'abc', '10000.5', '10000abc']) {
    withEnv({ SHUTDOWN_TIMEOUT_MS: raw }, () => {
      assert.throws(() => loadEnv(), TypeError, `raw='${raw}'`);
    });
  }
});

test('intervalo válido com scheduler OFF é respeitado (informação pronta p/ Fase B)', () => {
  withEnv({ MONITORING_SCHEDULER_INTERVAL_MS: '3600000' }, () => {
    assert.deepEqual(loadEnv().monitoringScheduler, { enabled: false, intervalMs: 3600000 });
  });
});

test('intervalo inválido com scheduler OFF é ignorado → default 900000', () => {
  for (const raw of ['0', 'abc', '-1', '59999', '86400001', '  ', '60000abc', '60000.9', '60000 0']) {
    withEnv({ MONITORING_SCHEDULER_INTERVAL_MS: raw }, () => {
      assert.equal(loadEnv().monitoringScheduler.intervalMs, 900000, `raw='${raw}'`);
    });
  }
});

test('ENABLED=true sem intervalo definido → default 900000 (ausente ≠ inválido)', () => {
  withEnv({ MONITORING_SCHEDULER_ENABLED: '1' }, () => {
    assert.deepEqual(loadEnv().monitoringScheduler, { enabled: true, intervalMs: 900000 });
  });
});

test('intervalo nas fronteiras válidas com scheduler ATIVO passa (60000 e 86400000)', () => {
  withEnv({ MONITORING_SCHEDULER_ENABLED: '1', MONITORING_SCHEDULER_INTERVAL_MS: '60000' }, () => {
    assert.equal(loadEnv().monitoringScheduler.intervalMs, 60000);
  });
  withEnv({ MONITORING_SCHEDULER_ENABLED: '1', MONITORING_SCHEDULER_INTERVAL_MS: '86400000' }, () => {
    assert.equal(loadEnv().monitoringScheduler.intervalMs, 86400000);
  });
});

test('D2: intervalo inválido com scheduler ATIVO faila alto (TypeError)', () => {
  for (const raw of ['0', '-1', '59999', '86400001', 'abc', '', '60000abc', '60000.9', '60000 0']) {
    withEnv({ MONITORING_SCHEDULER_ENABLED: '1', MONITORING_SCHEDULER_INTERVAL_MS: raw }, () => {
      assert.throws(() => loadEnv(), TypeError, `raw='${raw}'`);
    });
  }
});

test('M2: representação não decimal é rejeitada mesmo sendo "parseável" (60000abc/60000.9/60000 0)', () => {
  for (const raw of ['60000abc', '60000.9', '60000 0']) {
    withEnv({ MONITORING_SCHEDULER_ENABLED: '1', MONITORING_SCHEDULER_INTERVAL_MS: raw }, () => {
      assert.throws(() => loadEnv(), TypeError, `raw='${raw}'`);
    });
  }
});

test('M3: withEnv isola PORT/HOST exportados no shell e restaura o valor externo', () => {
  const savedPort = process.env.PORT;
  const savedHost = process.env.HOST;
  process.env.PORT = '9999';
  process.env.HOST = '10.0.0.1';
  try {
    withEnv({}, () => {
      const env = loadEnv();
      assert.equal(env.port, 3000, 'PORT do shell não vaza para o teste');
      assert.equal(env.host, '0.0.0.0', 'HOST do shell não vaza para o teste');
    });

    withEnv({ PORT: '1234', HOST: '127.0.0.1' }, () => {
      const env = loadEnv();
      assert.equal(env.port, 1234);
      assert.equal(env.host, '127.0.0.1');
    });

    assert.equal(process.env.PORT, '9999', 'valor externo restaurado após o bloco');
    assert.equal(process.env.HOST, '10.0.0.1', 'valor externo restaurado após o bloco');
  } finally {
    if (savedPort === undefined) delete process.env.PORT;
    else process.env.PORT = savedPort;
    if (savedHost === undefined) delete process.env.HOST;
    else process.env.HOST = savedHost;
  }
});

test('sem .env: port/host mantêm os padrões históricos e scheduler permanece OFF', () => {
  withEnv({}, () => {
    const env = loadEnv();
    assert.equal(env.port, 3000);
    assert.equal(env.host, '0.0.0.0');
    assert.equal(env.monitoringScheduler.enabled, false);
  });
});

// ------------------------------------------------- SerpApi (Dia 11.8)

test('serpapi: default OFF, sem chave e 1 expansão (provedor não registrado)', () => {
  withEnv({}, () => {
    assert.deepEqual(loadEnv().serpapi, {
      enabled: false,
      apiKey: null,
      maxOutboundExpansions: 1,
    });
  });
});

test('serpapi ENABLED estrito: apenas true/1 ativam; typos avisam e desativam (D4)', () => {
  for (const raw of ['true', '1']) {
    withEnv({ SERPAPI_ENABLED: raw }, () => {
      assert.equal(loadEnv().serpapi.enabled, true, `raw='${raw}'`);
    });
  }

  for (const raw of ['false', '0', 'off', 'no', '']) {
    const capture = captureWarn();
    try {
      withEnv({ SERPAPI_ENABLED: raw }, () => {
        assert.equal(loadEnv().serpapi.enabled, false, `raw='${raw}'`);
      });
    } finally {
      assert.equal(capture.restore(), false, `raw='${raw}' é off de propósito`);
    }
  }

  for (const raw of ['yes', 'sim', 'enabled']) {
    const capture = captureWarn();
    try {
      withEnv({ SERPAPI_ENABLED: raw }, () => {
        assert.equal(loadEnv().serpapi.enabled, false, `raw='${raw}'`);
      });
    } finally {
      assert.equal(capture.restore(), true, `raw='${raw}' deveria warn`);
    }
  }
});

test('serpapi: chave é trimmada; ausente/vazia -> null com flag ligada warn', () => {
  withEnv({ SERPAPI_ENABLED: '1', SERPAPI_API_KEY: '  sk-fake-123  ' }, () => {
    assert.equal(loadEnv().serpapi.apiKey, 'sk-fake-123');
  });

  const capture = captureWarn();
  try {
    withEnv({ SERPAPI_ENABLED: '1', SERPAPI_API_KEY: '   ' }, () => {
      assert.equal(loadEnv().serpapi.apiKey, null);
    });
  } finally {
    assert.equal(capture.restore(), true, 'flag ligada sem chave deveria warn');
  }
});

test('serpapi: maxOutboundExpansions aceita 1..10 e default 1 quando ausente', () => {
  withEnv({ SERPAPI_ENABLED: '1', SERPAPI_API_KEY: 'k', SERPAPI_MAX_OUTBOUND_EXPANSIONS: '1' }, () => {
    assert.equal(loadEnv().serpapi.maxOutboundExpansions, 1);
  });
  withEnv({ SERPAPI_ENABLED: '1', SERPAPI_API_KEY: 'k', SERPAPI_MAX_OUTBOUND_EXPANSIONS: '10' }, () => {
    assert.equal(loadEnv().serpapi.maxOutboundExpansions, 10);
  });
  withEnv({ SERPAPI_ENABLED: '1', SERPAPI_API_KEY: 'k' }, () => {
    assert.equal(loadEnv().serpapi.maxOutboundExpansions, 1);
  });
});

test('serpapi D2: valor inválido de expansão com flag ATIVA faila alto (TypeError)', () => {
  for (const raw of ['0', '-1', '11', 'abc', '', '2.5', '2abc', '1 2']) {
    withEnv({ SERPAPI_ENABLED: '1', SERPAPI_API_KEY: 'k', SERPAPI_MAX_OUTBOUND_EXPANSIONS: raw }, () => {
      assert.throws(() => loadEnv(), TypeError, `raw='${raw}'`);
    });
  }
});

test('serpapi D2: valor inválido com flag DESATIVADA é ignorado (usa default)', () => {
  for (const raw of ['0', '11', 'abc']) {
    withEnv({ SERPAPI_MAX_OUTBOUND_EXPANSIONS: raw }, () => {
      assert.equal(loadEnv().serpapi.maxOutboundExpansions, 1, `raw='${raw}'`);
    });
  }
});
