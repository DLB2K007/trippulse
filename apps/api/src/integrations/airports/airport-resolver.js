// Resolver de localidades em aeroportos do TripPulse (Dia 11.8).
//
// INDEPENDENTE DE PROVEDOR: transforma o texto canônico de localização da
// viagem (ex.: "Curitiba, Paraná, Brasil") em identificador(es) aceitos por
// provedores reais (códigos IATA hoje; kgmid/erácigos de metrópole no futuro).
//
// FONTE DE DADOS: snapshot LOCAL do OurAirports (domínio público), gerado por
// build-airport-snapshot.mjs — veja proveniência/licença/procedimento no
// cabeçalho daquele script e em data/airports-snapshot.json (.meta). Em
// runtime NÃO há requisição de rede: apenas leitura do arquivo local.
//
// POLÍTICAS (Dia 11.7/11.8 aprovadas):
// - `ident` do OurAirports é a identidade canônica; o IATA é atributo e NÃO é
//   chave primária (pode se repetir entre aeroportos).
// - NUNCA se escolhe arbitrariamente o primeiro candidato: localidade com
//   múltiplos aeroportos comerciais é AMBÍGUA e volta como não resolvida,
//   SALVO se coberta pela TABELA CURADA (auditável, com ordem explícita).
// - Localidade desconhecida ou sem aeroporto comercial nunca inventa
//   correspondência: resultado explicitamente UNRESOLVED com motivo.
// - Cidades com múltiplos aeroportos e códigos de metrópole: o mecanismo
//   atual é a tabela curada (lista de IATAs na ordem escolhida). Códigos de
//   metrópole tipo IATA "Q*" (ex.: QSP) são suporte FUTURO, não implementado.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SNAPSHOT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data',
  'airports-snapshot.json'
);

// Nomes de países em português usados nos textos canônicos do TripPulse ->
// código ISO. Tabela curada: só o que usuários realisticamente digitam; nomes
// em inglês são resolvidos pelo mapa `countries` do próprio snapshot.
const PORTUGUESE_COUNTRY_ALIASES = {
  brasil: 'BR',
  portugal: 'PT',
  espanha: 'ES',
  'estados unidos': 'US',
  'estados unidos da america': 'US',
  argentina: 'AR',
  franca: 'FR',
  'reino unido': 'GB',
  inglaterra: 'GB',
  italia: 'IT',
  alemanha: 'DE',
  japao: 'JP',
  chile: 'CL',
  colombia: 'CO',
  mexico: 'MX',
  canada: 'CA',
  china: 'CN',
  uruguai: 'UY',
  paraguai: 'PY',
  bolivia: 'BO',
  peru: 'PE',
};

// TABELA CURADA de localidades ambíguas/multi-aeroporto. Cada entrada mapeia
// um nome normalizado de localidade (e, opcionalmente, um país) para a lista
// de IATAs NA ORDEM ESCOLHIDA (auditável por humanos, determinística). A
// entrada precede o casamento natural por município — é ela que garante que
// "São Paulo" não vire só GRU por sorte e que "Lisboa" encontre o município
// grafado em inglês ("Lisbon") no OurAirports.
const CURATED_ALIASES = [
  { aliases: ['sao paulo'], country: 'BR', codes: ['GRU', 'CGH', 'VCP'], note: 'municípios: São Paulo (GRU/CGH) e Campinas (VCP)' },
  { aliases: ['rio de janeiro'], country: 'BR', codes: ['GIG', 'SDU'], note: 'dois aeroportos no mesmo município' },
  { aliases: ['lisboa', 'lisbon'], country: 'PT', codes: ['LIS'], note: 'município grafado em inglês no OurAirports ("Lisbon")' },
  { aliases: ['buenos aires'], country: 'AR', codes: ['AEP', 'EZE'], note: 'EZE tem município "Buenos Aires (Ezeiza)" — casamento natural pegaria só AEP' },
  { aliases: ['londres', 'london'], country: 'GB', codes: ['LHR', 'LGW', 'STN', 'LTN', 'LCY'], note: 'multi-aeroporto clássico' },
  { aliases: ['paris'], country: 'FR', codes: ['CDG', 'ORY'], note: 'multi-aeroporto clássico' },
  { aliases: ['nova iorque', 'new york'], country: 'US', codes: ['JFK', 'LGA', 'EWR'], note: 'inclui EWR (Newark), operado para NYC' },
  { aliases: ['toquio', 'tokyo', 'tokio'], country: 'JP', codes: ['HND', 'NRT'], note: 'multi-aeroporto clássico' },
];

// Normalização de nomes/localidades: minúsculas, sem acentos (NFD), espaços
// colapsados. Determinística e sem dependências.
export function normalizeLocationText(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function loadSnapshot() {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
}

// `curatedAliases` é ponto de injeção para TESTES (snapshot sintético); em
// produção chame sem o parâmetro e a tabela auditável acima é usada.
export function createAirportResolver(snapshot, curatedAliases = CURATED_ALIASES) {
  // Índices imutáveis construídos uma vez.
  const byIata = new Map();
  for (const airport of snapshot.airports) {
    if (!byIata.has(airport.iata)) {
      byIata.set(airport.iata, []);
    }
    byIata.get(airport.iata).push(airport);
  }
  const countryNames = new Map();
  for (const [code, name] of Object.entries(snapshot.countries ?? {})) {
    countryNames.set(normalizeLocationText(name), code);
  }

  // Detecção do filtro de país no ÚLTIMO segmento do texto ("... , Brasil").
  // Português pela tabela curada; inglês pelos nomes do snapshot.
  function detectCountryFilter(text) {
    const segments = text.split(',').map((segment) => normalizeLocationText(segment));
    if (segments.length === 1) {
      return null;
    }

    const last = segments[segments.length - 1];
    return PORTUGUESE_COUNTRY_ALIASES[last] ?? countryNames.get(last) ?? null;
  }

  function matchesToResult(query, source, matches) {
    return {
      status: 'RESOLVED',
      source,
      query,
      matches: matches.map((airport) => ({
        iata: airport.iata,
        ident: airport.ident,
        name: airport.name,
        municipality: airport.muni,
        country: airport.country,
        region: airport.region,
        type: airport.type,
      })),
    };
  }

  function unresolved(query, reason, candidates = undefined) {
    const result = { status: 'UNRESOLVED', query, reason };
    if (candidates) {
      result.candidates = candidates.map((airport) => ({
        iata: airport.iata,
        ident: airport.ident,
        name: airport.name,
        municipality: airport.muni,
        country: airport.country,
        region: airport.region,
        type: airport.type,
      }));
    }
    return result;
  }

  // IATA explícito: token único de 3 letras (sem vírgula/espacos). Validado
  // contra o snapshot; duplicatas de IATA (possíveis na fonte) NUNCA são
  // resolvidas silenciosamente para o primeiro match.
  function tryExplicitIata(text) {
    if (!/^[A-Za-z]{3}$/.test(text.trim())) {
      return null;
    }

    const candidates = byIata.get(text.trim().toUpperCase()) ?? [];
    if (candidates.length === 1) {
      return matchesToResult(text, 'iata-explicit', candidates);
    }
    if (candidates.length > 1) {
      return unresolved(text, 'AMBIGUOUS_IATA', candidates);
    }
    // IATA de 3 letras não encontrado: pode ser nome curto de localidade —
    // o fluxo natural tenta antes de falhar.
    return null;
  }

  function tryCuratedAlias(namePart, countryCode) {
    const normalized = normalizeLocationText(namePart);

    for (const alias of curatedAliases) {
      const nameMatches = alias.aliases.includes(normalized);
      const countryMatches = !countryCode || !alias.country || alias.country === countryCode;

      if (!nameMatches || !countryMatches) {
        continue;
      }

      const matches = [];
      for (const code of alias.codes) {
        const airports = byIata.get(code);
        if (!airports || airports.length !== 1) {
          // Entrada curada inconsistente com o snapshot é bug de MANUTENÇÃO
          // da tabela (dado do repositório), não entrada de usuário: falha
          // alta em vez de filtrar em silêncio.
          throw new Error(
            `Tabela curada de aeroportos inconsistente: IATA '${code}' do alias '${normalized}' não corresponde a exatamente 1 aeroporto do snapshot. Regenerar/auditar o snapshot.`
          );
        }
        matches.push(airports[0]);
      }

      return matchesToResult(namePart, 'curated-alias', matches);
    }

    return null;
  }

  // Casamento natural: município EXATO (normalizado) + país, quando presente.
  // Zero inferência difusa — município com múltiplos aeroportos comerciais é
  // ambiguidade explícita, não "primeiro resultado".
  function tryMunicipality(namePart, countryCode) {
    const normalized = normalizeLocationText(namePart);
    if (!normalized) {
      return null;
    }

    const candidates = snapshot.airports.filter(
      (airport) =>
        normalizeLocationText(airport.muni) === normalized &&
        (!countryCode || airport.country === countryCode)
    );

    if (candidates.length === 0) {
      return null;
    }

    if (candidates.length > 1) {
      return unresolved(namePart, 'AMBIGUOUS_LOCATION', candidates);
    }

    return matchesToResult(namePart, 'municipality', candidates);
  }

  function resolveLocation(locationText) {
    if (typeof locationText !== 'string' || locationText.trim().length === 0) {
      throw new TypeError(
        'Resolver de aeroportos exige localidade como texto canônico não vazio.'
      );
    }

    const explicit = tryExplicitIata(locationText);
    if (explicit) {
      return explicit;
    }

    const countryCode = detectCountryFilter(locationText);
    const namePart = locationText.split(',')[0];

    const curated = tryCuratedAlias(namePart, countryCode);
    if (curated) {
      return curated;
    }

    const natural = tryMunicipality(namePart, countryCode);
    if (natural) {
      return natural;
    }

    return unresolved(locationText, 'UNKNOWN_LOCATION');
  }

  // Validação explícita de código IATA (uso futuro por formulários/adapters).
  // Diferente de resolveLocation: exige existência exata e não recorre a
  // nomes de localidades.
  function resolveIata(code) {
    if (typeof code !== 'string' || !/^[A-Za-z]{3}$/.test(code.trim())) {
      throw new TypeError('resolveIata exige um código IATA de exatamente 3 letras.');
    }

    const candidates = byIata.get(code.trim().toUpperCase()) ?? [];
    if (candidates.length === 1) {
      return matchesToResult(code, 'iata-explicit', candidates);
    }
    if (candidates.length > 1) {
      return unresolved(code, 'AMBIGUOUS_IATA', candidates);
    }
    return unresolved(code, 'UNKNOWN_IATA');
  }

  return { resolveLocation, resolveIata };
}

// Instância padrão: snapshot local (mesma instância para toda a aplicação).
// Carregada em lazy no primeiro uso para não penalizar processos que não
// pesquisam (ex.: bootstrap com scheduler OFF e provedor real ausente).
let defaultResolver = null;

export function getDefaultAirportResolver() {
  if (!defaultResolver) {
    defaultResolver = createAirportResolver(loadSnapshot());
  }
  return defaultResolver;
}
