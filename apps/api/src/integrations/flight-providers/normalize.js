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

export function normalizeFlightOffer(provider, rawOffer, relatedQuery) {
  const dataClassification = provider.isSimulated ? 'SIMULATED' : 'REAL';
  const normalizedOffer = {
    provider: provider.name,
    isSimulated: provider.isSimulated,
    dataClassification,
    type: 'flight',
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
    relatedQuery,
  };

  assertNormalizedOffer(normalizedOffer);

  // Barreira de segurança do MVP: enquanto a camada de persistência/comparação
  // de ofertas (próxima etapa) não existir, apenas simulações podem fluir.
  // A remoção desta barreira será parte do dia de integração de provedores reais.
  if (dataClassification === 'REAL') {
    throw new Error(
      'Provedores reais ainda não estão liberados: a etapa atual é apenas de simulação.'
    );
  }

  return normalizedOffer;
}
