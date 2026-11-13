// Domínio das ofertas: persistência de snapshots de oferta e histórico de preços.
// Consumido pelo módulo flights (e futuramente por hotéis/veículos/atividades).

import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { isUuid } from '../../shared/uuid.js';
import { assertOnlySimulatedOffers } from '../../shared/real-barrier.js';

// Identidade externa de uma oferta: mesma combinação de provedor + rota +
// voo + partida representa o MESMO voo observado, mesmo que o preço mude.
export function buildOfferExternalKey(offer) {
  return [
    offer.provider,
    offer.route.origin,
    offer.route.destination,
    offer.flight.airline,
    offer.flight.flightNumber,
    offer.dates.departureDate,
  ].join('|');
}

function buildTrend(previousObservation, currentTotal) {
  if (!previousObservation) {
    return 'FIRST_OBSERVATION';
  }

  if (currentTotal < previousObservation.total) {
    return 'DROPPED';
  }

  if (currentTotal > previousObservation.total) {
    return 'ROSE';
  }

  return 'UNCHANGED';
}

function assertValidTripId(id) {
  if (!isUuid(id)) {
    throw new HttpError(400, 'O identificador da viagem precisa ser um UUID válido.');
  }
}

// VALIDAÇÃO ESTRUTURAL APENAS (fechamento do Dia 11.9).
//
// `assertTransactionClient` confere a FORMA do objeto recebido: rejeita `tx`
// ausente/nulo, não-objetos, o client Prisma global e clients sem os delegates
// `flightOffer`/`priceHistory`. Ela NÃO prova — e deliberadamente não finge
// provar — que:
//   - a transação está de fato ativa;
//   - o client pertence a uma transação interativa real do Prisma;
//   - `lockTripRow` foi executado nesta transação;
//   - a transação não foi finalizada (commit/rollback) antes da chamada.
//
// Essas garantias são responsabilidade do CHAMADOR: fornecer o `tx` de uma
// transação interativa JÁ ABERTA e executar `lockTripRow(tx, tripId)` ANTES de
// `persistOfferSnapshot`, mantendo lock, comparação da configuração e
// persistência na MESMA transação. Não abrimos transação interna aqui porque
// uma segunda transação não herdaria o lock — isso quebraria o protocolo de
// concorrência de `shared/trip-lock.js`.
//
// Nenhuma verificação artificial compensa a ausência dessas garantias: o
// contrato é documentado e o chamador é único (ver `persistOfferSnapshot`).
function assertTransactionClient(tx) {
  if (tx === null || typeof tx !== 'object' || tx === prisma) {
    throw new TypeError(
      'persistOfferSnapshot exige um client transacional ativo (tx); o client Prisma global não é aceito.'
    );
  }

  const flightOffer = tx.flightOffer;
  const priceHistory = tx.priceHistory;

  if (
    !flightOffer ||
    typeof flightOffer.findUnique !== 'function' ||
    typeof flightOffer.create !== 'function' ||
    !priceHistory ||
    typeof priceHistory.create !== 'function' ||
    typeof priceHistory.findFirst !== 'function'
  ) {
    throw new TypeError(
      'persistOfferSnapshot exige um client transacional com os delegates flightOffer e priceHistory.'
    );
  }
}

// Projeção pública de uma observação. `sequence` é um detalhe interno de
// desempate: além de não fazer parte do contrato HTTP, é BigInt e não pode ser
// entregue a JSON.stringify.
function toHistoryObservation(observation) {
  return {
    currency: observation.currency,
    total: observation.total,
    base: observation.base,
    taxes: observation.taxes,
    observedAt: observation.observedAt.toISOString(),
  };
}

// Melhor preço observado: menor total; empate pelo menor observedAt; e, no
// mesmo instante, pela menor sequence. Compara os registros crus para que o
// desempate não dependa da ordem acidental da consulta.
function selectBestObservation(best, candidate) {
  if (!best) {
    return candidate;
  }

  if (candidate.total !== best.total) {
    return candidate.total < best.total ? candidate : best;
  }

  const candidateTime = candidate.observedAt.getTime();
  const bestTime = best.observedAt.getTime();

  if (candidateTime !== bestTime) {
    return candidateTime < bestTime ? candidate : best;
  }

  return candidate.sequence < best.sequence ? candidate : best;
}

// Histórico consolidado das ofertas persistidas de uma viagem.
// Lê APENAS do banco: série completa de observações por oferta,
// com current/previous/best/trend derivados do PriceHistory.
export async function listOfferHistoryForTrip(tripId) {
  assertValidTripId(tripId);

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });

  if (!trip) {
    throw new HttpError(404, 'Viagem não encontrada.');
  }

  const storedOffers = await prisma.flightOffer.findMany({
    where: { tripId },
    include: {
      // Ordem canônica do histórico: a data é a chave principal e a sequence
      // desempata somente timestamps iguais. Nunca o contrário.
      priceHistory: { orderBy: [{ observedAt: 'asc' }, { sequence: 'asc' }] },
    },
    orderBy: [{ flightNumber: 'asc' }],
  });

  const offers = storedOffers.map((storedOffer) => {
    const observations = storedOffer.priceHistory.map(toHistoryObservation);

    const current = observations[observations.length - 1] ?? null;
    const previous = observations.length > 1 ? observations[observations.length - 2] : null;
    const bestObservation = storedOffer.priceHistory.reduce(selectBestObservation, null);
    const best = bestObservation ? toHistoryObservation(bestObservation) : null;

    return {
      id: storedOffer.id,
      provider: storedOffer.provider,
      dataClassification: storedOffer.dataClassification,
      type: storedOffer.type,
      route: {
        origin: storedOffer.origin,
        destination: storedOffer.destination,
      },
      dates: {
        departureDate: storedOffer.departureDate.toISOString(),
        arrivalDate: storedOffer.arrivalDate.toISOString(),
      },
      flight: {
        airline: storedOffer.airline,
        flightNumber: storedOffer.flightNumber,
        stops: storedOffer.stops,
        cabinClass: storedOffer.cabinClass,
        baggagePieces: storedOffer.baggagePieces,
        refundable: storedOffer.refundable,
      },
      externalKey: storedOffer.externalKey,
      observations,
      current,
      previous,
      best,
      trend: buildTrend(previous ? { total: previous.total } : null, current?.total),
    };
  });

  return {
    tripId,
    offerCount: offers.length,
    offers,
  };
}
// Persiste o snapshot de uma pesquisa e calcula o comparativo de cada oferta.
// Retorna um Map: externalKey -> { observedAt, current, previous, best, trend }.
//
// `tx` (Dia 11.6; obrigatório no fechamento do Dia 11.9): client de uma
// transação interativa JÁ ABERTA. No fluxo de pesquisa, persistOfferSnapshot
// roda DENTRO da transação que segura o lock da linha da viagem — ofertas e
// observações commitam ou roll back juntas (nada de snapshots parciais), e a
// comparação de configuração do flights.service é atômica com as escritas.
// Não existe fallback para o client global: chamadas sem `tx` falham antes de
// qualquer operação Prisma.
//
// CONTRATO DO CHAMADOR (obrigatório, não verificável aqui): abrir a transação
// interativa, executar `lockTripRow(tx, tripId)` e só então chamar esta função
// — lock, comparação e persistência na mesma transação. `assertTransactionClient`
// é apenas estrutural (ver comentário acima); ela não comprova transação ativa
// nem aquisição do lock.
//
// SUPERFÍCIE DE ACESSO: a exportação é mantida porque o único chamador de
// produção (`modules/flights/flights.service.js`) vive em outro módulo e os
// testes cobrem a função diretamente. Ela não é API pública do projeto: novos
// chamadores precisam respeitar integralmente o contrato acima. Uma capability
// token não acrescentaria garantia real (continuaria sem provar transação
// ativa), então não foi introduzida.
export async function persistOfferSnapshot(tripId, offers, tx) {
  assertTransactionClient(tx);
  // DEFESA EM PROFUNDIDADE FAIL-CLOSED (Dia 11.8, correção D5): acesso
  // direto à persistência também precisa provar SIMULATED. Não basta rejeitar
  // a string REAL: classificação ausente/desconhecida, `isSimulated` ausente
  // e combinações inconsistentes também falham ANTES de qualquer operação de
  // banco (inclusive o primeiro findUnique).
  assertOnlySimulatedOffers(offers);

  const observedAt = new Date();
  const snapshotResult = new Map();

  for (const offer of offers) {
    const externalKey = buildOfferExternalKey(offer);

    const existingOffer = await tx.flightOffer.findUnique({
      where: { tripId_externalKey: { tripId, externalKey } },
    });

    let flightOfferRow;

    if (existingOffer) {
      flightOfferRow = existingOffer;
    } else {
      flightOfferRow = await tx.flightOffer.create({
        data: {
          tripId,
          provider: offer.provider,
          dataClassification: offer.dataClassification,
          type: offer.type,
          origin: offer.route.origin,
          destination: offer.route.destination,
          departureDate: new Date(offer.dates.departureDate),
          arrivalDate: new Date(offer.dates.arrivalDate),
          airline: offer.flight.airline,
          flightNumber: offer.flight.flightNumber,
          stops: offer.flight.stops,
          cabinClass: offer.flight.cabinClass,
          baggagePieces: offer.flight.baggagePieces,
          refundable: offer.flight.refundable,
          externalKey,
        },
      });
    }

    await tx.priceHistory.create({
      data: {
        offerId: flightOfferRow.id,
        currency: offer.price.currency,
        total: offer.price.total,
        base: offer.price.base ?? null,
        taxes: offer.price.taxes ?? null,
        observedAt,
      },
    });

    // A observação recém-inserida NÃO é necessariamente a atual: se o relógio
    // ou uma carga histórica produzir um observedAt anterior, a ordem canônica
    // continua sendo observada. Consultamos depois da escrita, nunca antes.
    const currentObservation = await tx.priceHistory.findFirst({
      where: { offerId: flightOfferRow.id },
      orderBy: [{ observedAt: 'desc' }, { sequence: 'desc' }],
    });

    // `previous` é o imediatamente anterior na ordem canônica. A comparação
    // precisa ser lexicográfica: sequence só desempata o MESMO observedAt.
    const previousObservation = await tx.priceHistory.findFirst({
      where: {
        offerId: flightOfferRow.id,
        OR: [
          { observedAt: { lt: currentObservation.observedAt } },
          {
            observedAt: currentObservation.observedAt,
            sequence: { lt: currentObservation.sequence },
          },
        ],
      },
      orderBy: [{ observedAt: 'desc' }, { sequence: 'desc' }],
    });

    const bestObservation = await tx.priceHistory.findFirst({
      where: { offerId: flightOfferRow.id },
      orderBy: [{ total: 'asc' }, { observedAt: 'asc' }, { sequence: 'asc' }],
    });

    snapshotResult.set(externalKey, {
      // Instante da captura deste snapshot; não necessariamente o observedAt
      // da observação current, que segue a ordem canônica do histórico.
      observedAt,
      current: {
        total: currentObservation.total,
        currency: currentObservation.currency,
      },
      previous: previousObservation
        ? {
            total: previousObservation.total,
            currency: previousObservation.currency,
            observedAt: previousObservation.observedAt,
          }
        : null,
      best: {
        total: bestObservation.total,
        currency: bestObservation.currency,
        observedAt: bestObservation.observedAt,
      },
      trend: buildTrend(previousObservation, currentObservation.total),
    });
  }

  return snapshotResult;
}
