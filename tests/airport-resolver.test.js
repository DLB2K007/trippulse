// Testes unitários do resolver de aeroportos (Dia 11.8).
//
// NÃO ACESSA REDE: usa o snapshot local commitado (OurAirports, domínio
// público) para os casos reais e um SNAPSHOT SINTÉTICO (construído aqui,
// rotulado como sintético) para cobrir cenários que o conjunto real não
// apresenta (ex.: IATA duplicado no filtro comercial).
//
// Execução: node --test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAirportResolver,
  getDefaultAirportResolver,
  normalizeLocationText,
} from '../apps/api/src/integrations/airports/airport-resolver.js';

const iatasOf = (result) => (result.matches ?? result.candidates ?? []).map((m) => m.iata);

// ---------------------------------------------------------------- snapshot real

test('Curitiba, Paraná, Brasil -> CWB (município exato, sem rede)', () => {
  const result = getDefaultAirportResolver().resolveLocation('Curitiba, Paraná, Brasil');

  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.source, 'municipality');
  assert.deepEqual(iatasOf(result), ['CWB']);
  assert.equal(result.matches[0].ident, 'SBCT');
  assert.equal(result.matches[0].country, 'BR');
});

test('Lisboa, Portugal -> LIS (alias curado: município é "Lisbon" na fonte)', () => {
  const result = getDefaultAirportResolver().resolveLocation('Lisboa, Portugal');

  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.source, 'curated-alias');
  assert.deepEqual(iatasOf(result), ['LIS']);
});

test('Madrid, Espanha -> MAD (município + país em português)', () => {
  const result = getDefaultAirportResolver().resolveLocation('Madrid, Espanha');

  assert.equal(result.status, 'RESOLVED');
  assert.deepEqual(iatasOf(result), ['MAD']);
});

test('São Paulo -> múltiplos aeroportos na ORDEM CURADA (GRU, CGH, VCP)', () => {
  // VCP tem município "Campinas" na fonte: sem a tabela curada, o casamento
  // natural por município jamais o incluíra em "São Paulo".
  const result = getDefaultAirportResolver().resolveLocation('São Paulo, São Paulo, Brasil');

  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.source, 'curated-alias');
  assert.deepEqual(iatasOf(result), ['GRU', 'CGH', 'VCP']);
});

test('normalização: acentos, maiúsculas e espaços extras não mudam o resultado', () => {
  const resolver = getDefaultAirportResolver();
  const key = (result) => ({ status: result.status, source: result.source, iatas: iatasOf(result) });
  const expected = key(resolver.resolveLocation('São Paulo, São Paulo, Brasil'));

  for (const variant of [
    'sao paulo, sao paulo, brasil',
    'SÃO PAULO, SÃO PAULO, BRASIL',
    '  São   Paulo , São Paulo , Brasil  ',
  ]) {
    assert.deepEqual(key(resolver.resolveLocation(variant)), expected);
  }
});

test('IATA explícito válido resolve com fonte iata-explicit', () => {
  const result = getDefaultAirportResolver().resolveLocation('CWB');

  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.source, 'iata-explicit');
  assert.deepEqual(iatasOf(result), ['CWB']);
});

test('localidade inexistente -> UNRESOLVED explícito, sem inventar match', () => {
  const result = getDefaultAirportResolver().resolveLocation('Cidade Inexistente, Brasil');

  assert.equal(result.status, 'UNRESOLVED');
  assert.equal(result.reason, 'UNKNOWN_LOCATION');
  assert.equal(result.matches, undefined);
});

test('localidade ambígua -> UNRESOLVED com candidatos, nunca o primeiro match', () => {
  // Springfield é nome com múltiplos aeroportos comerciais nos EUA.
  const result = getDefaultAirportResolver().resolveLocation('Springfield, Estados Unidos');

  assert.equal(result.status, 'UNRESOLVED');
  assert.equal(result.reason, 'AMBIGUOUS_LOCATION');
  assert.ok(result.candidates.length > 1);
});

test('aliases curados: Rio de Janeiro, Buenos Aires, Lisboa/lisbon', () => {
  const resolver = getDefaultAirportResolver();

  assert.deepEqual(iatasOf(resolver.resolveLocation('Rio de Janeiro, Brasil')), ['GIG', 'SDU']);
  assert.deepEqual(iatasOf(resolver.resolveLocation('Buenos Aires, Argentina')), ['AEP', 'EZE']);
  // Grafia em inglês também é aceita pelo alias curado.
  assert.deepEqual(iatasOf(resolver.resolveLocation('lisbon, portugal')), ['LIS']);
});

test('entrada curada inconsistente com o snapshot lança erro de manutenção', () => {
  // Snapshot SINTÉTICO + tabela curada SINTÉTICA: o alias declara 'XXX', que
  // não existe no snapshot. Bug de manutenção do repositório deve falhar
  // alto, nunca filtrar em silêncio.
  const syntheticSnapshot = {
    meta: { synthetic: true },
    countries: { BR: 'Brazil' },
    airports: [
      {
        ident: 'SYN1', iata: 'AAA', name: 'Alpha Airport', muni: 'Alpha City',
        country: 'BR', region: 'BR-SP', type: 'large_airport', kw: '',
      },
    ],
  };
  const syntheticAliases = [
    { aliases: ['alpha city'], country: 'BR', codes: ['AAA', 'XXX'], note: 'sintético' },
  ];

  const resolver = createAirportResolver(syntheticSnapshot, syntheticAliases);

  assert.throws(() => resolver.resolveLocation('Alpha City, Brasil'), /inconsistente/);
});

// ------------------------------------------------------- snapshot sintético

test('IATA duplicado no snapshot -> UNRESOLVED (AMBIGUOUS_IATA), nunca o primeiro', () => {
  // SINTÉTICO: o conjunto real filtrado não tem IATAs repetidos, então este
  // caso é construído em memória para travar o comportamento de segurança.
  const syntheticSnapshot = {
    meta: { synthetic: true },
    countries: { BR: 'Brazil' },
    airports: [
      {
        ident: 'SYNAA1', iata: 'AAA', name: 'Alpha One', muni: 'Alpha City',
        country: 'BR', region: 'BR-SP', type: 'large_airport', kw: '',
      },
      {
        ident: 'SYNAA2', iata: 'AAA', name: 'Alpha Two', muni: 'Beta City',
        country: 'BR', region: 'BR-RJ', type: 'medium_airport', kw: '',
      },
      {
        ident: 'SYNBB1', iata: 'BBB', name: 'Bravo Airport', muni: 'Bravo City',
        country: 'BR', region: 'BR-SP', type: 'large_airport', kw: '',
      },
    ],
  };

  const resolver = createAirportResolver(syntheticSnapshot);

  const ambiguous = resolver.resolveLocation('AAA');
  assert.equal(ambiguous.status, 'UNRESOLVED');
  assert.equal(ambiguous.reason, 'AMBIGUOUS_IATA');
  assert.deepEqual(iatasOf(ambiguous), ['AAA', 'AAA']);
  assert.deepEqual(ambiguous.candidates.map((c) => c.ident), ['SYNAA1', 'SYNAA2']);

  // Município único continua resolvendo normalmente no mesmo snapshot.
  const unique = resolver.resolveLocation('Bravo City, Brasil');
  assert.equal(unique.status, 'RESOLVED');
  assert.deepEqual(iatasOf(unique), ['BBB']);
});

// ---------------------------------------------------------------- resolveIata

test('resolveIata: código válido resolve; desconhecido -> UNRESOLVED; inválido -> TypeError', () => {
  const resolver = getDefaultAirportResolver();

  const valid = resolver.resolveIata('cwb');
  assert.equal(valid.status, 'RESOLVED');
  assert.deepEqual(iatasOf(valid), ['CWB']);

  const unknown = resolver.resolveIata('ZZZ');
  assert.equal(unknown.status, 'UNRESOLVED');
  assert.equal(unknown.reason, 'UNKNOWN_IATA');

  assert.throws(() => resolver.resolveIata('CW'), TypeError);
  assert.throws(() => resolver.resolveIata('CWBA'), TypeError);
  assert.throws(() => resolver.resolveIata(123), TypeError);
});

// --------------------------------------------------------- contract / helper

test('normalizeLocationText: acentos, caixa e espaços colapsados', () => {
  assert.equal(normalizeLocationText('  São   PAULO '), 'sao paulo');
  assert.equal(normalizeLocationText('AÇORIANOS'), 'acorianos');
  assert.equal(normalizeLocationText('München'), 'munchen');
});

test('resolveLocation rejeita entrada vazia e não-texto com TypeError', () => {
  const resolver = getDefaultAirportResolver();

  assert.throws(() => resolver.resolveLocation(''), TypeError);
  assert.throws(() => resolver.resolveLocation('   '), TypeError);
  assert.throws(() => resolver.resolveLocation(null), TypeError);
  assert.throws(() => resolver.resolveLocation(42), TypeError);
});
