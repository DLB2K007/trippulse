// Barreira fail-closed de provedores/ofertas reais.
//
// Enquanto a liberação REAL não for uma decisão explícita, qualquer coisa que
// não comprove `isSimulated === true` é tratada como bloqueada. Não usamos
// truthiness nem `!== false`: valores ausentes, strings, números, objetos e
// propriedades inexistentes também falham alto. A regra é compartilhada pelo
// orquestrador (antes do provider e após a normalização) e pela persistência.

import { HttpError } from './errors.js';

export const REAL_BARRIER_MESSAGE =
  'Provedores reais ainda não estão liberados: nenhuma oferta REAL é exposta ou persistida nesta etapa.';

export const INVALID_PROVIDER_MESSAGE =
  'Registro de provedores inválido: cada provider precisa ter name não vazio, search função e isSimulated booleano verdadeiro.';

export const NO_PROVIDER_MESSAGE =
  'Nenhum provedor de voos disponível: o registro está vazio.';

function assertProviderShape(provider) {
  if (provider === null || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new HttpError(503, INVALID_PROVIDER_MESSAGE);
  }

  if (
    typeof provider.name !== 'string' ||
    provider.name.trim().length === 0 ||
    typeof provider.search !== 'function'
  ) {
    throw new HttpError(503, INVALID_PROVIDER_MESSAGE);
  }

  if (provider.isSimulated !== true) {
    throw new HttpError(503, REAL_BARRIER_MESSAGE);
  }
}

/**
 * Bloqueia qualquer registro que não seja comprovadamente simulado.
 *
 * @param {Array<object>} providers
 * @throws {TypeError} quando `providers` não é array (erro de programação)
 * @throws {HttpError} 503 para qualquer provider que não tenha
 *   `isSimulated === true`
 */
export function assertOnlySimulatedProviders(providers) {
  if (!Array.isArray(providers)) {
    throw new TypeError('providers precisa ser um array.');
  }

  if (providers.length === 0) {
    throw new HttpError(503, NO_PROVIDER_MESSAGE);
  }

  for (const provider of providers) {
    assertProviderShape(provider);
  }
}

/**
 * Bloqueia ofertas cuja classificação ou flag não comprove SIMULATED.
 *
 * A classificação continua sendo derivada no normalizador a partir do
 * registro; esta checagem apenas impede que uma classificação ausente,
 * desconhecida ou inconsistente chegue à exposição/persistência.
 *
 * @param {Array<object>} offers
 * @throws {TypeError} quando `offers` não é array (erro de programação)
 * @throws {HttpError} 503 para qualquer oferta que não tenha
 *   `dataClassification === 'SIMULATED'` E `isSimulated === true`
 */
export function assertOnlySimulatedOffers(offers) {
  if (!Array.isArray(offers)) {
    throw new TypeError('offers precisa ser um array.');
  }

  for (const offer of offers) {
    if (
      offer === null ||
      typeof offer !== 'object' ||
      Array.isArray(offer) ||
      offer.dataClassification !== 'SIMULATED' ||
      offer.isSimulated !== true
    ) {
      throw new HttpError(503, REAL_BARRIER_MESSAGE);
    }
  }
}