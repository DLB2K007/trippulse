// Provedor de passagens SIMULADO.
//
// Este módulo simula um provedor externo de passagens aéreas (como Amadeus,
// Expedia, companhias aéreas etc.), devolvendo dados brutos no formato próprio
// de um provedor: nomes de campos em estilo externo, preços fracionados em
// tarifa/impostos etc. Nada aqui conhece o padrão interno de ofertas do TripPulse.
//
// Regras importantes:
// - Nenhum dado produzido aqui representa oferta real: o registro declara este
//   provedor como `isSimulated: true` e o normalizador marca cada oferta como
//   `SIMULATED` no padrão interno.
// - A identidade dos voos (companhias, números, rota) é determinística por
//   consulta; os preços variam através da `variationSeed` (injetada pelo
//   orquestrador), simulando a oscilação de preços do mercado.

// Hubs de origem fictícios (a viagem só possui destino no modelo atual).
const ORIGIN_HUBS = ['GRU', 'GIG', 'CNF', 'BSB'];

const CARRIERS = [
  { carrierName: 'Simulated Airways', carrierCode: 'SIA' },
  { carrierName: 'PineJet', carrierCode: 'PJT' },
  { carrierName: 'CloudWings', carrierCode: 'CLW' },
];

const CABINS = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS'];

// Gerador pseudo-aleatório com semente (determinismo por consulta).
function createSeededRandom(seedText) {
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  }

  return function random() {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deriva um "código IATA" determinístico a partir do texto do destino.
function deriveAirportCode(destinationText) {
  const letters = destinationText
    .toUpperCase()
    .replace(/[^A-Z]/g, '');

  if (letters.length >= 3) {
    return letters.slice(0, 3);
  }

  // Destino sem letras suficientes: código derivado do hash (inviável em provedor real).
  return letters.padEnd(3, 'X').slice(0, 3) || 'XXX';
}

function roundToCents(value) {
  return Math.round(value * 100) / 100;
}

function addHours(isoDate, hours) {
  const date = new Date(isoDate);
  date.setUTCHours(date.getUTCHours() + hours);
  return date.toISOString();
}

export const simulatedFlightProvider = {
  name: 'simulated-airways',
  isSimulated: true,

  async search(query, options = {}) {
    const variationSeed = options.variationSeed ?? 0;

    // Identidade dos voos é determinística por consulta (rota, companhias,
    // números de voo): a mesma pesquisa sempre referencia os mesmos voos.
    const identityRandom = createSeededRandom(JSON.stringify(query));

    // Preços derivam da consulta + semente de variação: pesquisas diferentes
    // observam preços distintos, simulando o movimento do mercado e permitindo
    // exercitar o histórico de preços com o provedor simulado.
    const priceRandom = createSeededRandom(`${JSON.stringify(query)}|variation=${variationSeed}`);

    const destinationCode = deriveAirportCode(query.destination);
    const originCode = query.origin ?? ORIGIN_HUBS[Math.floor(identityRandom() * ORIGIN_HUBS.length)];

    const offerCount = 3 + Math.floor(identityRandom() * 3); // 3 a 5 ofertas

    const results = [];

    for (let index = 0; index < offerCount; index += 1) {
      const carrier = CARRIERS[Math.floor(identityRandom() * CARRIERS.length)];
      const cabin = CABINS[Math.floor(identityRandom() * CABINS.length)];
      const connectionCount = identityRandom() > 0.7 ? 1 : 0;

      const fareBrl = roundToCents(700 + priceRandom() * 3200);
      const taxBrl = roundToCents(fareBrl * (0.12 + priceRandom() * 0.2));

      results.push({
        result_id: `SIM-${destinationCode}-${String(Math.floor(identityRandom() * 900000) + 100000)}`,
        route: {
          origin_iata: originCode,
          destination_iata: destinationCode,
        },
        outbound_leg: {
          carrier_name: carrier.carrierName,
          carrier_code: carrier.carrierCode,
          flight_number: `${carrier.carrierCode}${String(Math.floor(identityRandom() * 9000) + 1000)}`,
          depart_at: `${query.departureDate}T0${Math.floor(identityRandom() * 7) + 6}:00:00Z`,
          arrive_at: addHours(`${query.departureDate}T10:00:00Z`, 8 + connectionCount * 3),
          connection_count: connectionCount,
          seat_class: cabin,
        },
        pricing: {
          currency: 'BRL',
          fare_brl: fareBrl,
          tax_fees_brl: taxBrl,
          grand_total_brl: roundToCents(fareBrl + taxBrl),
        },
        baggage_pieces: cabin === 'ECONOMY' ? 0 : 2,
        refundable: cabin === 'BUSINESS',
      });
    }

    return results;
  },
};
