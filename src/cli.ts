import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AgendaHttp } from "./agenda/http.ts";
import { RegistroEmArquivo } from "./agenda/registro.ts";
import { ModeloClaude, MODELO_PADRAO } from "./conversa/claude.ts";
import { Conversa } from "./conversa/orquestrador.ts";

/**
 * A conversa digitada — o entregavel da Fase 1 (`plano.md` §7).
 *
 * Sem audio nenhum, de proposito: se a logica nao estiver certa em texto, audio
 * so vai esconder o problema. O que roda aqui e exatamente o que a Fase 2 vai
 * plugar num transporte de voz; nada abaixo do `Conversa` muda.
 *
 * Uso (o Node le o .env sozinho, sem dependencia):
 *   node --env-file=.env src/cli.ts
 */

const baseUrl = process.env["AGENDA_API_BASE_URL"];
const slug = process.env["AGENDA_TENANT"];

if (!baseUrl || !slug) {
  console.error(
    "Defina AGENDA_API_BASE_URL e AGENDA_TENANT (veja .env.example).\n" +
      "Em desenvolvimento, aponte para a instancia local do AgendaFacil.",
  );
  process.exit(1);
}

const cliente = new AgendaHttp({
  baseUrl,
  tokenDesafio: process.env["AGENDA_TOKEN_DESAFIO"] ?? "marcador",
  timeoutMs: 20_000,
});

// Falhar aqui, e nao no meio da conversa: descobrir que a barbearia nao existe
// depois de o cliente ja ter falado seria a pior hora possivel.
const estabelecimento = await cliente.estabelecimento(slug).catch((erro: unknown) => {
  console.error(`Nao consegui falar com a agenda: ${erro instanceof Error ? erro.message : erro}`);
  console.error(`Base: ${baseUrl} — o AgendaFacil local esta no ar?`);
  process.exit(1);
});

const conversa = new Conversa({
  modelo: new ModeloClaude({ modelo: process.env["LLM_MODEL"] ?? MODELO_PADRAO }),
  cliente,
  registro: new RegistroEmArquivo(
    process.env["AGENDA_REGISTRO_INTENCOES"] ?? "local/intencoes.jsonl",
  ),
  slug,
  nomeDaBarbearia: estabelecimento.nome,
});

console.log(`${estabelecimento.nome} — conversa por texto. Ctrl+C para sair.\n`);

const terminal = createInterface({ input: stdin, output: stdout });
const total = { entrada: 0, saida: 0, turnos: 0 };

terminal.on("close", () => {
  if (total.turnos > 0) {
    // Contagem real devolvida pelo provedor, nao estimativa. E a materia-prima
    // do custo por conversa que a ADR 0006 deixou como [PREENCHER].
    console.log(
      `\n${total.turnos} turnos — ${total.entrada} tokens de entrada, ` +
        `${total.saida} de saida.`,
    );
  }
  process.exit(0);
});

for (;;) {
  const texto = (await terminal.question("voce: ")).trim();
  if (texto.length === 0) continue;
  if (texto === "/sair") break;

  const inicio = performance.now();
  const turno = await conversa.falar(texto);
  const ms = Math.round(performance.now() - inicio);

  total.entrada += turno.uso.entrada;
  total.saida += turno.uso.saida;
  total.turnos += 1;

  console.log(`agente: ${turno.resposta}`);

  const ferramentas = turno.chamadas.map((c) => c.nome).join(", ");
  console.log(
    `        [${ms} ms, ${turno.uso.entrada}+${turno.uso.saida} tokens` +
      `${ferramentas ? `, ferramentas: ${ferramentas}` : ""}` +
      `${turno.degradado ? ", DEGRADADO" : ""}]\n`,
  );
}

terminal.close();
