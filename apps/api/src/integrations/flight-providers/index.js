// Registro de provedores de pesquisa de voos.
//
// Contrato de um provedor de voos:
// {
//   name: string,        // identificador estável do provedor
//   isSimulated: boolean // declarado pelo REGISTRO, nunca pelos dados do próprio provedor
//   search: (query) => Promise<Array<RawFlightOffer>>
// }
//
// query: { origin: string, destination: string, departureDate: string, returnDate?: string }
//
// origin e destination são TEXTOS CANÔNICOS de localização (ex.:
// "Curitiba, Paraná, Brasil"). O orquestrador (flights.service) garante a
// presença de origin — viagens sem origem não pesquisam — e provedores
// defensivos falham alto se ela faltar. A resolução em aeroportos/IATA reais
// continua pendente para o provedor real.
//
// Provedores reais (ex.: Amadeus, Kiwi) serão adicionados criando uma nova pasta
// em flight-providers/ e registrando uma entrada aqui, sem alterar services ou rotas.

import { simulatedFlightProvider } from './simulated/simulated-flight-provider.js';

const flightProviders = [simulatedFlightProvider];

export function getFlightProviders() {
  return flightProviders;
}
