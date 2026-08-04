/**
 * Mede a latencia da camada de ferramentas contra uma instancia do AgendaFacil.
 *
 * A ADR 0003 assume um custo e declara o limite em que ele deixa de valer: se o
 * leque de consultas passar de ~400 ms no p95, consultar por profissional e por
 * dia nao se sustenta e a API precisa de uma rota agregada. Este script existe
 * para que esse limite seja verificado, e nao estimado.
 *
 * O numero que importa e o do leque, nao o da chamada isolada: o cliente que
 * pergunta "tem horario quinta de tarde?" nao escolheu profissional, e o agente
 * consulta todos.
 *
 * Uso:
 *   AGENDA_API_BASE_URL=http://localhost:3000/api \
 *   AGENDA_TENANT=barbeariakoala \
 *   node scripts/medir-ferramentas.ts [amostras]
 *
 * So leitura: nao escreve na agenda de ninguem.
 */

import { AgendaHttp } from "../src/agenda/http.ts";
import { hoje, somarDias } from "../src/agenda/datas.ts";

const baseUrl = process.env["AGENDA_API_BASE_URL"];
const slug = process.env["AGENDA_TENANT"];
const amostras = Number(process.argv[2] ?? 12);

if (!baseUrl || !slug) {
  console.error("Defina AGENDA_API_BASE_URL e AGENDA_TENANT.");
  process.exit(1);
}

const cliente = new AgendaHttp({
  baseUrl,
  tokenDesafio: process.env["AGENDA_TOKEN_DESAFIO"] ?? "marcador",
  timeoutMs: 20_000,
  cacheConfigMs: 0,
});

async function cronometrar<T>(tarefa: () => Promise<T>): Promise<number> {
  const inicio = performance.now();
  await tarefa();
  return performance.now() - inicio;
}

function percentil(valores: number[], p: number): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  // Menor valor cujo posto cobre p. Com poucas amostras, o p95 tende ao maximo —
  // que e a leitura honesta: nao ha amostra suficiente para afirmar mais que isso.
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, indice)] ?? 0;
}

function relatar(rotulo: string, valores: number[]): void {
  if (valores.length === 0) return;
  const ms = (n: number) => `${n.toFixed(0)} ms`;
  console.log(
    `${rotulo.padEnd(34)} n=${String(valores.length).padStart(3)}  ` +
      `p50 ${ms(percentil(valores, 50)).padStart(8)}  ` +
      `p95 ${ms(percentil(valores, 95)).padStart(8)}  ` +
      `max ${ms(Math.max(...valores)).padStart(8)}`,
  );
}

const est = await cliente.estabelecimento(slug);
const conectados = est.profissionais.filter((p) => p.agendaConectada);
const servico = est.servicos[0];

if (conectados.length === 0 || !servico) {
  console.error("Precisa de ao menos um profissional com agenda conectada e um servico.");
  process.exit(1);
}

// Amanha: evita o caso degenerado de o dia de hoje ja ter passado do expediente,
// em que a API responde rapido por nao ter o que calcular.
const data = somarDias(hoje(), 1);

console.log(`estabelecimento: ${est.nome} (${slug})`);
console.log(`profissionais com agenda conectada: ${conectados.length}`);
console.log(`servico: ${servico.nome} (${servico.duracaoMin} min)`);
console.log(`data consultada: ${data}`);
console.log(`amostras: ${amostras}\n`);

const config: number[] = [];
for (let i = 0; i < amostras; i++) {
  config.push(await cronometrar(() => cliente.estabelecimento(slug)));
}
relatar("config (sem cache)", config);

const umProfissional: number[] = [];
const primeiro = conectados[0]!;
for (let i = 0; i < amostras; i++) {
  umProfissional.push(
    await cronometrar(() =>
      cliente.disponibilidade({ profissionalId: primeiro.id, servicoId: servico.id, data }),
    ),
  );
}
relatar("slots, 1 profissional", umProfissional);

// O caso real: o cliente nao escolheu profissional, entao o agente consulta
// todos. As chamadas saem em paralelo — em serie, a soma seria inaceitavel.
const leque: number[] = [];
for (let i = 0; i < amostras; i++) {
  leque.push(
    await cronometrar(() =>
      Promise.all(
        conectados.map((p) =>
          cliente.disponibilidade({ profissionalId: p.id, servicoId: servico.id, data }),
        ),
      ),
    ),
  );
}
relatar(`leque, ${conectados.length} em paralelo`, leque);

console.log(
  `\nLimite declarado na ADR 0003: p95 do leque acima de ~400 ms invalida a ` +
    `consulta por profissional.\nMedido: p95 = ${percentil(leque, 95).toFixed(0)} ms — ` +
    `${percentil(leque, 95) > 400 ? "ACIMA do limite" : "dentro do limite"}.`,
);
