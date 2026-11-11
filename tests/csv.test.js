// Testes do parser CSV endurecido (correção da auditoria D2 — Dia 11.8).
//
// Casos derivados da auditoria independente: aspas em posição inválida,
// citação nunca fechada, colunas divergentes do cabeçalho, multilinha,
// CRLF/LF, BOM e o formato real do dump do OurAirports. O parser deve falhar
// ALTO com a linha nos erros — nunca engolir dados em silêncio.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../apps/api/src/integrations/airports/csv.js';

const TEST_NAME = 'CSV parser (D2)';

test(`${TEST_NAME}: vírgulas citadas e aspas escapadas válidas`, () => {
  const { header, rows } = parseCsv('a,b\n"x,y",2\n"aspas ""duplas""",z');
  assert.deepEqual(header, ['a', 'b']);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { a: 'x,y', b: '2' });
  assert.deepEqual(rows[1], { a: 'aspas "duplas"', b: 'z' });
});

test(`${TEST_NAME}: campo multilinha citado preserva quebras e conta linhas`, () => {
  const { rows } = parseCsv('a,b\n"linha1\nlinha2",2');
  assert.deepEqual(rows, [{ a: 'linha1\nlinha2', b: '2' }]);
});

test(`${TEST_NAME}: campo multilinha citado com CRLF`, () => {
  const { rows } = parseCsv('a,b\r\n"l1\r\nl2",2');
  assert.equal(rows[0].a, 'l1\r\nl2');
});

test(`${TEST_NAME}: CRLF e LF misturados`, () => {
  const { rows } = parseCsv('a,b\r\n1,2\n3,4\r\n5,6');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], { a: '5', b: '6' });
});

test(`${TEST_NAME}: BOM no cabeçalho é tolerado`, () => {
  const { header, rows } = parseCsv('\ufeffa,b\n1,2');
  assert.deepEqual(header, ['a', 'b']);
  assert.deepEqual(rows[0], { a: '1', b: '2' });
});

test(`${TEST_NAME}: linhas em branco fora de aspas são ignoradas`, () => {
  const { rows } = parseCsv('a,b\n\n1,2\n\n');
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});

test(`${TEST_NAME}: arquivo vazio e só linhas em branco → header vazio`, () => {
  assert.deepEqual(parseCsv(''), { header: [], rows: [] });
  assert.deepEqual(parseCsv('\n\r\n'), { header: [], rows: [] });
});

test(`${TEST_NAME}: campos vazios preservados (fim e meio da linha)`, () => {
  const { rows } = parseCsv('a,b,c\n,,\n1,,3');
  assert.deepEqual(rows[0], { a: '', b: '', c: '' });
  assert.deepEqual(rows[1], { a: '1', b: '', c: '3' });
});

test(`${TEST_NAME}: linha final sem newline é emitida`, () => {
  const { rows } = parseCsv('a,b\n1,2');
  assert.deepEqual(rows, [{ a: '1', b: '2' }]);
});

// --- Casos de falha da auditoria (antes engolidos em silêncio) ---

test(`${TEST_NAME}: D2 — aspa em posição inválida (ab"cd) falha alto com linha`, () => {
  assert.throws(
    () => parseCsv('a,b\nab"cd,2'),
    (error) => {
      assert.match(error.message, /aspa em posição inválida na linha 2/);
      return true;
    }
  );
});

test(`${TEST_NAME}: D2 — citação aberta sem fechamento falha alto apontando a linha`, () => {
  assert.throws(
    () => parseCsv('a,b\n"abc,2\n3,4'),
    (error) => {
      assert.match(error.message, /citação aberta na linha 2 nunca foi fechada/);
      return true;
    }
  );
});

test(`${TEST_NAME}: D2 — aspa após citação fechada no mesmo campo falha`, () => {
  assert.throws(
    () => parseCsv('a,b\n"abc"x,2'),
    /conteúdo após o fechamento da citação na linha 2/
  );
});

test(`${TEST_NAME}: D2 — registro com colunas EXCEDENTES falha (não trunca)`, () => {
  assert.throws(
    () => parseCsv('a,b\n1,2,3,4'),
    (error) => {
      assert.match(error.message, /linha 2 tem 4 colunas; o cabeçalho tem 2/);
      return true;
    }
  );
});

test(`${TEST_NAME}: D2 — registro com colunas AUSENTES falha`, () => {
  assert.throws(
    () => parseCsv('a,b,c\n1,2'),
    (error) => {
      assert.match(error.message, /linha 2 tem 2 colunas; o cabeçalho tem 3/);
      return true;
    }
  );
});

test(`${TEST_NAME}: D2 — linha só de espaços falha na contagem (fail-fast)`, () => {
  // Antes: linha " " era ignorada silenciosamente. Agora é registro malformado.
  assert.throws(() => parseCsv('a,b\n  \n1,2'), /colunas/);
});

test(`${TEST_NAME}: D2 — linha do cabeçalho é correta após linhas vazias iniciais`, () => {
  assert.throws(
    () => parseCsv('\n\na,b\n1'),
    (error) => {
      assert.match(error.message, /registro na linha 4/);
      assert.match(error.message, /linha do cabeçalho: 3/);
      return true;
    }
  );
});

test(`${TEST_NAME}: D2 — entrada não-string falha`, () => {
  assert.throws(() => parseCsv(null), /precisa ser texto/);
});

test(`${TEST_NAME}: D2 — malformação no MEIO do arquivo aborta (nada engolido)`, () => {
  // Antes da correção: aspa solta na linha 2 fazia o restante do arquivo virar
  // um único campo silenciosamente. Agora: erro imediato.
  const text = 'a,b,c\n1,2,3\nab"cd,x\n4,5,6';
  assert.throws(() => parseCsv(text), /aspa em posição inválida na linha 3/);
});

test(`${TEST_NAME}: formato real do OurAirports (amostra reduzida)`, () => {
  // Formato do dump: header com 18 colunas, campos citados, vírgulas dentro
  // de valores e campos vazios no fim.
  const sample =
    '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","gps_code","iata_code","local_code","home_link","wikipedia_link","keywords"\n' +
    '"6523","A,","large_airport","Aeroporto Nome, Com Vírgula","-23.43","-46.47","3500","SA","BR","BR-SP","Campinas","no","SBKP","VCP","","","viracopos","BR,sp"\n' +
    '"6524","B","small_airport","Outro","","","","","BR","BR-BA","Xique-Xique","no","","XIQ","","","",""';
  const { header, rows } = parseCsv(sample);
  assert.equal(header.length, 18);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Aeroporto Nome, Com Vírgula');
  assert.equal(rows[0].keywords, 'BR,sp');
  assert.equal(rows[1].iata_code, 'XIQ');
  assert.equal(rows[1].wikipedia_link, '');
});
