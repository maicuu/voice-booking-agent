import { AgendaEmMemoria, estabelecimentoDeTeste } from "../agenda/memoria.ts";
import { RegistroEmMemoria } from "../agenda/registro.ts";
import { Conversa } from "../conversa/orquestrador.ts";
import type { ChamadaDeFerramenta, ModeloDeLinguagem, UsoDeTokens } from "../conversa/tipos.ts";
import type { CasoDeAvaliacao, Expectativa, ResultadoDeCaso, ResumoDaSuite, TurnoDoCaso } from "./tipos.ts";

/**
 * Executor da suite de avaliacao (ADR 0007).
 *
 * Cada caso roda contra um duplo em memoria novo: sem banco, sem OAuth, sem
 * rede. O que varia entre a camada 1 e a camada 2 e so o `ModeloDeLinguagem`
 * que entra — gravado ou de verdade.
 */

/**
 * O relogio da suite e congelado, e isso nao e conveniencia: e requisito.
 *
 * Dois motivos, e os dois quebram a suite se forem ignorados. Primeiro, "quinta
 * que vem" tem que resolver para a mesma data em toda execucao, senao o caso de
 * ambiguidade afirma coisas diferentes a cada dia. Segundo, o prompt de sistema
 * carrega a data de hoje — com o relogio solto, a assinatura da gravacao mudaria
 * a cada meia-noite e toda gravacao seria considerada desatualizada no dia
 * seguinte.
 *
 * Terca-feira, meio-dia, com a barbearia aberta e o dia ainda pela frente.
 */
export const RELOGIO_DA_AVALIACAO = new Date("2026-08-04T12:00:00-03:00");

export const BARBEARIA_DA_AVALIACAO = "Barbearia de Teste";

export type OpcoesDeExecucao = {
  /** Fabrica: cada caso precisa de um modelo proprio, porque o gravado tem estado. */
  modeloPara: (caso: CasoDeAvaliacao) => Promise<ModeloDeLinguagem> | ModeloDeLinguagem;
};

export async function rodarCaso(
  caso: CasoDeAvaliacao,
  modelo: ModeloDeLinguagem,
): Promise<ResultadoDeCaso> {
  const agenda = new AgendaEmMemoria(estabelecimentoDeTeste(), () => RELOGIO_DA_AVALIACAO.getTime());
  const conversa = new Conversa({
    modelo,
    cliente: agenda,
    registro: new RegistroEmMemoria(),
    slug: estabelecimentoDeTeste().slug,
    nomeDaBarbearia: BARBEARIA_DA_AVALIACAO,
    agora: () => RELOGIO_DA_AVALIACAO,
  });

  const chamadas: ChamadaDeFerramenta[] = [];
  const turnos: TurnoDoCaso[] = [];
  const uso: UsoDeTokens = { entrada: 0, saida: 0 };

  for (const fala of caso.falas) {
    const turno = await conversa.falar(fala);
    chamadas.push(...turno.chamadas);
    turnos.push({ fala, resposta: turno.resposta, degradado: turno.degradado });
    uso.entrada += turno.uso.entrada;
    uso.saida += turno.uso.saida;
  }

  const falhas = conferir(caso.espera, {
    chamadas,
    agendamentos: agenda.agendados.length,
    ultimoDegradado: turnos[turnos.length - 1]?.degradado ?? false,
  });

  return {
    caso: caso.nome,
    passou: falhas.length === 0,
    falhas,
    chamadas,
    agendamentos: agenda.agendados.length,
    turnos,
    uso,
  };
}

function conferir(
  espera: Expectativa,
  observado: {
    chamadas: ChamadaDeFerramenta[];
    agendamentos: number;
    ultimoDegradado: boolean;
  },
): string[] {
  const falhas: string[] = [];
  const nomes = new Set(observado.chamadas.map((c) => c.nome));

  if (observado.agendamentos !== espera.agendamentos) {
    falhas.push(
      `esperava ${espera.agendamentos} agendamento(s) no fim, encontrou ${observado.agendamentos}`,
    );
  }

  for (const nome of espera.chamou ?? []) {
    if (!nomes.has(nome)) falhas.push(`a ferramenta \`${nome}\` deveria ter sido chamada`);
  }

  for (const nome of espera.naoChamou ?? []) {
    if (nomes.has(nome)) falhas.push(`a ferramenta \`${nome}\` nao deveria ter sido chamada`);
  }

  if (espera.argumentosDe) {
    const { ferramenta, contendo } = espera.argumentosDe;
    const candidatas = observado.chamadas.filter((c) => c.nome === ferramenta);
    if (candidatas.length === 0) {
      falhas.push(`nenhuma chamada de \`${ferramenta}\` para conferir os argumentos`);
    } else if (!candidatas.some((c) => contem(c.argumentos, contendo))) {
      falhas.push(
        `nenhuma chamada de \`${ferramenta}\` tinha ${JSON.stringify(contendo)}; ` +
          `argumentos vistos: ${JSON.stringify(candidatas.map((c) => c.argumentos))}`,
      );
    }
  }

  if (espera.degradado !== undefined && observado.ultimoDegradado !== espera.degradado) {
    falhas.push(
      espera.degradado
        ? "esperava que o ultimo turno degradasse, e ele nao degradou"
        : "o ultimo turno degradou, e nao deveria",
    );
  }

  return falhas;
}

/** Comparacao rasa: o caso afirma os campos que importam, nao o objeto inteiro. */
function contem(argumentos: Record<string, unknown>, esperado: Record<string, unknown>): boolean {
  return Object.entries(esperado).every(([chave, valor]) => argumentos[chave] === valor);
}

export async function rodarSuite(
  casos: readonly CasoDeAvaliacao[],
  opcoes: OpcoesDeExecucao,
): Promise<ResumoDaSuite> {
  const resultados: ResultadoDeCaso[] = [];
  const uso: UsoDeTokens = { entrada: 0, saida: 0 };

  for (const caso of casos) {
    let resultado: ResultadoDeCaso;
    try {
      resultado = await rodarCaso(caso, await opcoes.modeloPara(caso));
    } catch (erro) {
      // Gravacao ausente, desatualizada ou esgotada cai aqui e conta como
      // reprovado. Transformar isso em "pulado" seria o comeco de uma suite que
      // fica verde por nao testar nada.
      resultado = {
        caso: caso.nome,
        passou: false,
        falhas: [erro instanceof Error ? erro.message : String(erro)],
        chamadas: [],
        agendamentos: 0,
        turnos: [],
        uso: { entrada: 0, saida: 0 },
      };
    }
    resultados.push(resultado);
    uso.entrada += resultado.uso.entrada;
    uso.saida += resultado.uso.saida;
  }

  return {
    total: resultados.length,
    aprovados: resultados.filter((r) => r.passou).length,
    resultados,
    uso,
  };
}
