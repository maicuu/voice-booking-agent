import type { AgendaClient } from "../agenda/tipos.ts";
import type { RegistroDeIntencao } from "../agenda/idempotencia.ts";
import { GuardaDeConfirmacao } from "./confirmacao.ts";
import { executar, FERRAMENTAS, type ContextoDeFerramentas } from "./ferramentas.ts";
import { promptDeSistema } from "./prompt.ts";
import {
  ErroModelo,
  type ChamadaDeFerramenta,
  type Entrada,
  type ModeloDeLinguagem,
  type UsoDeTokens,
} from "./tipos.ts";

/**
 * O laco de um turno: fala do cliente -> modelo -> ferramentas -> modelo -> ...
 * ate o modelo responder sem pedir ferramenta.
 *
 * Este arquivo e o que o `plano.md` §3 diz que o projeto existe para mostrar
 * escrito a mao. Ele nao sabe qual e o provedor do modelo (ADR 0006) nem qual e
 * o sistema de agendamento (ADR 0003) — os dois entram como interface.
 */

/**
 * Teto de rodadas de ferramenta por turno. O caminho feliz mais longo usa tres
 * (listar servicos, listar profissionais, consultar horarios); o dobro disso
 * cobre correcao e reconsulta. Passou daqui, o modelo esta em laco, e um laco
 * de ferramenta e caro em latencia e em token.
 */
const MAXIMO_DE_RODADAS = 6;

export type Turno = {
  /** O que o agente fala. */
  resposta: string;
  /** Ferramentas chamadas neste turno, em ordem. Base do trace do §6.6. */
  chamadas: ChamadaDeFerramenta[];
  uso: UsoDeTokens;
  /** Verdadeiro quando o turno terminou por degradacao, nao por resposta do modelo. */
  degradado: boolean;
};

export type ConfigConversa = {
  modelo: ModeloDeLinguagem;
  cliente: AgendaClient;
  registro: RegistroDeIntencao;
  slug: string;
  nomeDaBarbearia: string;
  agora?: () => Date;
};

export class Conversa {
  readonly #config: ConfigConversa;
  readonly #guarda = new GuardaDeConfirmacao();
  readonly #transcricao: Entrada[] = [];
  readonly #contexto: ContextoDeFerramentas;
  #turno = 0;

  constructor(config: ConfigConversa) {
    this.#config = config;
    this.#contexto = {
      cliente: config.cliente,
      slug: config.slug,
      registro: config.registro,
      guarda: this.#guarda,
      turnoAtual: () => this.#turno,
    };
  }

  get transcricao(): readonly Entrada[] {
    return this.#transcricao;
  }

  async falar(texto: string): Promise<Turno> {
    // O contador sobe aqui, e e o que da sentido a guarda de confirmacao: um
    // comprovante emitido no turno N so pode ser resgatado a partir do N+1, ou
    // seja, depois de o cliente ter falado de novo.
    this.#turno += 1;
    this.#transcricao.push({ tipo: "cliente", texto });

    const chamadasDoTurno: ChamadaDeFerramenta[] = [];
    const uso: UsoDeTokens = { entrada: 0, saida: 0 };

    for (let rodada = 0; rodada < MAXIMO_DE_RODADAS; rodada++) {
      let resposta;
      try {
        resposta = await this.#config.modelo.responder({
          sistema: promptDeSistema(this.#config.nomeDaBarbearia, this.#agora()),
          ferramentas: FERRAMENTAS,
          transcricao: [...this.#transcricao],
        });
      } catch (erro) {
        return this.#degradar(erro, chamadasDoTurno, uso);
      }

      uso.entrada += resposta.uso.entrada;
      uso.saida += resposta.uso.saida;

      this.#transcricao.push({
        tipo: "agente",
        texto: resposta.texto,
        chamadas: resposta.chamadas,
      });

      if (resposta.chamadas.length === 0) {
        return { resposta: resposta.texto, chamadas: chamadasDoTurno, uso, degradado: false };
      }

      chamadasDoTurno.push(...resposta.chamadas);

      // Em paralelo: o modelo pode pedir servicos e profissionais na mesma
      // rodada, e serializar isso somaria latencia sem motivo.
      const resultados = await Promise.all(
        resposta.chamadas.map((chamada) => executar(chamada, this.#contexto)),
      );
      this.#transcricao.push({ tipo: "ferramentas", resultados });
    }

    // Estourou o teto de rodadas. O modelo nao converge; encerrar com uma frase
    // honesta e melhor que continuar gastando token e tempo do cliente.
    return {
      resposta:
        "Desculpe, me embolei aqui. Voce consegue falar direto com a barbearia " +
        "para eu nao te fazer perder tempo?",
      chamadas: chamadasDoTurno,
      uso,
      degradado: true,
    };
  }

  /**
   * Degradacao definida em vez de queda (`plano.md` §6.5). O cliente ouve uma
   * frase util; o motivo tecnico fica no trace, nunca no audio.
   */
  #degradar(erro: unknown, chamadas: ChamadaDeFerramenta[], uso: UsoDeTokens): Turno {
    const codigo = erro instanceof ErroModelo ? erro.codigo : "indisponivel";
    const resposta =
      codigo === "limite_excedido"
        ? "Estamos com muita procura agora. Pode tentar de novo daqui a pouquinho?"
        : "Tive um problema aqui do meu lado. Voce pode repetir?";
    return { resposta, chamadas, uso, degradado: true };
  }

  #agora(): Date {
    return this.#config.agora ? this.#config.agora() : new Date();
  }
}
