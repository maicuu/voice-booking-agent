import { ok, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { CASOS } from "../src/avaliacao/casos.ts";
import { rodarCaso, rodarSuite, RELOGIO_DA_AVALIACAO } from "../src/avaliacao/executor.ts";
import {
  assinatura,
  GravacaoAusente,
  GravacaoDesatualizada,
  ModeloGravado,
  ModeloGravador,
} from "../src/avaliacao/gravacao.ts";
import type { CasoDeAvaliacao, Gravacao } from "../src/avaliacao/tipos.ts";
import { fala, ModeloRoteirizado, usa } from "../src/conversa/modelo-roteirizado.ts";
import { FERRAMENTAS } from "../src/conversa/ferramentas.ts";
import { promptDeSistema } from "../src/conversa/prompt.ts";
import type { RespostaDoModelo } from "../src/conversa/tipos.ts";

/**
 * Testes da maquina de avaliacao, nao dos casos.
 *
 * Uma suite de avaliacao que nao falha quando deveria e pior que nenhuma: ela
 * da a impressao de cobertura. Estes testes existem para provar que ela reprova
 * de verdade — gravacao ausente, gravacao velha, expectativa violada.
 */

const DADOS = {
  servico_id: "serv_1",
  profissional_id: "prof_1",
  data: "2026-08-04",
  hora: "15:00",
  nome_cliente: "Joao",
  telefone_cliente: "11999998888",
};

const CASO_SIMPLES: CasoDeAvaliacao = {
  nome: "teste",
  descricao: "caso sintetico",
  falas: ["quero corte hoje as tres", "pode confirmar"],
  espera: { agendamentos: 1, chamou: ["agendar"] },
};

const ROTEIRO_QUE_AGENDA = [
  usa([{ nome: "preparar_confirmacao", argumentos: DADOS }]),
  fala("Corte hoje as tres, no nome de Joao. Posso confirmar?"),
  usa([{ nome: "agendar", argumentos: { comprovante: "conf_1" } }]),
  fala("Marcado!"),
];

describe("assinatura da gravacao", () => {
  it("nao muda quando a ordem das ferramentas muda", () => {
    const sistema = promptDeSistema("X", RELOGIO_DA_AVALIACAO);
    const invertidas = [...FERRAMENTAS].reverse();
    strictEqual(assinatura(sistema, FERRAMENTAS), assinatura(sistema, invertidas));
  });

  it("muda quando o prompt muda", () => {
    const a = assinatura(promptDeSistema("X", RELOGIO_DA_AVALIACAO), FERRAMENTAS);
    const b = assinatura(promptDeSistema("Y", RELOGIO_DA_AVALIACAO), FERRAMENTAS);
    ok(a !== b);
  });

  it("muda quando a descricao de uma ferramenta muda", () => {
    const sistema = promptDeSistema("X", RELOGIO_DA_AVALIACAO);
    const alterada = FERRAMENTAS.map((f, i) =>
      i === 0 ? { ...f, descricao: f.descricao + " (mudou)" } : f,
    );
    // Descricao de ferramenta muda o comportamento do agente tanto quanto o
    // prompt. Se nao entrasse na assinatura, mudar uma delas passaria batido.
    ok(assinatura(sistema, FERRAMENTAS) !== assinatura(sistema, alterada));
  });

  it("o relogio congelado mantem a assinatura estavel entre execucoes", () => {
    // Com o relogio solto, a data dentro do prompt mudaria a cada meia-noite e
    // toda gravacao seria considerada velha no dia seguinte.
    const a = assinatura(promptDeSistema("X", RELOGIO_DA_AVALIACAO), FERRAMENTAS);
    const b = assinatura(promptDeSistema("X", new Date(RELOGIO_DA_AVALIACAO)), FERRAMENTAS);
    strictEqual(a, b);
  });
});

describe("reproducao gravada", () => {
  function gravacaoDe(respostas: RespostaDoModelo[], caso = "teste"): Gravacao {
    return {
      caso,
      assinatura: assinatura(
        promptDeSistema("Barbearia de Teste", RELOGIO_DA_AVALIACAO),
        FERRAMENTAS,
      ),
      gravadoEm: "2026-08-04T12:00:00.000Z",
      modelo: "claude-haiku-4-5",
      respostas,
    };
  }

  it("reproduz o dialogo e o caso passa, sem tocar em rede", async () => {
    const resultado = await rodarCaso(
      CASO_SIMPLES,
      new ModeloGravado(gravacaoDe(ROTEIRO_QUE_AGENDA)),
    );

    strictEqual(resultado.passou, true, resultado.falhas.join("; "));
    strictEqual(resultado.agendamentos, 1);
  });

  it("gravacao feita com outro prompt e recusada", async () => {
    const velha = { ...gravacaoDe(ROTEIRO_QUE_AGENDA), assinatura: "assinatura_velha" };

    await rodarCaso(CASO_SIMPLES, new ModeloGravado(velha)).then(
      () => ok(false, "deveria ter lancado"),
      (erro: unknown) => ok(erro instanceof GravacaoDesatualizada, String(erro)),
    );
  });

  it("gravacao curta demais falha em vez de passar em silencio", async () => {
    const curta = gravacaoDe([usa([{ nome: "preparar_confirmacao", argumentos: DADOS }])]);

    await rodarCaso(CASO_SIMPLES, new ModeloGravado(curta)).then(
      () => ok(false, "deveria ter lancado"),
      (erro: unknown) => ok(String(erro).includes("esgotada")),
    );
  });
});

describe("a suite reprova quando deve", () => {
  it("expectativa violada reprova o caso", async () => {
    const casoImpossivel: CasoDeAvaliacao = {
      ...CASO_SIMPLES,
      espera: { agendamentos: 2 },
    };

    const resultado = await rodarCaso(casoImpossivel, new ModeloRoteirizado(ROTEIRO_QUE_AGENDA));

    strictEqual(resultado.passou, false);
    ok(resultado.falhas[0]?.includes("esperava 2"));
  });

  it("`naoChamou` pega a ferramenta que nao deveria ter sido usada", async () => {
    const caso: CasoDeAvaliacao = {
      ...CASO_SIMPLES,
      espera: { agendamentos: 1, naoChamou: ["agendar"] },
    };

    const resultado = await rodarCaso(caso, new ModeloRoteirizado(ROTEIRO_QUE_AGENDA));

    strictEqual(resultado.passou, false);
    ok(resultado.falhas.some((f) => f.includes("nao deveria")));
  });

  it("gravacao ausente conta como reprovado, nao como pulado", async () => {
    const resumo = await rodarSuite([CASO_SIMPLES], {
      modeloPara: () => {
        throw new GravacaoAusente("teste");
      },
    });

    strictEqual(resumo.total, 1);
    strictEqual(resumo.aprovados, 0);
    ok(resumo.resultados[0]?.falhas[0]?.includes("Sem gravacao"));
  });
});

describe("gravador", () => {
  it("guarda as respostas e a assinatura do que foi enviado", async () => {
    const gravador = new ModeloGravador(new ModeloRoteirizado(ROTEIRO_QUE_AGENDA));

    await rodarCaso(CASO_SIMPLES, gravador);
    const gravacao = gravador.gravacao("teste", "claude-haiku-4-5", "2026-08-04T12:00:00.000Z");

    strictEqual(gravacao.respostas.length, ROTEIRO_QUE_AGENDA.length);
    strictEqual(
      gravacao.assinatura,
      assinatura(promptDeSistema("Barbearia de Teste", RELOGIO_DA_AVALIACAO), FERRAMENTAS),
    );
  });

  it("o que o gravador guarda reproduz o mesmo resultado", async () => {
    const gravador = new ModeloGravador(new ModeloRoteirizado(ROTEIRO_QUE_AGENDA));
    const aoVivo = await rodarCaso(CASO_SIMPLES, gravador);

    const reproduzido = await rodarCaso(
      CASO_SIMPLES,
      new ModeloGravado(gravador.gravacao("teste", "claude-haiku-4-5", "2026-08-04T12:00:00.000Z")),
    );

    // A propriedade que sustenta a ADR 0007: gravar e reproduzir dao o mesmo
    // veredito. Sem isso, a camada 1 nao substitui a camada 2 em nada.
    strictEqual(reproduzido.passou, aoVivo.passou);
    strictEqual(reproduzido.agendamentos, aoVivo.agendamentos);
  });
});

describe("catalogo de casos", () => {
  it("os nomes sao unicos, porque cada um vira um arquivo de gravacao", () => {
    strictEqual(new Set(CASOS.map((c) => c.nome)).size, CASOS.length);
  });

  it("todo caso tem pelo menos uma fala e uma descricao util", () => {
    for (const caso of CASOS) {
      ok(caso.falas.length > 0, `${caso.nome} sem falas`);
      ok(caso.descricao.length > 30, `${caso.nome} com descricao curta demais`);
    }
  });

  it("os nomes servem como nome de arquivo", () => {
    for (const caso of CASOS) {
      ok(/^[a-z0-9-]+$/.test(caso.nome), `${caso.nome} tem caractere que nao serve em arquivo`);
    }
  });

  it("cobre os cenarios que o plano §6.2 lista", () => {
    const nomes = CASOS.map((c) => c.nome);
    for (const exigido of [
      "caminho-feliz",
      "ambiguidade-de-data",
      "correcao-no-meio",
      "fora-de-escopo",
      "desiste-no-meio",
      "agendar-duas-vezes",
    ]) {
      ok(nomes.includes(exigido), `falta o caso "${exigido}"`);
    }
  });
});
