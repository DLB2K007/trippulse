// Orquestra a pesquisa simulada de passagens aéreas de uma viagem cadastrada.
// Fluxo (Dia 11.6): viagem (com origem, gate 409) -> provedores (integrations,
// FORA da transação) -> normalização -> transação com lock de linha da viagem
// -> comparação de configuração -> snapshot atômico de ofertas/histórico
// (modules/offers) -> resposta.
//
// POR QUE A TRANSAÇÃO SÓ ABRIR DEPOIS DO PROVEDOR: nenhuma transação ou lock
// é mantido durante a chamada externa. A serialização por linha (shared/
// trip-lock.js) garante que uma alteração da viagem DURANTE a pesquisa torna
// os resultados inválidos: a comparação pós-lock aborta com 409 e nada é
// persistido; se a pesquisa persistir primeiro, o PUT pós-lock verá as ofertas
// e aplicará a regra de imutabilidade (409). As duas ordens produzem estado
// consistente.

import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { isUuid } from '../../shared/uuid.js';
import { lockTripRow } from '../../shared/trip-lock.js';
import {
  assertOnlySimulatedOffers,
  assertOnlySimulatedProviders,
} from '../../shared/real-barrier.js';
import { getFlightProviders } from '../../integrations/flight-providers/index.js';
import { normalizeFlightOffer } from '../../integrations/flight-providers/normalize.js';
import {
  persistOfferSnapshot,
  buildOfferExternalKey,
} from '../offers/offers.service.js';

// Configuração comparável da viagem: os 4 campos que definem rota e período,
// normalizados exatamente como a resposta da API expõe (datas ISO yyyy-mm-dd).
// Pesquisa captura no início; transação compara com o estado pós-lock.
function tripSearchConfig(trip) {
  return {
    origin: trip.origin ?? null,
    destination: trip.destination,
    departureDate: trip.startDate.toISOString().slice(0, 10),
    returnDate: trip.endDate.toISOString().slice(0, 10),
  };
}

function assertSameTripConfig(captured, current) {
  const same =
    captured.origin === current.origin &&
    captured.destination === current.destination &&
    captured.departureDate === current.departureDate &&
    captured.returnDate === current.returnDate;

  if (!same) {
    throw new HttpError(
      409,
      'A viagem foi alterada durante a pesquisa; nenhuma oferta foi registrada.'
    );
  }
}

export async function searchFlightsForTrip(tripId, { providers } = {}) {
  // Mesmo contrato dos demais recursos aninhados: id inválido é 400 de
  // domínio, nunca um erro do Prisma (que se apresentaria como 500).
  if (!isUuid(tripId)) {
    throw new HttpError(400, 'O identificador da viagem precisa ser um UUID válido.');
  }

  // D6: resolve e valida o registro de providers antes de QUALQUER acesso ao
  // banco. A lista vazia ou um provider malformado não deve provocar sequer a
  // leitura da viagem; isso também vale para a pesquisa manual e para o
  // scheduler, que compartilham este service.
  const resolvedProviders = providers ?? getFlightProviders();
  assertOnlySimulatedProviders(resolvedProviders);

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });

  if (!trip) {
    throw new HttpError(404, 'Viagem não encontrada.');
  }

  // Viagens legadas (pré-Dia 11.6) não têm origem: sem backfill fictício, uma
  // nova pesquisa associaria a origem errada ao histórico. O usuário atualiza
  // a viagem (se não tiver ofertas) ou cria outra.
  if (trip.origin == null) {
    throw new HttpError(
      409,
      'A viagem não possui origem cadastrada; atualize-a (se não tiver ofertas) ou crie outra viagem.'
    );
  }

  const searchQuery = {
    origin: trip.origin,
    destination: trip.destination,
    departureDate: trip.startDate.toISOString().slice(0, 10),
    returnDate: trip.endDate.toISOString().slice(0, 10),
  };

  const priorObservations = await prisma.priceHistory.count({
    // Histórico acumulado do percurso de observações anteriores, usado como
    // semente de variação de preços no provedor (nenhuma observação anterior
    // é necessária no momento da pesquisa atual).
    where: { flightOffer: { tripId } },
  });
  // Cada pesquisa adiciona uma observação por oferta, então o número de
  // observações anteriores cresce uniformemente e separa pesquisas distintas.
  const previousOfferCount = await prisma.flightOffer.count({ where: { tripId } });
  const variationSeed = previousOfferCount > 0 ? Math.floor(priorObservations / previousOfferCount) : 0;

  // CHAMADA EXTERNA — fora de qualquer transação (nenhum lock retido aqui).
  const providerResults = await Promise.all(
    resolvedProviders.map(async (provider) => {
      const rawOffers = await provider.search(searchQuery, { variationSeed });
      return rawOffers.map((rawOffer) => normalizeFlightOffer(provider, rawOffer, searchQuery));
    })
  );

  const offers = providerResults.flat();

  // BARRA REAL — CAMADA DE DEFESA ADICIONAL, também fail-closed: uma oferta
  // sem classificação SIMULATED + isSimulated true não segue para a transação.
  // A barreira principal está ANTES dos providers; esta cobre um caminho
  // futuro que produza uma oferta inconsistente após a normalização.
  assertOnlySimulatedOffers(offers);

  const capturedConfig = tripSearchConfig(trip);

  // Transação curta: lock da linha da viagem -> relê a config -> compara com a
  // capturada -> persiste o snapshot ATOMICAMENTE na mesma transação. Um throw
  // HttpError(409) dentro da transação aborta tudo (nenhuma linha gravada).
  return prisma.$transaction(
    async (tx) => {
      await lockTripRow(tx, tripId);

      const current = await tx.trip.findUnique({ where: { id: tripId } });

      if (!current) {
        throw new HttpError(404, 'Viagem não encontrada.');
      }

      assertSameTripConfig(capturedConfig, tripSearchConfig(current));

      // Persistência do snapshot: alimenta o histórico de preços e gera o
      // comparativo — ofertas e observações commitam ou roll back juntas.
      const snapshotResult = await persistOfferSnapshot(tripId, offers, tx);

      return {
        simulated: true,
        persisted: true,
        providerCount: resolvedProviders.length,
        query: {
          origin: searchQuery.origin,
          destination: searchQuery.destination,
          departureDate: searchQuery.departureDate,
          returnDate: searchQuery.returnDate,
        },
        offers: offers.map((offer) => ({
          ...offer,
          history: snapshotResult.get(buildOfferExternalKey(offer)),
        })),
      };
    },
    { timeout: 10_000, maxWait: 5_000 }
  );
}
