// Normalização de ofertas de voos para o PADRÃO INTERNO DE OFERTAS do TripPulse.
//
// Padrão canônico de uma oferta ({
//   provider:            string,   // nome do provedor que entregou a oferta
//   isSimulated:         boolean,  // herdado do REGISTRO de provedores
//   dataClassification:  'SIMULATED' | 'REAL',
//   type:                'flight',
//   route:               { origin, destination },
//   dates:               { departureDate, arrivalDate },
//   flight:              { airline, flightNumber, stops, cabinClass, baggagePieces, refundable },
//   price:               { currency, total, base, taxes },
//   relatedQuery:        { ...consulta que gerou a oferta },
// }
//
// A classificação `SIMULATED`/`REAL` é atribuída AQUI a partir do registro de
// provedores (fonte confiável), nunca a partir dos dados do próprio provedor —
// um módulo externo não tem voz sobre a honestidade dos próprios dados.
//
// MAPEADORES POR PROVEDOR (Dia 11.8): o formato BRUTO depende do provedor
// (cada um fala seu próprio dialeto). O despacho é por NOME do provedor;
// o formato do simulador é o FALLBACK — os stubs de teste (ex.:
// `fake-slow-provider` em tests/api.test.js) entregam ofertas nesse formato.
//
// BARRA REAL REALOCADA (Dia 11.8): até o Dia 11.7 este módulo lançava erro
// para qualquer oferta REAL. Com a chegada do adaptador experimental
// SerpApi (que normaliza ofertas REAL de verdade), o BLOQUEIO DE EXPOSIÇÃO/
// PERSISTÊNCIA foi realocado para modules/flights/flights.service.js
// (HttpError 503 pós-normalização, antes de qualquer escrita no banco).
// A classificação continua explícita e honesta aqui; a decisão de LIBERAR
// dados REAL aos usuários é uma etapa futura e independente.

function assertNormalizedOffer(offer) {
  const requiredPaths = [
    'provider', 'isSimulated', 'dataClassification', 'type',
    'route.origin', 'route.destination',
    'dates.departureDate', 'dates.arrivalDate',
    'flight.airline', 'flight.flightNumber',
    'price.currency', 'price.total',
  ];

  for (const path of requiredPaths) {
    const value = path.split('.').reduce((acc, key) => acc?.[key], offer);
    if (value === undefined || value === null || value === '') {
      throw new Error(`Oferta normalizada incompleta: campo ausente "${path}".`);
    }
  }
}

// Formato BRUTO do provedor SIMULADO (dialeto interno de simulação):
// route.origin_iata/destination_iata, outbound_leg, pricing em _brl.
function normalizeSimulatedOffer(rawOffer) {
  return {
    route: {
      origin: rawOffer.route.origin_iata,
      destination: rawOffer.route.destination_iata,
    },
    dates: {
      departureDate: rawOffer.outbound_leg.depart_at,
      arrivalDate: rawOffer.outbound_leg.arrive_at,
    },
    flight: {
      airline: rawOffer.outbound_leg.carrier_name,
      flightNumber: rawOffer.outbound_leg.flight_number,
      stops: rawOffer.outbound_leg.connection_count,
      cabinClass: rawOffer.outbound_leg.seat_class,
      baggagePieces: rawOffer.baggage_pieces,
      refundable: rawOffer.refundable,
    },
    price: {
      currency: rawOffer.pricing.currency,
      total: rawOffer.pricing.grand_total_brl,
      base: rawOffer.pricing.fare_brl,
      taxes: rawOffer.pricing.tax_fees_brl,
    },
  };
}

// Formato BRUTO do SERPAPI Google Flights (Dia 11.8):
//   { type: 'one way' | 'round trip', currency, price,
//     outbound: <itinerário>, [return: <itinerário>], [price_insights] }
// Itinerário: { flights: [leg...], total_duration, price, departure_token? },
// leg: { departure_airport: { id, time }, arrival_airport: { id, time },
//        airline, flight_number, ... }.
//
// NOTAS SEMÂNTICAS (documentadas, não resolvidas aqui):
// - `departure_airport.time` é HORA LOCAL do aeroporto, sem offset. As datas
//   normalizadas usam apenas o DIA (YYYY-MM-DD) — determinístico e suficiente
//   para a identidade externa da oferta. Conversão para instantes com fuso é
//   pendência registrada (precisa de tabela de fuso, fora do escopo 11.8).
// - base/taxes NÃO são decompostos pelo SerpApi (preço único por itinerário):
//   ficam null. PENDÊNCIA: decidir política de decomposição antes de liberar
//   persistência REAL.
// - `price_insights` vai para relatedQuery.priceInsights: METADADO DE
//   CONTEXTO agregado da rota (Google), NUNCA misturado ao PriceHistory do
//   TripPulse (série por oferta). relatedQuery não é persistido hoje.
//
// CORREÇÃO DA AUDITORIA (D1): `flight_number` é componente do externalKey
// (identidade externa da oferta). Valores ausentes NUNCA são transformados
// em strings artificiais (ex.: "undefined") — o campo é OBRIGATÓRIO e um
// itinerário sem identificação de voo válida falha alto. Números escalares
// são aceitos e convertidos de forma determinística (não é invenção: o
// valor existe; apenas o TIPO varia entre respostas).
function requireSerpApiFlightNumber(flight) {
  const value = flight?.flight_number;

  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    const artificial = /^(null|undefined|nan|infinity)$/i.test(normalized);

    if (
      normalized.length > 0 &&
      !artificial &&
      /^[A-Za-z0-9]/.test(normalized) &&
      !/^0+$/.test(normalized)
    ) {
      // Espaços nas extremidades são removidos para não criar identidades
      // externas artificiais (`FA100` e `  FA100  ` são o mesmo voo).
      return normalized;
    }
  }

  throw new Error(
    'SerpApi: itinerário de ida sem flight_number válido — identidade da oferta exige identificação de voo (correção da auditoria D1).'
  );
}

function normalizeSerpApiOffer(rawOffer) {
  const outboundLegs = rawOffer.outbound.flights;
  const outboundFirst = outboundLegs[0];
  const outboundLast = outboundLegs[outboundLegs.length - 1];

  return {
    route: {
      origin: outboundFirst.departure_airport.id,
      destination: outboundLast.arrival_airport.id,
    },
    dates: {
      departureDate: outboundFirst.departure_airport.time.slice(0, 10),
      arrivalDate: outboundLast.arrival_airport.time.slice(0, 10),
    },
    flight: {
      airline: outboundFirst.airline,
      // Correção D1: validação explícita — ausente/null/vazio falha alto,
      // nunca vira "undefined" artificial (o externalKey depende deste campo).
      flightNumber: requireSerpApiFlightNumber(outboundFirst),
      stops: outboundLegs.length - 1,
      // travel_class=1 (economia) é o único enviado pela pesquisa hoje; a
      // classe vem da CONSULTA, não do itinerário.
      cabinClass: 'ECONOMY',
      // SerpApi Google Flights não expõe franquia de bagagem nem
      // reembolsabilidade por itinerário: campos ficam null (opcionais).
      baggagePieces: null,
      refundable: null,
    },
    price: {
      currency: rawOffer.currency,
      total: rawOffer.price,
      base: null,
      taxes: null,
    },
  };
}

// Despacho por NOME de provedor; fallback = formato do simulador (usado por
// todos os provedores simulados e pelos stubs de teste).
function normalizeRawOfferByProvider(provider, rawOffer) {
  if (provider.name === 'serpapi') {
    return normalizeSerpApiOffer(rawOffer);
  }
  return normalizeSimulatedOffer(rawOffer);
}

export function normalizeFlightOffer(provider, rawOffer, relatedQuery) {
  // A classificação deriva do REGISTRO, mas o registro só pode ser fonte de
  // verdade se declarar um booleano explícito. Truthiness aceitaria 'false',
  // 1 ou objetos como se fossem SIMULATED.
  if (provider === null || typeof provider !== 'object' || typeof provider.isSimulated !== 'boolean') {
    throw new TypeError('Provedor inválido: isSimulated precisa ser booleano explícito.');
  }

  const dataClassification = provider.isSimulated === true ? 'SIMULATED' : 'REAL';
  const mapped = normalizeRawOfferByProvider(provider, rawOffer);

  // price_insights do SerpApi: metadado de contexto (não persistido).
  const relatedQueryWithInsights = rawOffer.price_insights
    ? { ...relatedQuery, priceInsights: rawOffer.price_insights }
    : relatedQuery;

  const normalizedOffer = {
    provider: provider.name,
    isSimulated: provider.isSimulated,
    dataClassification,
    type: 'flight',
    ...mapped,
    relatedQuery: relatedQueryWithInsights,
  };

  assertNormalizedOffer(normalizedOffer);

  return normalizedOffer;
}
