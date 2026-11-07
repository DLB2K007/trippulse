// Erro carregando um status HTTP, reconhecido pelo serializador padrão do Fastify.
// Usado pelos services para sinalizar falhas de domínio (ex.: recurso inexistente).
export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
