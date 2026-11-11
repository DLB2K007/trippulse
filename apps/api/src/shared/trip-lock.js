// Serialização por linha da viagem (PostgreSQL row lock).
//
// Pesquisas de ofertas (flights.service) e atualizações de viagem
// (trips.service) disputam O MESMO lock — a linha de `trips` — garantindo
// uma ordem total entre elas. Duas janelas que o lock fecha:
//   1. PUT commita primeiro → a pesquisa relê a config pós-lock, vê
//      divergência e aborta com 409 SEM persistir nada;
//   2. pesquisa commita primeiro → o PUT (também pós-lock) conta as ofertas
//      já visíveis e aplica a regra de imutabilidade (409).
//
// O lock é SEMPRE adquirido dentro de uma transação interativa e curta —
// nunca é mantido durante chamadas externas (provedores). Sob READ COMMITTED,
// a leitura imediatamente após o lock vê a versão mais recente commitada.
//
// Prisma 7: $queryRaw com parâmetro tipado (::uuid) — parametrização segura,
// sem concatenação de strings.
export async function lockTripRow(tx, tripId) {
  await tx.$queryRaw`SELECT "id" FROM "trips" WHERE "id" = ${tripId}::uuid FOR UPDATE`;
}
