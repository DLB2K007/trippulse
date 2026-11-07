import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../shared/errors.js';
import { isUuid } from '../../shared/uuid.js';

function assertValidTripData({ startDate, endDate }) {
  if (new Date(endDate) < new Date(startDate)) {
    throw new HttpError(
      400,
      'A data de término (endDate) deve ser posterior ou igual à data de início (startDate).'
    );
  }
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

  const trip = await prisma.trip.create({
    data: {
      name: data.name,
      destination: data.destination,
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
  await getTripById(id);
  assertValidTripData(data);

  const trip = await prisma.trip.update({
    where: { id },
    data: {
      name: data.name,
      destination: data.destination,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    },
  });

  return parseTripDates(trip);
}

export async function deleteTrip(id) {
  assertValidTripId(id);
  await getTripById(id);

  await prisma.trip.delete({ where: { id } });
}
