import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { isUuid } from '../../shared/uuid.js';
import { lockTripRow } from '../../shared/trip-lock.js';

function assertValidTripData({ startDate, endDate }) {
  if (new Date(endDate) < new Date(startDate)) {
    throw new HttpError(
      400,
      'A data de término (endDate) deve ser posterior ou igual à data de início (startDate).'
    );
  }
}

// Origem como texto canônico de localização (mesmo padrão do destination).
// Obrigatória na criação (POST); opcional no PUT (ausente = manter a atual).
function assertValidOrigin(origin, { required }) {
  if (origin === undefined || origin === null) {
    if (required) {
      throw new HttpError(400, 'A viagem precisa de uma origem (origin).');
    }
    return;
  }

  if (typeof origin !== 'string' || origin.trim().length === 0) {
    throw new HttpError(400, 'A origem (origin) precisa ser um texto não vazio.');
  }
}

// Campos que definem a "rota e o período" da viagem. O externalKey das ofertas
// inclui rota (origin + destination) e departureDate — alterar qualquer um
// deles após a primeira oferta persistida misturaria históricos de rotas ou
// períodos diferentes na mesma viagem. A política (Dia 11.6): congelados.
const SEARCH_FIELDS = ['origin', 'destination', 'startDate', 'endDate'];

// Compara a configuração enviada com a armazenada. Datas entram normalizadas
// para ISO (yyyy-mm-dd), igual à persistência e à resposta da API.
function frozenFieldChanged(trip, data) {
  const incoming = {
    origin: data.origin ?? trip.origin ?? null,
    destination: data.destination,
    startDate: new Date(data.startDate).toISOString().slice(0, 10),
    endDate: new Date(data.endDate).toISOString().slice(0, 10),
  };
  const stored = {
    origin: trip.origin ?? null,
    destination: trip.destination,
    startDate: trip.startDate.toISOString().slice(0, 10),
    endDate: trip.endDate.toISOString().slice(0, 10),
  };

  return SEARCH_FIELDS.some((field) => incoming[field] !== stored[field]);
}

// Transação curta com lock de linha: serializa atualizações concorrentes entre
// si e contra pesquisas em voo (mesmo lock usado pelo flights.service).
async function updateTripWithinTransaction(tx, id, data) {
  await lockTripRow(tx, id);

  const trip = await tx.trip.findUnique({ where: { id } });

  if (!trip) {
    throw new HttpError(404, 'Viagem não encontrada.');
  }

  // A contagem acontece APÓS o lock: uma pesquisa que persistiu primeiro já é
  // visível aqui, e uma que persistir depois verá a config alterada e abortará.
  const offerCount = await tx.flightOffer.count({ where: { tripId: id } });

  if (offerCount > 0 && frozenFieldChanged(trip, data)) {
    throw new HttpError(
      409,
      'Campos de rota/período (origin, destination, startDate, endDate) não podem ser alterados após a persistência de ofertas; crie outra viagem.'
    );
  }

  const updated = await tx.trip.update({
    where: { id },
    data: {
      name: data.name,
      destination: data.destination,
      origin: data.origin ?? trip.origin,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    },
  });

  return updated;
}

function parseTripDates(trip) {
  return {
    ...trip,
    startDate: trip.startDate.toISOString().slice(0, 10),
    endDate: trip.endDate.toISOString().slice(0, 10),
  };
}

export async function createTrip(data) {
  assertValidTripData(data);
  assertValidOrigin(data.origin, { required: true });

  const trip = await prisma.trip.create({
    data: {
      name: data.name,
      destination: data.destination,
      origin: data.origin,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    },
  });

  return parseTripDates(trip);
}

export async function listTrips() {
  const trips = await prisma.trip.findMany({
    orderBy: { startDate: 'asc' },
  });

  return trips.map(parseTripDates);
}

function assertValidTripId(id) {
  if (!isUuid(id)) {
    throw new HttpError(400, 'O identificador da viagem precisa ser um UUID válido.');
  }
}

export async function getTripById(id) {
  assertValidTripId(id);

  const trip = await prisma.trip.findUnique({ where: { id } });

  if (!trip) {
    throw new HttpError(404, 'Viagem não encontrada.');
  }

  return parseTripDates(trip);
}

export async function updateTrip(id, data) {
  assertValidTripId(id);
  assertValidTripData(data);
  assertValidOrigin(data.origin, { required: false });

  const trip = await prisma.$transaction(
    (tx) => updateTripWithinTransaction(tx, id, data),
    { timeout: 10_000, maxWait: 5_000 }
  );

  return parseTripDates(trip);
}

export async function deleteTrip(id) {
  assertValidTripId(id);
  await getTripById(id);

  await prisma.trip.delete({ where: { id } });
}
