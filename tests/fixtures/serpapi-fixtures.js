// FIXTURES SINTÉTICAS do SerpApi Google Flights — Dia 11.8.
//
// ATENÇÃO: TODAS as respostas aqui são SINTÉTICAS — construídas à mão para
// testar o adaptador SEM conta SerpApi e SEM internet. Nenhuma delas é uma
// resposta real capturada do SerpApi; a estrutura segue a documentação
// pública do produto (2026-11) e será substituída por fixtures capturadas
// (com proveniência) quando houver conta autorizada.
//
// Regras das fixtures:
// - Formato: objetos nas chaves usadas pelo adaptador/normalizador
//   (`best_flights`/`other_flights`, `flights`, `departure_airport.time`,
//   `price`, `departure_token`, `price_insights`).
// - Códigos, companhias e preços são fictícios (AAA/BBB, Fake Air) e nunca
//   correspondem a ofertas reais do mercado.

// Leg de ida sintética no formato do Google Flights (hora local sem offset).
function fakeLeg({
  fromId,
  toId,
  departTime,
  arriveTime,
  airline = 'Fake Air',
  flightNumber = 'FA100',
  airplane = 'FakeJet 320',
}) {
  return {
    departure_airport: { name: `Fake Airport ${fromId}`, id: fromId, time: departTime },
    arrival_airport: { name: `Fake Airport ${toId}`, id: toId, time: arriveTime },
    airplane,
    airline,
    airline_logo: null,
    travel_class: 'Economy',
    flight_number: flightNumber,
    legroom: null,
    extensions: ['Carbon emissions estimate: 100 kg'],
  };
}

// Itinerário sintético (objeto de best_flights/other_flights).
export function fakeItinerary({
  fromId = 'GRU',
  toId = 'LIS',
  price = 1000,
  duration = 600,
  airline = 'Fake Air',
  flightNumber = 'FA100',
  departTime = '2027-03-10 10:00',
  arriveTime = '2027-03-10 22:00',
  departureToken = undefined,
} = {}) {
  const itinerary = {
    flights: [
      fakeLeg({ fromId, toId, departTime, arriveTime, airline, flightNumber }),
    ],
    layovers: [],
    total_duration: duration,
    carbon_emissions_g: { this_model_cost_extra: 0, difference_percent: -1 },
    price,
    type: departureToken === undefined ? 'one way' : 'round trip',
    airline_logo: null,
    booking_token: 'SYNTHETIC_BOOKING_TOKEN',
  };

  if (departureToken !== undefined) {
    itinerary.departure_token = departureToken;
  }

  return itinerary;
}

// Resposta inicial sintética para round-trip: mercado de ida com tokens.
export function fakeInitialRoundTripResponse({
  outbounds = [],
  priceInsights = undefined,
} = {}) {
  return {
    search_metadata: { id: 'SYNTHETIC', status: 'Complete' },
    search_parameters: {
      engine: 'google_flights',
      type: 1,
      currency: 'BRL',
    },
    ...(priceInsights ? { price_insights: priceInsights } : {}),
    best_flights: outbounds,
    other_flights: [],
  };
}

// Resposta de retorno sintética (2ª requisição, com departure_token).
export function fakeReturnResponse({
  returns = [],
  priceInsights = undefined,
} = {}) {
  return {
    search_metadata: { id: 'SYNTHETIC_RETURN', status: 'Complete' },
    search_parameters: {
      engine: 'google_flights',
      type: 1,
      currency: 'BRL',
      departure_token: 'SYNTHETIC_DEPARTURE_TOKEN',
    },
    ...(priceInsights ? { price_insights: priceInsights } : {}),
    best_flights: returns,
    other_flights: [],
  };
}

// Resposta sintética de ida simples (type=2).
export function fakeOneWayResponse({ outbounds = [], priceInsights = undefined } = {}) {
  return {
    search_metadata: { id: 'SYNTHETIC_ONEWAY', status: 'Complete' },
    search_parameters: {
      engine: 'google_flights',
      type: 2,
      currency: 'BRL',
    },
    ...(priceInsights ? { price_insights: priceInsights } : {}),
    best_flights: outbounds,
    other_flights: [],
  };
}

// price_insights sintético: metadado de contexto (NÃO é PriceHistory).
export const SYNTHETIC_PRICE_INSIGHTS = {
  lowest_price: 900,
  price_level: 'typical',
  typical_price_range: [850, 1400],
  price_history: [
    [1731225600, 1000],
    [1731312000, 950],
  ],
};

// Fetch sintético: sempre responde com o JSON passado (rotas independentes).
export function fakeFetchSequence(responses) {
  const calls = [];
  const responsesQueue = [...responses];

  const fetchImpl = async (url) => {
    calls.push(url);

    if (responsesQueue.length === 0) {
      throw new Error('fakeFetchSequence: mais requisições do que respostas na fixture.');
    }

    const next = responsesQueue.shift();
    if (next instanceof Error) {
      throw next;
    }
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body ?? {})),
    };
  };

  return { fetchImpl, calls };
}
