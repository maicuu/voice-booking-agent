/**
 * Exercita o caminho de escrita contra uma instancia real do AgendaFacil, e com
 * ele a politica da ADR 0005.
 *
 * ESTE SCRIPT TEM EFEITO COLATERAL IRREVERSIVEL: ele cria um evento de verdade
 * na agenda Google de um profissional. Nao roda sem `--confirmo`, e nao pertence
 * a suite de testes — um caso de teste que escreve numa agenda real e exatamente
 * o erro que este projeto existe para mostrar que se sabe evitar.
 *
 * Cria um unico evento e prova o resto por recusa:
 *
 *   1. agenda pela primeira vez               -> confirmado, e o horario some de /slots
 *   2. repete com a mesma chave                -> reaproveitado, sem segunda escrita
 *   3. repete com outro telefone (outra chave) -> recusado pela trava do servidor
 *
 * O passo 3 e o que importa: ele mostra que a revalidacao da API contra o Google
 * recusa a duplicata mesmo quando o registro local do agente nao a impede. E a
 * camada em que a ADR 0005 se apoia para tratar reenvio.
 *
 * Uso:
 *   AGENDA_API_BASE_URL=http://localhost:3000/api \
 *   AGENDA_TENANT=minha-barbearia \
 *   node scripts/verificar-escrita.ts --confirmo
 */

import { AgendaHttp } from "../src/agenda/http.ts";
import { agendarComIdempotencia } from "../src/agenda/idempotencia.ts";
import { RegistroEmArquivo } from "../src/agenda/registro.ts";
import { dataPorExtenso, horaPorExtenso, hoje, somarDias } from "../src/agenda/datas.ts";
import { formatarTelefone } from "../src/agenda/telefone.ts";
import type { PedidoAgendamento } from "../src/agenda/tipos.ts";

const baseUrl = process.env["AGENDA_API_BASE_URL"];
const slug = process.env["AGENDA_TENANT"];

if (!baseUrl || !slug) {
  console.error("Defina AGENDA_API_BASE_URL e AGENDA_TENANT.");
  process.exit(1);
}
if (!process.argv.includes("--confirmo")) {
  console.error(
    "Este script cria um evento real na agenda de um profissional.\n" +
      "Rode com --confirmo se e isso mesmo que voce quer.",
  );
  process.exit(1);
}

const cliente = new AgendaHttp({
  baseUrl,
  tokenDesafio: process.env["AGENDA_TOKEN_DESAFIO"] ?? "marcador",
  timeoutMs: 20_000,
  cacheConfigMs: 0,
});

// Fica em `local/`, que o .gitignore mantem fora do repositorio publico.
const registro = new RegistroEmArquivo(
  process.env["AGENDA_REGISTRO_INTENCOES"] ?? "local/intencoes-verificacao.jsonl",
);

let falhas = 0;
function verificar(descricao: string, condicao: boolean, detalhe = ""): void {
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${descricao}${detalhe ? ` — ${detalhe}` : ""}`);
  if (!condicao) falhas++;
}

const est = await cliente.estabelecimento(slug);
const profissional = est.profissionais.find((p) => p.agendaConectada);
const servico = est.servicos[0];
if (!profissional || !servico) {
  console.error("Precisa de um profissional com agenda conectada e um servico.");
  process.exit(1);
}

// Amanha, para folgar a antecedencia minima de 2h que o servidor exige.
const data = somarDias(hoje(), 1);
const antes = await cliente.disponibilidade({
  profissionalId: profissional.id,
  servicoId: servico.id,
  data,
});
if (antes.tipo !== "horarios" || antes.horarios.length === 0) {
  console.error(`Sem horario livre em ${data} para ${profissional.nome} (${antes.tipo}).`);
  process.exit(1);
}

// O ultimo horario do dia: menos provavel de atrapalhar um agendamento de
// verdade que alguem faca enquanto isto roda.
const hora = antes.horarios[antes.horarios.length - 1]!;

const pedido: PedidoAgendamento = {
  profissionalId: profissional.id,
  servicoId: servico.id,
  data,
  hora,
  nomeCliente: "Teste Recepcionista",
  telefoneCliente: "5511999998888",
};

console.log(`estabelecimento: ${est.nome}`);
console.log(`profissional:    ${profissional.nome}`);
console.log(`servico:         ${servico.nome} (${servico.duracaoMin} min)`);
console.log(`quando:          ${dataPorExtenso(data)}, ${horaPorExtenso(hora)} [${data} ${hora}]`);
console.log(`horarios livres antes: ${antes.horarios.length}\n`);

console.log("1. primeira escrita");
const primeira = await agendarComIdempotencia(cliente, registro, pedido);
verificar("a API confirmou", primeira.estado === "confirmado", primeira.estado);
verificar(
  "nao veio do registro, foi escrita de verdade",
  primeira.estado === "confirmado" && !primeira.reaproveitado,
);

const depois = await cliente.disponibilidade({
  profissionalId: profissional.id,
  servicoId: servico.id,
  data,
});
const livresDepois = depois.tipo === "horarios" ? depois.horarios : [];
verificar(
  "o horario sumiu de /slots, entao o evento existe no Google",
  !livresDepois.includes(hora),
  `${antes.horarios.length} -> ${livresDepois.length} horarios`,
);

console.log("\n2. reentrega com a mesma chave");
const segunda = await agendarComIdempotencia(cliente, registro, pedido);
verificar(
  "respondeu do registro em vez de chamar a API",
  segunda.estado === "confirmado" && segunda.reaproveitado,
  segunda.estado,
);
verificar("a chave e a mesma das duas vezes", primeira.chave === segunda.chave);

console.log("\n3. outro cliente tentando o mesmo horario");
// Chave diferente: o registro local nao barra. Quem barra e a revalidacao do
// servidor contra o Google — a camada em que a ADR 0005 se apoia.
const terceira = await agendarComIdempotencia(cliente, registro, {
  ...pedido,
  nomeCliente: "Outro Teste",
  telefoneCliente: "5511977776666",
});
verificar("o servidor recusou", terceira.estado === "recusado", terceira.estado);
verificar(
  "e recusou por horario ocupado, nao por outro motivo",
  terceira.estado === "recusado" && terceira.codigo === "slot_ocupado",
  terceira.estado === "recusado" ? terceira.codigo : "",
);

const conferencia = await cliente.disponibilidade({
  profissionalId: profissional.id,
  servicoId: servico.id,
  data,
});
verificar(
  "nenhuma escrita extra aconteceu",
  conferencia.tipo === "horarios" && conferencia.horarios.length === livresDepois.length,
);

console.log(
  `\n${falhas === 0 ? "Tudo verificado." : `${falhas} verificacao(oes) falharam.`}\n\n` +
    `APAGAR DEPOIS: 1 evento criado na agenda de ${profissional.nome}, ` +
    `em ${data} as ${hora}, no nome de "${pedido.nomeCliente}" ` +
    `(${formatarTelefone(pedido.telefoneCliente)}).`,
);

process.exit(falhas === 0 ? 0 : 1);
