// Parser CSV mínimo (RFC 4180) para os dumps do OurAirports.
//
// O CSV do OurAirports cita campos e contém vírgulas DENTRO de valores
// (ex.: keywords "UAE,مطارات ...", nomes de aeroportos com vírgula). Um
// split(',') ingênuo desalinha colunas e silencia dados. Este parser lida
// com aspas duplas, vírgulas e novas linhas dentro de campos citados, sem
// dependências externas.
//
// ENDURECIMENTO (correção da auditoria D2): antes, aspas malformadas
// (campo não citado contendo '"' ou citação nunca fechada) faziam o parser
// engolir o RESTO DO ARQUIVO dentro de um único campo, sem erro — e linhas
// com número de colunas divergente do cabeçalho eram truncadas em silêncio.
// Agora ambos os casos falham ALTO, com o número da linha no arquivo:
// - aspa só é válida ABERTO no início de um campo (RFC 4180 §2.5/§2.6);
// - após fechar uma citação, só vírgula/fim de linha/fim de arquivo;
// - todo registro deve ter EXATAMENTE a mesma contagem de colunas do
//   cabeçalho (linhas curtas/longas são erro, não truncamento).
// Campos válidos continuam preservados: vírgulas citadas, aspas escapadas
// ("") e quebras de linha dentro de campo citado (multilinha).
//
// Desempenho é irrelevante aqui: roda apenas no script de geração do snapshot.

export function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new TypeError('CSV: entrada precisa ser texto.');
  }

  // Registros brutos: { fields: [...], line } — line = linha do arquivo onde
  // o registro COMEÇA (1-based), para mensagens de erro acionáveis.
  const records = [];
  let fields = [];
  let field = '';
  let inQuotes = false;      // dentro de campo citado
  let quoteOpenedAtLine = 0; // para a mensagem de citação não fechada
  let fieldStarted = false;  // algum caractere já consumido neste campo
  let fieldQuoted = false;   // campo foi ABERTO com citação (para detectar
                             // conteúdo após o fechamento, ex.: `"abc"x`)
  let line = 1;
  let rowStartLine = 1;

  const pushField = () => {
    fields.push(field);
    field = '';
    fieldStarted = false;
    fieldQuoted = false;
  };
  const pushRow = () => {
    pushField();
    records.push({ fields, line: rowStartLine });
    fields = [];
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // aspas escapadas ("") = literal
          i += 1;
        } else {
          inQuotes = false; // fecha a citação
        }
        continue;
      }
      if (char === '\n' || char === '\r') {
        field += char; // quebra de linha DENTRO do campo citado é dado
        if (char === '\r' && text[i + 1] === '\n') {
          field += '\n';
          i += 1;
        }
        line += 1;
        continue;
      }
      field += char;
      continue;
    }

    if (char === '"') {
      if (fieldStarted) {
        // Aspa FORA do início de campo não citado (ex.: `ab"cd`) ou após o
        // fechamento da citação (ex.: `"abc"x`): malformação explícita.
        throw new Error(
          `CSV: aspa em posição inválida na linha ${line} (aspas só podem abrir um campo ou escapar outra aspa).`
        );
      }
      inQuotes = true;
      fieldQuoted = true;
      quoteOpenedAtLine = line;
      fieldStarted = true;
      continue;
    }

    if (char === ',') {
      pushField();
      continue;
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      line += 1;
      // Fim de linha: só fecha o registro se algo foi iniciado (linhas em
      // branco entre registros são ignoradas, incluindo CRLF finais).
      if (fieldStarted || field !== '' || fields.length > 0) {
        pushRow();
      } else {
        // Linha em branco: o próximo registro começa na linha seguinte.
        // Sem isto, um cabeçalho após linhas vazias iniciais continuaria
        // reportado como linha 1.
        rowStartLine = line;
      }
      continue;
    }

    // Depois do fechamento da citação, só separador ou fim de linha (RFC
    // 4180 §2.5): qualquer outro caractere é malformação (ex.: `"abc"x`).
    if (fieldQuoted) {
      throw new Error(
        `CSV: conteúdo após o fechamento da citação na linha ${line} (campo citado precisa terminar antes do separador).`
      );
    }

    field += char;
    fieldStarted = true;
  }

  if (inQuotes) {
    throw new Error(
      `CSV: citação aberta na linha ${quoteOpenedAtLine} nunca foi fechada (arquivo malformado).`
    );
  }

  if (field !== '' || fields.length > 0) {
    pushRow();
  }

  if (records.length === 0) {
    return { header: [], rows: [] };
  }

  const header = records[0].fields.map((column) => column.trim());
  const headerLine = records[0].line;

  for (const record of records.slice(1)) {
    if (record.fields.length !== header.length) {
      throw new Error(
        `CSV: registro na linha ${record.line} tem ${record.fields.length} colunas; o cabeçalho tem ${header.length} (linha do cabeçalho: ${headerLine}).`
      );
    }
  }

  const rows = records.slice(1).map(({ fields: columns }) => {
    const object = {};
    header.forEach((column, index) => {
      object[column] = columns[index];
    });
    return object;
  });

  return { header, rows };
}
