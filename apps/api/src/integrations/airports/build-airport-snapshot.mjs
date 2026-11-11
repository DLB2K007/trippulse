// Gerador do snapshot local de aeroportos do TripPulse (Dia 11.8).
//
// FONTE: OurAirports (https://ourairports.com/) — dados em DOMÍNIO PÚBLICO,
// publicados como CSV e atualizados a cada noite:
//   - airports.csv  (https://davidmegginson.github.io/ourairports-data/airports.csv)
//   - countries.csv (https://davidmegginson.github.io/ourairports-data/countries.csv)
//
// O QUE O SNAPSHOT CONTÉM: apenas aeroportos com SERVIÇO COMERCIAL REGULAR
// (scheduled_service == 'yes') e código IATA não vazio, dos tipos
// large_airport / medium_airport / small_airport. A identidade canônica é o
// `ident` do OurAirports (NUNCA o IATA, que não é chave primária e pode se
// repetir); o IATA é atributo de passageiro.
//
// COMO ATUALIZAR (procedimento): `node apps/api/src/integrations/airports/build-airport-snapshot.mjs`
// Reexecuta o download, refaz o filtro e regenera o JSON com metadados de
// proveniência (data, SHA-256 dos CSVs de origem, contagens). O arquivo gerado
// deve ser versionado junto ao código (no estado atual pode ainda estar não
// rastreado); NENHUMA requisição ao OurAirports acontece em runtime — o
// resolver lê apenas o snapshot local.
//
// Este script NÃO roda na inicialização da API nem nos testes: é um utilitário
// de manutenção de dados. Não há dependências externas (fetch/fs/crypto nativos).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.js';

const AIRPORTS_CSV_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const COUNTRIES_CSV_URL = 'https://davidmegginson.github.io/ourairports-data/countries.csv';
const COMMERCIAL_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

// Timestamp controlável para permitir regeneração byte a byte em CI/auditoria.
// Ex.: AIRPORT_SNAPSHOT_GENERATED_AT='2026-11-11T03:39:54.857Z' node ...
const generatedAt = process.env.AIRPORT_SNAPSHOT_GENERATED_AT ?? new Date().toISOString();
if (Number.isNaN(Date.parse(generatedAt))) {
  throw new Error('AIRPORT_SNAPSHOT_GENERATED_AT precisa ser uma data ISO válida.');
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

const [airportsCsv, countriesCsv] = await Promise.all([
  fetch(AIRPORTS_CSV_URL).then((response) => {
    if (!response.ok) throw new Error(`Falha ao baixar airports.csv: HTTP ${response.status}`);
    return response.text();
  }),
  fetch(COUNTRIES_CSV_URL).then((response) => {
    if (!response.ok) throw new Error(`Falha ao baixar countries.csv: HTTP ${response.status}`);
    return response.text();
  }),
]);

const airportRows = parseCsv(airportsCsv).rows;
const countryRows = parseCsv(countriesCsv).rows;

const countries = {};
for (const row of countryRows) {
  if (row.code) {
    countries[row.code] = row.name;
  }
}

const airports = [];
for (const row of airportRows) {
  if (row.scheduled_service !== 'yes') continue;
  if (!row.iata_code) continue;
  if (!COMMERCIAL_TYPES.has(row.type)) continue;

  airports.push({
    ident: row.ident,
    iata: row.iata_code,
    name: row.name,
    muni: row.municipality,
    country: row.iso_country,
    region: row.iso_region,
    type: row.type,
    kw: row.keywords ?? '',
  });
}

// Ordenação determinística e independente de locale (ASCII/code unit), para
// que o mesmo conjunto de origem produza o mesmo arquivo em qualquer host.
airports.sort((a, b) => (a.ident < b.ident ? -1 : a.ident > b.ident ? 1 : 0));

const snapshot = {
  meta: {
    source: AIRPORTS_CSV_URL,
    countriesSource: COUNTRIES_CSV_URL,
    license: 'Public domain (OurAirports — https://ourairports.com/help/data-dictionary.html)',
    generatedAt,
    sourceAirportsSha256: sha256(airportsCsv),
    sourceCountriesSha256: sha256(countriesCsv),
    filter:
      "scheduled_service == 'yes' && iata_code != '' && type in (large_airport, medium_airport, small_airport)",
    sourceAirportCount: airportRows.length,
    airportCount: airports.length,
    countryCount: Object.keys(countries).length,
    identityNote:
      'ident é a identidade canônica; iata_code é atributo e pode não ser único.',
  },
  countries,
  airports,
};

const outputDir = join(dirname(fileURLToPath(import.meta.url)), 'data');
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, 'airports-snapshot.json');

// Proteção contra sobrescrita acidental: se o snapshot existente tiver dados
// diferentes, o operador precisa revisar e passar `--force` explicitamente.
if (existsSync(outputPath) && !process.argv.includes('--force')) {
  const previous = JSON.parse(readFileSync(outputPath, 'utf8'));
  const sameData =
    JSON.stringify(previous.airports) === JSON.stringify(airports) &&
    JSON.stringify(previous.countries) === JSON.stringify(countries);

  if (!sameData) {
    throw new Error(
      'O snapshot gerado difere do arquivo atual. Investigue a mudança e use --force somente após revisar.'
    );
  }
}

writeFileSync(outputPath, JSON.stringify(snapshot));

console.log(`Snapshot gerado: ${outputPath}`);
console.log(`Aeroportos com serviço regular e IATA: ${airports.length} (de ${airportRows.length} no CSV de origem)`);
console.log(`Países: ${Object.keys(countries).length}`);
