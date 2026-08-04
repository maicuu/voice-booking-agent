import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { AgendaEmMemoria, estabelecimentoDeTeste } from "../src/agenda/memoria.ts";
import { agendarComIdempotencia, chaveDeIdempotencia } from "../src/agenda/idempotencia.ts";
import { RegistroEmMemoria } from "../src/agenda/registro.ts";
import type { PedidoAgendamento } from "../src/agenda/tipos.ts";

/**
 * Os casos da ADR 0005. O que estes testes verificam nao e o texto que o agente
 * produz, e sim quantos eventos existem na agenda no fim — que e a unica coisa
 * que o cliente sente.
 */

// Terca-feira, meio-dia na barbearia. O horario pedido fica 3h a frente, o que
// passa da antecedencia minima de 2h que o servidor exige.
const AGORA = new Date("2026-08-04T12:00:00-03:00").getTime();

const PEDIDO: PedidoAgendamento = {
  profissionalId: "prof_1",
  servicoId: "serv_1",
  data: "2026-08-04",
  hora: "15:00",
  nomeCliente: "Joao",
  telefoneCliente: "5511999998888",
};

function montar() {
  const agenda = new AgendaEmMemoria(estabelecimentoDeTeste(), () => AGORA);
  return { agenda, registro: new RegistroEmMemoria() };
}

describe("chave de idempotencia", () => {
  it("ignora o profissional, para que duas tentativas com profissionais diferentes colidam", () => {
    const chaveA = chaveDeIdempotencia(PEDIDO);
    const chaveB = chaveDeIdempotencia({ ...PEDIDO, profissionalId: "prof_2" });
    strictEqual(chaveA, chaveB);
  });

  it("distingue horario, data e servico", () => {
    const base = chaveDeIdempotencia(PEDIDO);
    notStrictEqual(base, chaveDeIdempotencia({ ...PEDIDO, hora: "16:00" }));
    notStrictEqual(base, chaveDeIdempotencia({ ...PEDIDO, data: "2026-08-05" }));
    notStrictEqual(base, chaveDeIdempotencia({ ...PEDIDO, servicoId: "serv_2" }));
  });

  it("nao depende do nome informado, que muda de transcricao para transcricao", () => {
    strictEqual(chaveDeIdempotencia(PEDIDO), chaveDeIdempotencia({ ...PEDIDO, nomeCliente: "Joao Victor" }));
  });
});

describe("caminho feliz", () => {
  it("confirma e cria exatamente um evento", async () => {
    const { agenda, registro } = montar();
    const resultado = await agendarComIdempotencia(agenda, registro, PEDIDO);

    strictEqual(resultado.estado, "confirmado");
    strictEqual(agenda.agendados.length, 1);
  });

  it("nao reescreve quando a mesma chave ja esta confirmada", async () => {
    const { agenda, registro } = montar();
    await agendarComIdempotencia(agenda, registro, PEDIDO);
    const segunda = await agendarComIdempotencia(agenda, registro, PEDIDO);

    strictEqual(segunda.estado, "confirmado");
    strictEqual(segunda.estado === "confirmado" && segunda.reaproveitado, true);
    strictEqual(agenda.agendados.length, 1);
  });

  it("nao reescreve nem quando a segunda tentativa muda de profissional", async () => {
    const { agenda, registro } = montar();
    await agendarComIdempotencia(agenda, registro, PEDIDO);
    await agendarComIdempotencia(agenda, registro, { ...PEDIDO, profissionalId: "prof_2" });

    strictEqual(agenda.agendados.length, 1);
  });
});

describe("falha de rede sem escrita", () => {
  it("reenvia uma vez e confirma, com um unico evento no fim", async () => {
    const { agenda, registro } = montar();
    agenda.injetarFalhas({ tipo: "rede" });

    const resultado = await agendarComIdempotencia(agenda, registro, PEDIDO);

    strictEqual(resultado.estado, "confirmado");
    strictEqual(agenda.agendados.length, 1);
  });
});

describe("escrita que acontece e resposta que se perde", () => {
  it("nao duplica: o reenvio bate na revalidacao do servidor", async () => {
    const { agenda, registro } = montar();
    agenda.injetarFalhas({ tipo: "escreve_e_cai" });

    await agendarComIdempotencia(agenda, registro, PEDIDO);

    strictEqual(agenda.agendados.length, 1);
  });

  it("nao afirma sucesso, porque a API nao confirmou (ADR 0005)", async () => {
    const { agenda, registro } = montar();
    agenda.injetarFalhas({ tipo: "escreve_e_cai" });

    const resultado = await agendarComIdempotencia(agenda, registro, PEDIDO);

    strictEqual(resultado.estado, "incerto");
  });

  it("uma nova tentativa depois do incerto continua sem escrever", async () => {
    const { agenda, registro } = montar();
    agenda.injetarFalhas({ tipo: "escreve_e_cai" });
    await agendarComIdempotencia(agenda, registro, PEDIDO);

    const terceira = await agendarComIdempotencia(agenda, registro, PEDIDO);

    strictEqual(terceira.estado, "incerto");
    strictEqual(agenda.agendados.length, 1);
  });
});

describe("recusa do servidor", () => {
  it("registra como recusado e nao cria evento", async () => {
    const { agenda, registro } = montar();
    const resultado = await agendarComIdempotencia(agenda, registro, { ...PEDIDO, hora: "12:30" });

    strictEqual(resultado.estado, "recusado");
    strictEqual(resultado.estado === "recusado" && resultado.codigo, "regra_de_negocio");
    strictEqual(agenda.agendados.length, 0);
  });

  it("permite tentar de novo depois de uma recusa, porque nada foi escrito", async () => {
    const { agenda, registro } = montar();
    const pedidoCedo = { ...PEDIDO, hora: "12:30" };
    await agendarComIdempotencia(agenda, registro, pedidoCedo);

    const segunda = await agendarComIdempotencia(agenda, registro, pedidoCedo);

    // Recusa de novo, pela mesma regra — mas chegou a chamar a API em vez de
    // responder do registro, que e o comportamento pretendido.
    strictEqual(segunda.estado, "recusado");
  });

  it("domingo, com a loja fechada, e recusa e nao incerteza", async () => {
    const { agenda, registro } = montar();
    const resultado = await agendarComIdempotencia(agenda, registro, { ...PEDIDO, data: "2026-08-09" });

    strictEqual(resultado.estado, "recusado");
    strictEqual(agenda.agendados.length, 0);
  });
});

describe("horario tomado por terceiro", () => {
  it("recusa a segunda pessoa e mantem um evento so", async () => {
    const { agenda, registro } = montar();
    await agendarComIdempotencia(agenda, registro, PEDIDO);

    const outroCliente = {
      ...PEDIDO,
      nomeCliente: "Maria",
      telefoneCliente: "5511977776666",
    };
    const resultado = await agendarComIdempotencia(agenda, registro, outroCliente);

    strictEqual(resultado.estado, "recusado");
    strictEqual(resultado.estado === "recusado" && resultado.codigo, "slot_ocupado");
    strictEqual(agenda.agendados.length, 1);
  });

  it("o mesmo horario com outro profissional continua livre", async () => {
    const { agenda, registro } = montar();
    await agendarComIdempotencia(agenda, registro, PEDIDO);

    const resultado = await agendarComIdempotencia(agenda, registro, {
      ...PEDIDO,
      profissionalId: "prof_2",
      nomeCliente: "Maria",
      telefoneCliente: "5511977776666",
    });

    strictEqual(resultado.estado, "confirmado");
    strictEqual(agenda.agendados.length, 2);
    deepStrictEqual(
      agenda.agendados.map((a) => a.profissionalId),
      ["prof_1", "prof_2"],
    );
  });
});
