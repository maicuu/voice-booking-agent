import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { AgendaEmMemoria, estabelecimentoDeTeste } from "../src/agenda/memoria.ts";
import { RegistroEmMemoria } from "../src/agenda/registro.ts";
import { Conversa } from "../src/conversa/orquestrador.ts";
import { fala, ModeloRoteirizado, usa } from "../src/conversa/modelo-roteirizado.ts";
import { ErroModelo, type Entrada, type ModeloDeLinguagem } from "../src/conversa/tipos.ts";

/**
 * O que estes testes verificam nao e a fala do agente — e o que ele fez.
 * Quantos eventos existem na agenda no fim, e qual ferramenta foi chamada com
 * quais argumentos. Essa e a asserção que a ADR 0001 tornou possivel e a unica
 * que nao muda quando o modelo escolhe outras palavras.
 */

const AGORA = new Date("2026-08-04T12:00:00-03:00"); // terca, meio-dia
const DADOS = {
  servico_id: "serv_1",
  profissional_id: "prof_1",
  data: "2026-08-04",
  hora: "15:00",
  nome_cliente: "Joao",
  telefone_cliente: "11999998888",
};

type Roteiro = ConstructorParameters<typeof ModeloRoteirizado>[0];

function montar(roteiro: Roteiro) {
  const agenda = new AgendaEmMemoria(estabelecimentoDeTeste(), () => AGORA.getTime());
  const modelo = new ModeloRoteirizado(roteiro);
  const conversa = new Conversa({
    modelo,
    cliente: agenda,
    registro: new RegistroEmMemoria(),
    slug: "barbearia-teste",
    nomeDaBarbearia: "Barbearia de Teste",
    agora: () => AGORA,
  });
  return { agenda, conversa, modelo };
}

/** Todos os resultados de ferramenta da conversa, ja decodificados. */
function resultados(transcricao: readonly Entrada[]): Array<Record<string, unknown>> {
  return transcricao
    .filter((e): e is Extract<Entrada, { tipo: "ferramentas" }> => e.tipo === "ferramentas")
    .flatMap((e) => e.resultados.map((r) => JSON.parse(r.conteudo) as Record<string, unknown>));
}

describe("a guarda de confirmacao nao e contornavel", () => {
  it("agendar sem preparar a confirmacao e recusado, e nada e escrito", async () => {
    const { agenda, conversa } = montar([
      usa([{ nome: "agendar", argumentos: { comprovante: "conf_1" } }]),
      fala("Deixa eu conferir os dados com voce antes."),
    ]);

    await conversa.falar("marca corte quinta as tres, pode ser");

    strictEqual(agenda.agendados.length, 0);
    const erro = resultados(conversa.transcricao).find((r) => r["erro"] === "sem_confirmacao_pendente");
    ok(erro, "a guarda deveria ter recusado por falta de confirmacao preparada");
  });

  it("preparar e agendar no MESMO turno e recusado — o cliente nao respondeu", async () => {
    const { agenda, conversa } = montar([
      usa([{ nome: "preparar_confirmacao", argumentos: DADOS }]),
      usa([{ nome: "agendar", argumentos: { comprovante: "conf_1" } }]),
      fala("Confirmado!"),
    ]);

    await conversa.falar("quero corte hoje as tres, sou o Joao, 11999998888");

    // O modelo leu a confirmacao e respondeu a si mesmo. E o caso que um prompt
    // sozinho nao impede, e o que o contador de turnos existe para pegar.
    strictEqual(agenda.agendados.length, 0);
    const erro = resultados(conversa.transcricao).find(
      (r) => r["erro"] === "cliente_ainda_nao_confirmou",
    );
    ok(erro, "a guarda deveria ter recusado o resgate no mesmo turno");
  });

  it("comprovante inventado pelo modelo e recusado", async () => {
    const { agenda, conversa } = montar([
      usa([{ nome: "preparar_confirmacao", argumentos: DADOS }]),
      fala("Corte com Ricardo hoje as tres, no nome de Joao. Posso confirmar?"),
      usa([{ nome: "agendar", argumentos: { comprovante: "conf_99" } }]),
      fala("Deixa eu confirmar de novo com voce."),
    ]);

    await conversa.falar("quero corte hoje as tres, sou o Joao, 11999998888");
    await conversa.falar("pode confirmar");

    strictEqual(agenda.agendados.length, 0);
    const erro = resultados(conversa.transcricao).find(
      (r) => r["erro"] === "comprovante_desconhecido",
    );
    ok(erro);
  });

  it("com confirmacao no turno seguinte, agenda de verdade", async () => {
    const { agenda, conversa } = montar([
      usa([{ nome: "preparar_confirmacao", argumentos: DADOS }]),
      fala("Corte com Ricardo hoje as tres, no nome de Joao. Posso confirmar?"),
      usa([{ nome: "agendar", argumentos: { comprovante: "conf_1" } }]),
      fala("Prontinho, ta marcado."),
    ]);

    await conversa.falar("quero corte hoje as tres, sou o Joao, 11999998888");
    const segundo = await conversa.falar("isso, pode confirmar");

    strictEqual(agenda.agendados.length, 1);
    strictEqual(agenda.agendados[0]?.hora, "15:00");
    strictEqual(agenda.agendados[0]?.telefoneCliente, "5511999998888");
    strictEqual(segundo.degradado, false);
  });

  it("um comprovante vale uma escrita so", async () => {
    const { agenda, conversa } = montar([
      usa([{ nome: "preparar_confirmacao", argumentos: DADOS }]),
      fala("Posso confirmar?"),
      usa([{ nome: "agendar", argumentos: { comprovante: "conf_1" } }]),
      fala("Marcado."),
      usa([{ nome: "agendar", argumentos: { comprovante: "conf_1" } }]),
      fala("Ja estava marcado."),
    ]);

    await conversa.falar("quero corte hoje as tres, sou o Joao, 11999998888");
    await conversa.falar("pode confirmar");
    await conversa.falar("confirma de novo pra garantir");

    strictEqual(agenda.agendados.length, 1);
  });
});

describe("validacao antes de ler a confirmacao em voz alta", () => {
  it("telefone invalido e recusado na preparacao, nao na escrita", async () => {
    const { agenda, conversa } = montar([
      usa([
        {
          nome: "preparar_confirmacao",
          argumentos: { ...DADOS, telefone_cliente: "1133334444" }, // fixo
        },
      ]),
      fala("Preciso de um celular com DDD, com o nove na frente."),
    ]);

    await conversa.falar("meu telefone e 11 3333-4444");

    const erro = resultados(conversa.transcricao).find((r) => r["erro"] === "telefone_invalido");
    ok(erro, "deveria recusar antes de gastar um turno lendo a confirmacao");
    strictEqual(agenda.agendados.length, 0);
  });

  it("data fora do formato e recusada com o formato esperado", async () => {
    const { conversa } = montar([
      usa([{ nome: "consultar_horarios", argumentos: { servico_id: "serv_1", data: "04/08/2026" } }]),
      fala("Deixa eu ver aqui."),
    ]);

    await conversa.falar("tem horario dia quatro?");

    const erro = resultados(conversa.transcricao).find((r) => r["erro"] === "data_invalida");
    strictEqual(erro?.["esperado"], "AAAA-MM-DD");
  });
});

describe("consulta de horarios", () => {
  it("sem profissional escolhido, consulta todos que atendem o servico", async () => {
    const { conversa } = montar([
      usa([{ nome: "consultar_horarios", argumentos: { servico_id: "serv_1", data: "2026-08-04" } }]),
      fala("Tenho as tres e as quatro."),
    ]);

    await conversa.falar("tem horario hoje a tarde?");

    const consulta = resultados(conversa.transcricao)[0]!;
    strictEqual(consulta["situacao"], "com_horarios");
    const disponibilidade = consulta["disponibilidade"] as Array<Record<string, unknown>>;
    // Ricardo atende tudo (lista vazia), Ana so serv_1 — os dois entram.
    deepStrictEqual(
      disponibilidade.map((d) => d["profissional"]).sort(),
      ["Ana", "Ricardo"],
    );
  });

  it("domingo devolve fechado, nao lotado", async () => {
    const { conversa } = montar([
      usa([{ nome: "consultar_horarios", argumentos: { servico_id: "serv_1", data: "2026-08-09" } }]),
      fala("Domingo a barbearia nao abre."),
    ]);

    await conversa.falar("e domingo?");

    strictEqual(resultados(conversa.transcricao)[0]?.["situacao"], "fechado");
  });

  it("servico que ninguem atende nao vira lista vazia silenciosa", async () => {
    const { conversa } = montar([
      usa([{ nome: "consultar_horarios", argumentos: { servico_id: "inexistente", data: "2026-08-04" } }]),
      fala("Nao encontrei esse servico."),
    ]);

    await conversa.falar("tem hidratacao?");

    strictEqual(resultados(conversa.transcricao)[0]?.["erro"], "servico_desconhecido");
  });
});

describe("degradacao em vez de queda", () => {
  it("falha do modelo vira frase util, e a conversa nao quebra", async () => {
    const agenda = new AgendaEmMemoria(estabelecimentoDeTeste(), () => AGORA.getTime());
    const modeloQuebrado: ModeloDeLinguagem = {
      async responder() {
        throw new ErroModelo("indisponivel", "conexao caiu");
      },
    };
    const conversa = new Conversa({
      modelo: modeloQuebrado,
      cliente: agenda,
      registro: new RegistroEmMemoria(),
      slug: "barbearia-teste",
      nomeDaBarbearia: "Barbearia de Teste",
      agora: () => AGORA,
    });

    const turno = await conversa.falar("oi");

    strictEqual(turno.degradado, true);
    ok(turno.resposta.length > 0, "nunca silencio");
    ok(!turno.resposta.includes("conexao caiu"), "detalhe tecnico nao vai para o cliente");
  });

  it("limite de requisicoes tem frase propria", async () => {
    const agenda = new AgendaEmMemoria(estabelecimentoDeTeste(), () => AGORA.getTime());
    const conversa = new Conversa({
      modelo: {
        async responder() {
          throw new ErroModelo("limite_excedido", "429");
        },
      },
      cliente: agenda,
      registro: new RegistroEmMemoria(),
      slug: "barbearia-teste",
      nomeDaBarbearia: "Barbearia de Teste",
      agora: () => AGORA,
    });

    const turno = await conversa.falar("oi");

    ok(turno.resposta.includes("procura"), `frase inesperada: ${turno.resposta}`);
  });

  it("erro da agenda volta ao modelo como resultado, nao como excecao", async () => {
    const agenda = new AgendaEmMemoria(estabelecimentoDeTeste(), () => AGORA.getTime());
    const conversa = new Conversa({
      modelo: new ModeloRoteirizado([
        usa([{ nome: "listar_servicos" }]),
        fala("Nao consegui ver a agenda agora."),
      ]),
      cliente: {
        estabelecimento: async () => {
          throw new Error("banco fora do ar");
        },
        disponibilidade: agenda.disponibilidade.bind(agenda),
        agendar: agenda.agendar.bind(agenda),
      },
      registro: new RegistroEmMemoria(),
      slug: "barbearia-teste",
      nomeDaBarbearia: "Barbearia de Teste",
      agora: () => AGORA,
    });

    const turno = await conversa.falar("quanto custa o corte?");

    strictEqual(turno.degradado, false, "erro de ferramenta nao derruba o turno");
    strictEqual(resultados(conversa.transcricao)[0]?.["erro"], "falha_inesperada");
  });
});

describe("teto de rodadas", () => {
  it("modelo em laco de ferramenta encerra com frase honesta", async () => {
    const { conversa } = montar(
      Array.from({ length: 12 }, () => usa([{ nome: "listar_servicos" }])),
    );

    const turno = await conversa.falar("oi");

    strictEqual(turno.degradado, true);
    ok(turno.chamadas.length <= 6, `chamou ${turno.chamadas.length} vezes`);
  });
});

describe("o que o modelo recebe", () => {
  it("a data de hoje entra no prompt, para resolver 'quinta que vem'", async () => {
    const { conversa, modelo } = montar([fala("Oi! Como posso ajudar?")]);

    await conversa.falar("oi");

    ok(modelo.pedidos[0]?.sistema.includes("2026-08-04"));
    ok(modelo.pedidos[0]?.sistema.includes("Barbearia de Teste"));
  });

  it("as cinco ferramentas sao oferecidas em todo turno", async () => {
    const { conversa, modelo } = montar([fala("Oi!")]);

    await conversa.falar("oi");

    deepStrictEqual(
      modelo.pedidos[0]?.ferramentas.map((f) => f.nome).sort(),
      ["agendar", "consultar_horarios", "listar_profissionais", "listar_servicos", "preparar_confirmacao"],
    );
  });
});
