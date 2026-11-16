// Adaptador EXPERIMENTAL do SerpApi (Google Flights) — Dia 11.8.
//
// STATUS: integração isolada, NÃO liberada em produção. Nenhuma oferta REAL
// que passe por aqui chega a usuários ou persistência nesta etapa: a barreira
// está em modules/flights/flights.service.js (HTTP 503 pós-normalização).
//
// DADOS: este módulo produz ofertas no formato BRUTO do SerpApi Google
// Flights (fonte externa). A classificação SIMULATED/REAL é atribuída pelo
// normalizador a partir do REGISTRO de provedores — nunca por este módulo.
//
// ESCOPO (docs oficiais do SerpApi Google Flights, 2026-11):
// - Ida simples (type=2): 1 requisição por ciclo.
// - Ida e volta (type=1): 2 requisições — a 1ª obtém opções de ida
//   (itinerários com `departure_token`); cada token selecionado dispara uma
//   2ª requisição que devolve as opções de retorno.
// - EXPANSÃO LIMITADA: `maxOutboundExpansions` (default 1, máx 10) controla
//   QUANTOS itinerários de ida são expandidos; fórmula:
//   `requisições por ciclo = 1 + tokens expandidos`. expandir apenas 1
//   itinerário NÃO cobre todas as combinações ida×volta — cobertura PARCIAL
//   por desenho (custo por requisição); documentado no README.
// - SELEÇÃO DETERMINÍSTICA: itinerários de ida são ordenados por
//   (preço, duração total, hora da partida, companhia/voo) e os N primeiros
//   são expandidos; a mesma consulta produz sempre as mesmas escolhas —
//   comparabilidade histórica preservada.
// - SEGUNDA REQUISIÇÃO (D3): Alternativa B — repete TODOS os parâmetros da
//   1ª pesquisa (engine, hl, gl, currency, travel_class, departure_id,
//   arrival_id, outbound_date, return_date) e acrescenta `type=1` explícito
//   + `departure_token`. É o padrão do exemplo oficial do SerpApi (preservar
//   os parâmetros e atualizar o token) e evita depender do default `type=1`.
//   `booking_token` nunca é enviado; `api_key` só entra em performRequest.
// - RESPOSTA VÁLIDA (D3): HTTP 200 não basta. `error` não vazio é falha do
//   provedor; `search_metadata.status` presente precisa ser `Success`
//   (case-insensitive) — `Processing`, `Queued`, `Error` e desconhecido
//   falham por segurança. `search_metadata` ausente é tolerado. Mercado
//   vazio só é aceito quando não há erro/status de falha.
// - MOEDA (D3): a moeda efetiva vem de `search_parameters.currency`
//   (normalizada para maiúsculas). Divergência de BRL falha alto — não há
//   conversão nem mistura de moedas no histórico. Ausente -> BRL porque a
//   requisição enviou `currency=BRL` explicitamente.
// - PREÇO DO ROUND-TRIP: PENDÊNCIA registrada — não assumimos que o preço
//   da resposta inicial representa o total combinado ida+volta; usamos o
//   preço do itinerário de retorno da 2ª resposta como preço do trip
//   completo. Semântica exata a confirmar com fixtures reais em etapa
//   futura (ver pendências no README).
// - `price_insights` é METADADO DE CONTEXTO do provedor: vai em
//   `relatedQuery.priceInsights` (não persistido) e NUNCA se mistura ao
//   `PriceHistory` do TripPulse (série por oferta, outra fonte/semântica).
// - LOCALIDADES: resolvidas ANTES da requisição pelo resolver local de
//   aeroportos (integrations/airports) — nunca texto livre. Vários
//   aeroportos (ex.: "São Paulo" -> GRU,CGH,VCP) vão como lista separada por
//   vírgula no parâmetro, formato aceito pelo Google Flights. O campo do
//   match pode ser `kgmid` (quando o resolver passar a fornecer) ou `iata`.
// - CREDENCIAL: a API key vive fechada nesta closure; NUNCA aparece em logs
//   ou mensagens de erro (sanitizeMessage remove qualquer ocorrência).
// - TOKEN: `departure_token` é usado somente para a 2ª requisição. Os objetos
//   brutos devolvidos por `search()` não o contêm (cópias sem a propriedade
//   são criadas depois da expansão; a resposta original nunca é mutada).

import { getDefaultAirportResolver } from '../../airports/airport-resolver.js';

const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_EXPANSION_LIMIT = 10;
const REQUESTED_CURRENCY = 'BRL';
const SUCCESS_STATUS = 'success';
// Vocabulário de falhas conhecido do SerpApi. Qualquer outro valor é tratado
// como desconhecido e NUNCA é ecoado na mensagem (conteúdo externo arbitrário).
const KNOWN_FAILURE_STATUSES = new Map([
  ['processing', 'Processing'],
  ['queued', 'Queued'],
  ['error', 'Error'],
]);

// Formas em que um valor sensível conhecido pode aparecer em texto externo.
// Inclui a forma literal, encodeURIComponent (espaço -> %20) e
// URLSearchParams (espaço -> +).
function secretForms(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    return [];
  }

  const forms = new Set([secret]);
  try {
    forms.add(encodeURIComponent(secret));
  } catch {
    // A forma literal continua sendo removida mesmo se a codificação falhar.
  }
  try {
    const encoded = new URLSearchParams({ value: secret }).toString();
    forms.add(encoded.slice('value='.length));
  } catch {
    // Idem acima.
  }

  return [...forms].filter((form) => form.length > 0);
}

// Defesa em profundidade: remove valores sensíveis conhecidos ANTES de aplicar
// os padrões de URL. O regex de prefixo é apenas fallback; não é a garantia
// principal, pois tokens podem conter `&`, espaços ou aparecer sem prefixo.
function sanitizeMessage(message, secrets = []) {
  let text = String(message);

  for (const secret of secrets) {
    for (const form of secretForms(secret)) {
      text = text.split(form).join('[REDACTED]');
    }
  }

  return text
    .replace(/api_key=[^&\s"']+/gi, 'api_key=[REDACTED]')
    .replace(/departure_token=[^&\s"']+/gi, 'departure_token=[REDACTED]')
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]');
}

// Valida uma resposta HTTP 200 do SerpApi ANTES de interpretá-la como mercado.
// Regras do D3:
// - `error` não vazio = falha do provedor (mesmo com HTTP 200). O texto externo
//   NÃO é propagado; a mensagem é controlada pela aplicação.
// - `search_metadata.status` presente e diferente de `Success` = falha
//   (`Processing`, `Queued`, `Error` e desconhecido -> fail-closed). Status
//   desconhecido não é ecoado.
// - `search_metadata` ausente é tolerado (a documentação não garante o campo).
function assertSuccessfulResponse(response, context, secrets = []) {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error(`SerpApi: resposta inválida em ${context} (não é um objeto).`);
  }

  const error = response.error;
  if (error !== undefined && error !== null && String(error).trim() !== '') {
    // Não incluir String(error): o conteúdo é externo e pode conter URL,
    // api_key, departure_token ou qualquer outro dado sensível.
    throw new Error(
      sanitizeMessage(`SerpApi: erro do provedor em ${context}.`, secrets)
    );
  }

  const metadata = response.search_metadata;
  const status = metadata !== null && typeof metadata === 'object' ? metadata.status : undefined;
  if (status !== undefined && status !== null) {
    const normalized = String(status).trim();
    if (normalized.toLowerCase() !== SUCCESS_STATUS) {
      const knownFailure = KNOWN_FAILURE_STATUSES.get(normalized.toLowerCase());
      const safeStatus = knownFailure ? `"${knownFailure}"` : 'desconhecido';
      throw new Error(
        sanitizeMessage(
          `SerpApi: status ${safeStatus} em ${context} (esperado "Success").`,
          secrets
        )
      );
    }
  }
}

// Moeda efetiva declarada pela resposta. Ausente -> fallback para a moeda
// explicitamente solicitada (`currency=BRL`) — nunca conversão implícita.
// Divergência de BRL é erro alto: melhor falhar do que rotular preço errado.
function resolveResponseCurrency(response, context) {
  const parameters = response.search_parameters;
  const reported =
    parameters !== null && typeof parameters === 'object' ? parameters.currency : undefined;

  if (reported === undefined || reported === null || String(reported).trim() === '') {
    return REQUESTED_CURRENCY;
  }

  const normalized = String(reported).trim().toUpperCase();
  if (normalized !== REQUESTED_CURRENCY) {
    // Não ecoar o valor externo: ele é conteúdo arbitrário do provedor. O
    // contexto e a moeda solicitada são suficientes para diagnóstico seguro.
    throw new Error(
      `SerpApi: moeda da resposta em ${context} difere da solicitada (${REQUESTED_CURRENCY}).`
    );
  }
  return normalized;
}

function requireIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`SerpApi: data de ${label} precisa estar no formato YYYY-MM-DD.`);
  }
  return value;
}

// Validação estrita de um itinerário bruto do SerpApi. Qualquer malformação
// é erro (anomalia de resposta), não filtragem silenciosa.
function assertValidItinerary(itinerary, context) {
  const isObject = itinerary !== null && typeof itinerary === 'object';
  const flights = isObject ? itinerary.flights : undefined;
  const hasFlights = Array.isArray(flights) && flights.length > 0;
  const hasPrice = isObject && typeof itinerary.price === 'number' && Number.isFinite(itinerary.price);

  if (!isObject || !hasFlights || !hasPrice) {
    throw new Error(
      `SerpApi: resposta inválida — itinerário malformado em ${context} (flights ausente ou preço não numérico).`
    );
  }
}

// Extrai e valida itinerários de uma resposta do Google Flights.
// Respostas iniciais SEM `best_flights`/`other_flights` (mercado vazio) são
// um caso VÁLIDO: devolvem [].
function extractItineraries(response, context) {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error(`SerpApi: resposta inválida em ${context} (não é um objeto).`);
  }

  const itineraries = [];
  for (const key of ['best_flights', 'other_flights']) {
    const items = response[key];
    if (items === undefined) {
      continue; // ausente = vazio (válido)
    }
    if (!Array.isArray(items)) {
      throw new Error(`SerpApi: resposta inválida em ${context} ('${key}' não é lista).`);
    }
    for (const item of items) {
      assertValidItinerary(item, context);
      itineraries.push(item);
    }
  }
  return itineraries;
}

// Ordenação DETERMINÍSTICA: preço, duração, hora de partida, companhia/voo.
// Array.sort é estável no Node moderno, então empates mantêm a ordem original
// da resposta — sem arbitrariedade escondida.
function sortItinerariesDeterministic(itineraries) {
  const firstFlight = (itinerary) => (itinerary.flights && itinerary.flights[0]) ?? {};
  const departureTime = (itinerary) => {
    const flight = firstFlight(itinerary);
    return (flight.departure_airport && flight.departure_airport.time) ?? '';
  };
  const carrier = (itinerary) => {
    const flight = firstFlight(itinerary);
    return `${flight.airline ?? ''}|${flight.flight_number ?? ''}`;
  };

  return [...itineraries].sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    if ((a.total_duration ?? Infinity) !== (b.total_duration ?? Infinity)) {
      return (a.total_duration ?? Infinity) - (b.total_duration ?? Infinity);
    }
    if (departureTime(a) !== departureTime(b)) {
      return departureTime(a).localeCompare(departureTime(b));
    }
    return carrier(a).localeCompare(carrier(b));
  });
}

export function createSerpApiFlightProvider({
  apiKey,
  fetchImpl = globalThis.fetch,
  maxOutboundExpansions = 1,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  airportResolver = getDefaultAirportResolver(),
} = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new TypeError('SerpApi: API key obrigatória para construir o provedor.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('SerpApi: fetch injetável precisa ser uma função.');
  }
  if (
    !Number.isInteger(maxOutboundExpansions) ||
    maxOutboundExpansions < 1 ||
    maxOutboundExpansions > MAX_EXPANSION_LIMIT
  ) {
    throw new TypeError(
      `SerpApi: maxOutboundExpansions precisa ser um inteiro entre 1 e ${MAX_EXPANSION_LIMIT}.`
    );
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('SerpApi: timeoutMs precisa ser um inteiro positivo (ms).');
  }
  if (airportResolver === null || typeof airportResolver.resolveLocation !== 'function') {
    throw new TypeError('SerpApi: airportResolver precisa expor resolveLocation.');
  }

  // Chave fechada na closure: nunca exposta em propriedades do provedor.
  const trimmedKey = apiKey.trim();

  // Requisição GET com timeout via AbortController. A URL (com a chave) nunca
  // é incluída em mensagens de erro — apenas códigos HTTP genéricos.
  async function performRequest(params, context) {
    const searchParams = new URLSearchParams({ ...params, api_key: trimmedKey });
    const secrets = [trimmedKey, params.departure_token].filter(
      (value) => typeof value === 'string' && value.length > 0
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response;
      try {
        response = await fetchImpl(`${SERPAPI_ENDPOINT}?${searchParams.toString()}`, {
          method: 'GET',
          signal: controller.signal,
        });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error(`SerpApi: timeout da requisição em ${context}.`);
        }
        // Nunca propagar error.message de rede: pode conter a URL completa,
        // a api_key ou o departure_token. A mensagem é controlada aqui.
        throw new Error(
          sanitizeMessage(`SerpApi: falha de rede em ${context}.`, secrets)
        );
      }

      if (!response.ok) {
        const safeStatus = Number.isInteger(response.status) ? response.status : 'desconhecido';
        throw new Error(`SerpApi: HTTP ${safeStatus} em ${context}.`);
      }

      let text;
      try {
        text = await response.text();
      } catch (error) {
        if (error && error.name === 'AbortError') {
          throw new Error(`SerpApi: timeout da requisição em ${context}.`);
        }
        throw new Error(
          sanitizeMessage(`SerpApi: falha de rede em ${context}.`, secrets)
        );
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`SerpApi: resposta não é JSON válido em ${context}.`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Localidade -> lista de códigos (kgmid quando disponível no futuro, senão
  // IATA), separada por vírgula no formato multi-aeroporto do Google Flights.
  function resolveLocationIds(text, label) {
    const result = airportResolver.resolveLocation(text);

    if (result.status !== 'RESOLVED') {
      throw new Error(
        `SerpApi: localidade de ${label} não resolvida (${result.reason}): "${text}".`
      );
    }

    return result.matches.map((match) => match.kgmid ?? match.iata).join(',');
  }

  function buildBaseParams({ departureId, arrivalId, outboundDate, returnDate, isRoundTrip }) {
    return {
      engine: 'google_flights',
      hl: 'pt-BR',
      gl: 'br',
      currency: REQUESTED_CURRENCY,
      travel_class: 1, // economia (default do produto; documentado no mapeador)
      type: isRoundTrip ? 1 : 2,
      departure_id: departureId,
      arrival_id: arrivalId,
      outbound_date: outboundDate,
      // `return_date` é obrigatório para type=1 (round-trip) na API do
      // Google Flights. Um one-way (type=2) não deve enviar essa chave.
      ...(isRoundTrip ? { return_date: returnDate } : {}),
    };
  }

  function rawFromItinerary(itinerary, { currency, type, price, extra = {} }) {
    return {
      type, // 'one way' | 'round trip' (semântica do Google Flights)
      currency,
      price,
      outbound: itinerary,
      ...extra,
    };
  }

  // O token só é necessário até a 2ª requisição. Copiamos o itinerário para
  // remover a propriedade sem mutar a resposta original recebida do SerpApi.
  // Não há limpeza recursiva: o token é um campo de topo do itinerário.
  function withoutDepartureToken(itinerary) {
    if (itinerary === null || typeof itinerary !== 'object' || Array.isArray(itinerary)) {
      return itinerary;
    }
    const { departure_token: _departureToken, ...rest } = itinerary;
    return rest;
  }

  async function search(query, options = {}) {
    // `options.variationSeed` (contrato do orquestrador) é IGNORADO: dados
    // reais não variam por semente — a oscilação real do mercado é a fonte.
    void options;

    if (query === null || typeof query !== 'object') {
      throw new TypeError('SerpApi: consulta precisa ser um objeto.');
    }
    if (typeof query.origin !== 'string' || query.origin.trim().length === 0) {
      throw new TypeError('SerpApi: consulta sem origin (texto canônico).');
    }
    if (typeof query.destination !== 'string' || query.destination.trim().length === 0) {
      throw new TypeError('SerpApi: consulta sem destination (texto canônico).');
    }

    const outboundDate = requireIsoDate(query.departureDate, 'partida');
    const isRoundTrip = query.returnDate != null;
    const returnDate = isRoundTrip ? requireIsoDate(query.returnDate, 'retorno') : null;

    const departureId = resolveLocationIds(query.origin, 'origem');
    const arrivalId = resolveLocationIds(query.destination, 'destino');
    const baseParams = buildBaseParams({
      departureId,
      arrivalId,
      outboundDate,
      returnDate,
      isRoundTrip,
    });

    // REQUISIÇÃO 1 (sempre): mercado de ida.
    const initial = await performRequest(baseParams, 'busca inicial');
    assertSuccessfulResponse(initial, 'busca inicial', [trimmedKey]);
    const currency = resolveResponseCurrency(initial, 'busca inicial');
    const outboundItineraries = extractItineraries(initial, 'busca inicial');
    const priceInsights = initial.price_insights ?? null;

    if (!isRoundTrip) {
      // Ida simples: NENHUMA expansão (1 requisição por ciclo).
      return outboundItineraries.map((itinerary) =>
        rawFromItinerary(withoutDepartureToken(itinerary), {
          currency,
          type: 'one way',
          price: itinerary.price,
          extra: priceInsights ? { price_insights: priceInsights } : {},
        })
      );
    }

    // ROUND-TRIP: apenas itinerários de ida COM departure_token são
    // candidatos a expansão. Resposta com itinerários mas SEM nenhum token é
    // ANOMALIA de resposta (erro alto), não mercado vazio.
    //
    // COMPORTAMENTO DOCUMENTADO (correção da auditoria D4) — descarte
    // silencioso intra-resposta: quando ALGUNS itinerários têm token e outros
    // não, os sem-token são descartados sem registro (não é possível
    // expandi-los; a anomalia só existe quando NENHUM tem token). Uma ida
    // mais barata sem token pode ficar fora do resultado — coerente com a
    // cobertura PARCIAL aprovada no Dia 11.7 (expandir N idas NÃO examina
    // todas as combinações ida×volta).
    const withToken = outboundItineraries.filter(
      (itinerary) => typeof itinerary.departure_token === 'string' && itinerary.departure_token.length > 0
    );
    if (outboundItineraries.length > 0 && withToken.length === 0) {
      throw new Error(
        'SerpApi: round-trip sem departure_token nos itinerários de ida (anomalia de resposta).'
      );
    }

    // DEDUP de departure_token (correção da auditoria D4): respostas podem
    // repetir o mesmo token (mesma ida listada duas vezes). Duplicatas gerariam
    // a MESMA 2ª requisição e ofertas idênticas de retorno — créditos queimados
    // sem resultado novo. Dedup determinístico: ordena antes, mantém a PRIMEIRA
    // ocorrência de cada token na ordem determinística e para em
    // maxOutboundExpansions (mesma regra de corte de antes).
    const sortedWithToken = sortItinerariesDeterministic(withToken);
    const seenTokens = new Set();
    const selected = [];
    for (const itinerary of sortedWithToken) {
      if (seenTokens.has(itinerary.departure_token)) {
        continue;
      }
      seenTokens.add(itinerary.departure_token);
      selected.push(itinerary);
      if (selected.length === maxOutboundExpansions) {
        break;
      }
    }

    // REQUISIÇÕES 2..N: uma por token selecionado.
    // fórmula: requisições por ciclo = 1 + tokens expandidos
    //
    // COMPORTAMENTO DOCUMENTADO (D4) — falha na 2ª requisição: HTTP não-ok,
    // rede, JSON inválido ou resposta sem itinerários ABORTA A BUSCA INTEIRA
    // (erro alto). Não há resultado parcial: nenhuma oferta de round-trip é
    // devolvida se qualquer expansão selecionada falhar.
    const rawOffers = [];
    for (const outbound of selected) {
      // Alternativa B (D3): a 2ª requisição preserva TODO o contexto da 1ª
      // pesquisa e só acrescenta o seletor de retorno. `type=1` é explícito
      // (não dependemos do default documentado). `api_key` continua sendo
      // anexada exclusivamente por performRequest.
      const secondParams = {
        ...baseParams,
        type: 1,
        departure_token: outbound.departure_token,
      };

      const second = await performRequest(secondParams, 'expansão de retorno');
      assertSuccessfulResponse(second, 'expansão de retorno', [
        trimmedKey,
        outbound.departure_token,
      ]);
      const secondCurrency = resolveResponseCurrency(second, 'expansão de retorno');
      const returnItineraries = extractItineraries(second, 'expansão de retorno');

      if (returnItineraries.length === 0) {
        throw new Error(
          'SerpApi: expansão de retorno sem itinerários para o token de ida (anomalia de resposta).'
        );
      }

      // Retorno escolhido: primeiro na ordem determinística (menor preço,
      // depois duração...). PENDÊNCIA DE SEMÂNTICA: o preço do itinerário de
      // retorno da 2ª resposta é usado como preço do trip completo — não
      // assumimos que representa o total combinado ida+volta.
      const chosenReturn = sortItinerariesDeterministic(returnItineraries)[0];

      // A expansão terminou: o token não deve permanecer nos objetos brutos
      // devolvidos ao serviço. A resposta original permanece intacta.
      const rawOutbound = withoutDepartureToken(outbound);
      const rawReturn = withoutDepartureToken(chosenReturn);

      rawOffers.push(
        rawFromItinerary(rawOutbound, {
          currency: secondCurrency,
          type: 'round trip',
          price: chosenReturn.price,
          extra: {
            return: rawReturn,
            ...(second.price_insights ? { price_insights: second.price_insights } : {}),
          },
        })
      );
    }

    return rawOffers;
  }

  return {
    name: 'serpapi',
    isSimulated: false,
    rawFormat: 'serpapi',
    search,
  };
}
