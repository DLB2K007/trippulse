# RELATÓRIO DE CONTINUIDADE — TriPulse (gerado em 09/11/2026)

> **[ARQUIVADO em 10/11/2026]** Este handoff descreve o estado PRÉ-commit do Dia 11.4 (159/159 testes, working tree) —
> estado **superseded** pelo commit `83eb1ec` (Dia 11.4 publicado) e pelo Dia 11.5.
> Registro atual das execução oficial: `docs/relatorio-continuidade.md`.
> Conteúdo original preservado sem alteração abaixo.

> Documento de handoff de contexto: resume TODO o estado do Day 11.4 (Fases A e B
> no working tree, não commitado) para retomar o trabalho em uma sessão nova.
> O registro oficial dos Dias continua em `relatorio-continuidade.md` (a ser
> atualizado na Fase C do 11.4, com hashes).

## 1. Visão do projeto
- Monorepo `trippulse` (raiz: `C:\Users\danie\OneDrive\Imagens\Documentos\trippulse`, Windows, Git repo).
- Stack: Node ESM (`"type": "module"`, Node >=20.6; local v24.14), Fastify 5, Prisma 7 + adapter-pg, Postgres via docker compose.
- Backend em `apps/api/src/`: Fastify em `app.js` (`buildApp()`: mapa de rotas + `/health`, **intocado e protegido**).
- Rotas: `/trips` (trips, flights, offers, analysis, opportunities) e `/monitoring` (Days 10/11).
- Testes em `tests/` na raiz, `node:test` + `node:assert/strict`.
- Scripts npm: `start` = `node --env-file=.env apps/api/src/server.js`; `dev` (com `--watch`); `test` = `node --env-file=.env --test --test-force-exit --test-concurrency=1`.
- `.env` da raiz usado pelo npm; NÃO contém `MONITORING_SCHEDULER_*` (determinismo dos testes depende disso).
- Documentos-fonte: `docs/contexto.md` e `docs/relatorio-continuidade.md`.
- Processo de trabalho em etapas "Dias", com plano→execução→explicação→testes e **autorização explícita do usuário por fase**, sem commit/push sem autorização.
- Autoria Git fixa: `DLB2K007 <danielbordini027@gmail.com>` (commits `784f0ca`/`c3eb0c3` com autor "Daniel <daniel@local>" ficam intocados sem rebase+force push autorizado).

## 2. Estado Git ATUAL (crítico)
- Último commit publicado: `46acf4a feat(monitoring): persist monitoring runs` (Day 11.3, 7 arquivos, CI run #7 success).
- **Working tree contém o Dia 11.4 INTEIRO (Fases A+B) NÃO commitado**:
  - `M apps/api/src/config/env.js`
  - `M apps/api/src/server.js`
  - `?? apps/api/src/modules/monitoring/scheduler.js`
  - `?? tests/env.test.js`
  - `?? tests/monitoring-scheduler.test.js`
  - `?? tests/server-bootstrap.test.js`
- Suíte completa: **159/159 testes** verdes em 3 rodadas de estabilidade (`exit=0`); `git diff --check` limpo.
- Smoke test de produção: `npm start` real + `/health` → 200, zero logs de scheduler (OFF correto).
- Pendência explícita: revisão das Fases A e B pelo usuário → só então Fase C + eventual commit/push autorizados.

## 3. Onde estamos: Day 11.4 — Agendador Automático de Monitoramento
Dias anteriores fechados: 11.1 (`908a851` núcleo puro de monitoramento), 11.2 (`34e9135`), 11.3 (`46acf4a` persistência com árbitro do banco, P2002 → 409).
O 11.4 tem 3 fases:
- **Fase A (concluída, não commitada)** — config + factory do agendador.
- **Fase B (concluída, não commitada, AGUARDANDO REVISÃO)** — wiring ao bootstrap + shutdown gracioso.
- **Fase C (pendente, NÃO autorizada ainda)** — README (seção /monitoring), `.env.example`, `docs/relatorio-continuidade.md` (registrar Dias 11.1–11.4 com hashes; pendência cosmética antiga: marcar 11.3 com hash `46acf4a` no lugar de "(pendente)"), e o commit/push do 11.4 autorizado pelo usuário após revisão.

## 4. Fase A — o que existe (específico)

### Decisões aprovadas
- **D1**: 1º ciclo só APÓS intervalo completo (nada imediato no boot).
- **D2**: intervalo *presente e inválido* com scheduler ativo → fail-fast (TypeError em `loadEnv()`); intervalo **AUSENTE** → default 900000 (bug corrigido; "ausente ≠ inválido"). Scheduler OFF → invalidade ignorada.
- **D3**: persistir runs mesmo sem viagens monitoráveis (zeros; COMPLETED).
- **D4**: boolean estrito — só `true`/`1` (trim+case) ativam; `false/0/off/no/''` OFF silencioso; valores desconhecidos (`yes`, `sim`, `enabled`…) → OFF + `console.warn`.
- Faixa de intervalo: 60000–86400000 ms; default 900000.

### Arquivos
- `apps/api/src/config/env.js` (mod.): `loadEnv()` retorna `monitoringScheduler: { enabled, intervalMs }` além de `{ host, port }`; parsing em `loadMonitoringSchedulerEnv()`; warn via `console.warn` para ENABLED desconhecido (nunca para off explícito).
- `apps/api/src/modules/monitoring/scheduler.js` (novo): factory `createMonitoringScheduler({ intervalMs, run = defaultScheduledRun, timers, log = console })` → `{ start, stop, isRunning, idle, ticks }`; `defaultScheduledRun()` exportada = `startMonitoringRun({ trigger: MONITORING_RUN_TRIGGER.SCHEDULED })`. Núcleo: **after-complete loop** (tick → `await run()` → reagendar no `finally`; nunca `setInterval`); um único timer por instância; `start()/stop()` idempotentes com warn em re-start; 409 (`HttpError && statusCode === 409`) → log `.info` de skip (nunca `.error`); outros erros → `.error` + reagendamento garantido no finally; `stop()` em ciclo em voo NÃO aborta o run, só corta a cadeia; barreira defensiva de intervalo/`run` na factory (TypeError); scheduler NÃO conhece prisma.
- `tests/env.test.js` (novo, 10 testes): helper `withEnv(overrides, fn)` (salva/restaura `MONITORING_SCHEDULER_ENABLED`/`_INTERVAL_MS`) e `captureWarn()`.
- `tests/monitoring-scheduler.test.js` (novo, 15 testes): helpers `createFakeTimers()` (handles falsos; `fire()` retira da lista ANTES de executar — espelha setTimeout real), `deferredRun()` (run em promessa adiada; destruturar `calls` — a função `run` NÃO tem `.calls`), `flush()` via setImmediate. Único teste com banco real: `defaultScheduledRun` persiste `trigger='SCHEDULED'`, `status='COMPLETED'`, e limpa a linha via `prisma.monitoringRun.deleteMany`.

## 5. Fase B — o que existe (específico)

### `apps/api/src/server.js` (reescrito; comportamento de produção preservado — smoke test `npm start` + `/health` 200 OK)
- Exporta `startServer({ env = loadEnv(), createApplication = buildApp, createScheduler = createMonitoringScheduler, signals = process, terminate = (code) => process.exit(code) } = {})` — tudo injetável, testes determinísticos.
- Fluxo: `buildApp()` → `await app.listen()` → SOMENTE após sucesso: se `env.monitoringScheduler.enabled`, `scheduler = createScheduler({ intervalMs, log: app.log })` e `scheduler.start()` → registra `signals.on('SIGTERM'/'SIGINT')` **uma única vez** (só depois do listen).
- listen falha: log no `app.log`, `terminate(1)`, retorna `null` — scheduler NUNCA chega a ser criado (factory não invocada) nem handlers registrados.
- `gracefulShutdown(signal)`: idempotente via variável `shutdownInFlight` (sinais repetidos/simultâneos retornam a MESMA promessa); sequência: log "sinal X recebido…" → `scheduler.stop()` (cancela timer pendente) → `await scheduler.idle()` (ciclo em voo termina ANTES do close) → `await app.close()` (try/catch: erro → log `.error` + `terminate(1)`) → log "shutdown concluído" → `terminate(0)`. Nunca rejeita; retorna boolean.
- Bloco automático: `const isMainModule = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href; if (isMainModule) { startServer().catch(...) }` — NÃO roda no import (testes seguros).
- Logging todo via `app.log` (pino). Sem dependências novas, sem migration.

### `scheduler.js` — adições da Fase B (aditivas, justificadas)
- `idle()`: resolve quando não há ciclo em voo; caso contrário, resolve quando o tick corrente TERMINA (base do shutdown gracioso). Implementação: `inFlight` + `running.catch(() => {})` + `finally(() => { inFlight = null; })` dentro do `scheduleNext`.
- Log "execução agendada iniciada" no início de cada tick (pedido explícito da spec de logging; total 2 linhas de sucesso por ciclo: iniciada + concluída).

### `tests/server-bootstrap.test.js` (novo, 10 testes)
- Deps 100% injetadas: `createFakeStack()` (app falso + scheduler falso + `operations` trilha compartilhada p/ ordem exata `listen→start#1→stop#1→idle→close`, `logRecords`, `exitCodes`, `counts`), sinais via `EventEmitter`, terminate espiado, `ENV_OFF`/`ENV_ON` (port 0).
- Cobertura: OFF→factory nunca invocada; ON→start após listen com `log === app.log`; listen falha→exit1/null/0 handlers/factory não invocada; SIGTERM+SIGINT (laço, mesmo fluxo); idempotência (sinais dobrados + chamadas diretas → 1 sequência); ciclo em voo com `idleStalls` (close aguarda release); close falhando→exit1 sem throw; bootstrap REAL com `buildApp()` porta 0 + scheduler falso (handlers 1×); wiring com factory REAL + relógio falso: timer pendente cancelado (`pending.length===0`, `calls.length===0` — D1) e ciclo em voo conclui no shutdown sem novos ciclos depois (`ticks()===1`, `pending` vazio).
- **NÃO importar** `tests/monitoring-scheduler.test.js` dentro do arquivo de bootstrap (registraria os testes de novo) — helpers duplicados localmente de propósito.

## 6. Convenções e pegadinhas (IMPORTANTES)
- `node:test` desta versão NÃO tem `test.each` → usar laços.
- Suítes rodam sequenciais (`--test-concurrency=1`) com `--test-force-exit`.
- P2002 → 409 apenas com nome exato do índice, via Prisma 7: `error.meta.driverAdapterError.cause.constraint.index` (regra no service; núcleo puro intocado).
- Regra de ouro: lógica de negócio no service; scheduler só decide QUANDO; testes nunca dependem de tempo real (timers falsos/injetáveis).
- Estabilidade exigida em fases de teste: 3 rodadas completas da suíte + `git diff --check`.
- Arquivos intocados/protegidos: `app.js`/`buildApp()`, módulos Day 9/10, `monitoring.service.js`, `monitoring-core.js`.
- Testes HTTP existentes usam `buildApp()` + `app.inject()` diretamente e NUNCA ativam o scheduler (única via de ativação = `startServer` em produção com env ON).

## 7. Próximos passos (nesta ordem)
1. **Usuário revisa Fase A+B** (pedido em vigor: aguardar revisão).
2. **Fase C** (requer autorização): README (seção do scheduler), `.env.example` (`MONITORING_SCHEDULER_ENABLED`/`MONITORING_SCHEDULER_INTERVAL_MS`), `docs/relatorio-continuidade.md` (registrar 11.1–11.4 com hashes; pendência: marcar 11.3=`46acf4a`), commit (autor fixo `DLB2K007 <danielbordini027@gmail.com>`) e push com CI verde.
3. Depois: passar ao próximo Dia conforme `docs/contexto.md`.

## 8. Como retomar
Em sessão nova, referencie este arquivo (`docs/continuidade-2026-11-09-dia-11.4.md`) e peça: "Prosseguir no estado descrito; aguardar minha autorização por fase; nada de commit/push sem deferência; iniciar pela Fase C (ou pela revisão da Fase B)".
