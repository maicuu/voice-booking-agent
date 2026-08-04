import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { AgendaHttp, desambiguarVazio } from "../src/agenda/http.ts";
import type { Estabelecimento } from "../src/agenda/tipos.ts";

/**
 * Testes do tradutor e do classificador de erro, com `fetch` injetado. Nao
 * verificam que a API se comporta como esperado — isso e trabalho do teste de
 * contrato, que roda contra a instancia local. Aqui verifica-se o que o cliente
 * faz com cada resposta possivel.
 */

type Resposta = { status: number; corpo: unknown; texto?: string };

function clienteCom(respostas: Resposta[] | Resposta, aoChamar?: (url: string, init?: RequestInit) => void) {
  const fila = Array.isArray(respostas) ? [...respostas] : [respostas];
  const fetchFalso = (async (url: string | URL | Request, init?: RequestInit) => {
    aoChamar?.(String(url), init);
    const proxima = fila.length > 1 ? fila.shift()! : fila[0]!;
    const corpo = proxima.texto ?? JSON.stringify(proxima.corpo);
    return new Response(corpo, {
      status: proxima.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;

  return new AgendaHttp({
    baseUrl: "http://localhost:3000/api/",
    tokenDesafio: "token-de-teste",
    cacheConfigMs: 60_000,
    fetch: fetchFalso,
  });
}

const CONFIG_BRUTA = {
  nome: "Barbearia Koala",
  plano: "profissional",
  barbers: [
    { _id: "aaa111", name: "Ricardo", serviceIds: ["sss111"], googleConectado: true },
    { _id: "bbb222", name: "Ana", serviceIds: [], googleConectado: false },
  ],
  services: [
    { _id: "sss111", nomeId: "corte", nomeExibicao: "Corte", preco: 45, duracao: 30 },
    { _id: "sss222", nomeId: "barba", nomeExibicao: "Barba", preco: 30 },
  ],
  horariosPorDia: [
    { dia: 0, ativo: false, abertura: "08:00", ultimoAgendamento: "12:00" },
    { dia: 2, ativo: true, abertura: "09:00", ultimoAgendamento: "18:00" },
  ],
};

describe("traducao da configuracao", () => {
  it("troca o formato bruto da API pelo vocabulario do agente", async () => {
    const cliente = clienteCom({ status: 200, corpo: CONFIG_BRUTA });
    const est = await cliente.estabelecimento("barbearia-koala");

    strictEqual(est.nome, "Barbearia Koala");
    deepStrictEqual(est.profissionais[0], {
      id: "aaa111",
      nome: "Ricardo",
      servicoIds: ["sss111"],
      agendaConectada: true,
    });
    // Sem agenda conectada a API nao consulta nem escreve; o agente precisa
    // saber disso para nao oferecer o profissional.
    strictEqual(est.profissionais[1]?.agendaConectada, false);
  });

  it("preenche a duracao ausente com o padrao do AgendaFacil", async () => {
    const cliente = clienteCom({ status: 200, corpo: CONFIG_BRUTA });
    const est = await cliente.estabelecimento("barbearia-koala");

    strictEqual(est.servicos[1]?.duracaoMin, 45);
    strictEqual(est.servicos[0]?.preco, 45);
  });

  it("guarda em cache: a configuracao muda em escala de dias, o turno nao", async () => {
    let chamadas = 0;
    const cliente = clienteCom({ status: 200, corpo: CONFIG_BRUTA }, () => chamadas++);

    await cliente.estabelecimento("barbearia-koala");
    await cliente.estabelecimento("barbearia-koala");

    strictEqual(chamadas, 1);
  });
});

describe("consulta de horarios", () => {
  it("monta a query com os nomes que a API espera", async () => {
    let urlChamada = "";
    const cliente = clienteCom({ status: 200, corpo: ["09:00", "09:30"] }, (url) => (urlChamada = url));

    const resultado = await cliente.disponibilidade({
      profissionalId: "aaa111",
      servicoId: "sss111",
      data: "2026-08-04",
    });

    strictEqual(urlChamada.includes("barberId=aaa111"), true);
    strictEqual(urlChamada.includes("serviceId=sss111"), true);
    strictEqual(urlChamada.includes("date=2026-08-04"), true);
    deepStrictEqual(resultado, { tipo: "horarios", horarios: ["09:00", "09:30"] });
  });
});

describe("desambiguacao da resposta vazia", () => {
  const estabelecimento: Estabelecimento = {
    slug: "x",
    nome: "X",
    profissionais: [],
    servicos: [],
    semana: [
      { diaDaSemana: 0, aberto: false, abertura: "08:00", ultimoAgendamento: "12:00" },
      { diaDaSemana: 2, aberto: true, abertura: "09:00", ultimoAgendamento: "18:00" },
    ],
  };

  it("domingo com a loja fechada vira `fechado`, nao `lotado`", () => {
    const resultado = desambiguarVazio({ tipo: "lotado" }, estabelecimento, "2026-08-09");
    deepStrictEqual(resultado, { tipo: "fechado" });
  });

  it("terca sem horario continua `lotado`", () => {
    const resultado = desambiguarVazio({ tipo: "lotado" }, estabelecimento, "2026-08-04");
    deepStrictEqual(resultado, { tipo: "lotado" });
  });
});

describe("classificacao de erro na escrita", () => {
  const pedido = {
    profissionalId: "aaa111",
    servicoId: "sss111",
    data: "2026-08-04",
    hora: "15:00",
    nomeCliente: "Joao",
    telefoneCliente: "5511999998888",
  };

  it("200 e confirmacao", async () => {
    const cliente = clienteCom({ status: 200, corpo: { success: true } });
    deepStrictEqual(await cliente.agendar(pedido), { estado: "confirmado" });
  });

  it("409 e recusa por horario tomado, e o agente pode oferecer outro", async () => {
    const cliente = clienteCom({
      status: 409,
      corpo: { error: "Este horario acabou de ser reservado. Escolha outro." },
    });
    const resultado = await cliente.agendar(pedido);

    strictEqual(resultado.estado, "recusado");
    strictEqual(resultado.estado === "recusado" && resultado.codigo, "slot_ocupado");
  });

  it("400 sem `detalhes` e regra de negocio, que vira frase para o cliente", async () => {
    const cliente = clienteCom({ status: 400, corpo: { error: "Agendamento exige 2h de antecedencia." } });
    const resultado = await cliente.agendar(pedido);

    strictEqual(resultado.estado === "recusado" && resultado.codigo, "regra_de_negocio");
  });

  it("400 com `detalhes` e bug do agente, nao informacao para o cliente", async () => {
    const cliente = clienteCom({
      status: 400,
      corpo: { error: "Dados invalidos", detalhes: [{ msg: "WhatsApp invalido" }] },
    });
    const resultado = await cliente.agendar(pedido);

    strictEqual(resultado.estado === "recusado" && resultado.codigo, "dados_invalidos");
  });

  it("500 e incerto: nao se sabe se a escrita teve efeito (ADR 0005)", async () => {
    const cliente = clienteCom({ status: 500, corpo: { error: "Erro ao processar agendamento." } });
    const resultado = await cliente.agendar(pedido);

    strictEqual(resultado.estado, "incerto");
  });

  it("503 e recusa: a API so o devolve antes de escrever", async () => {
    const cliente = clienteCom({
      status: 503,
      corpo: { error: "Agenda do barbeiro indisponivel no momento." },
    });
    const resultado = await cliente.agendar(pedido);

    strictEqual(resultado.estado, "recusado");
    strictEqual(resultado.estado === "recusado" && resultado.codigo, "agenda_indisponivel");
  });

  it("HTML no lugar de JSON nao vira sucesso silencioso", async () => {
    const cliente = clienteCom({ status: 200, corpo: null, texto: "<!doctype html><html>" });
    const resultado = await cliente.agendar(pedido);

    strictEqual(resultado.estado, "incerto");
  });

  it("envia o token de desafio, sem o qual a API recusa a escrita", async () => {
    let corpoEnviado: unknown;
    const cliente = clienteCom({ status: 200, corpo: { success: true } }, (_url, init) => {
      corpoEnviado = JSON.parse(String(init?.body));
    });

    await cliente.agendar(pedido);

    strictEqual((corpoEnviado as Record<string, unknown>)["cfToken"], "token-de-teste");
    strictEqual((corpoEnviado as Record<string, unknown>)["clientPhone"], "5511999998888");
  });
});
