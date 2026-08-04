/**
 * Vocabulario da camada de ferramentas (ADR 0003).
 *
 * O formato bruto da API do AgendaFacil — `_id`, `name`, `nomeExibicao`,
 * `horariosPorDia` — para na implementacao HTTP e nao sobe daqui. Acima desta
 * fronteira ninguem sabe que existe Mongo do outro lado, e trocar de backend de
 * agendamento significa escrever outra implementacao de `AgendaClient`, nao
 * mexer na maquina de estados.
 */

/** Data no formato `AAAA-MM-DD`, no fuso America/Sao_Paulo. */
export type Data = string;

/** Horario no formato `HH:MM`, 24h. */
export type Hora = string;

/** Telefone em E.164 sem o `+`: `55` + DDD + 9 digitos. Ver `telefone.ts`. */
export type Telefone = string;

export type Profissional = {
  id: string;
  nome: string;
  /** Servicos que este profissional atende. Vazio significa "todos". */
  servicoIds: string[];
  /**
   * Sem agenda conectada, a API nao consegue nem consultar horario nem
   * escrever: `/slots` responde 503 e a escrita responde 400. Um profissional
   * assim nao pode ser oferecido ao cliente.
   */
  agendaConectada: boolean;
};

export type Servico = {
  id: string;
  nome: string;
  /** Em reais, como o AgendaFacil armazena e exibe. Pode ter centavos. */
  preco: number;
  duracaoMin: number;
};

/** Janela de funcionamento de um dia da semana. */
export type JanelaDoDia = {
  /** 0 = domingo, 6 = sabado. Mesma convencao de `Date.getDay()`. */
  diaDaSemana: number;
  aberto: boolean;
  abertura: Hora;
  /** Horario do ultimo agendamento aceito, nao o do fechamento. */
  ultimoAgendamento: Hora;
};

export type Estabelecimento = {
  slug: string;
  nome: string;
  profissionais: Profissional[];
  servicos: Servico[];
  semana: JanelaDoDia[];
};

/**
 * A API devolve `[]` tanto para "a loja nao abre nesse dia" quanto para "abre e
 * esta cheio" (ADR 0003). Sao frases diferentes para o cliente — uma oferece
 * outro dia, a outra oferece outro horario — entao a distincao e feita aqui,
 * cruzando a resposta vazia com a janela da semana, e nao no prompt.
 */
export type Disponibilidade =
  | { tipo: "horarios"; horarios: Hora[] }
  | { tipo: "fechado" }
  | { tipo: "lotado" };

export type ConsultaDisponibilidade = {
  profissionalId: string;
  servicoId: string;
  data: Data;
};

export type PedidoAgendamento = {
  profissionalId: string;
  servicoId: string;
  data: Data;
  hora: Hora;
  nomeCliente: string;
  telefoneCliente: Telefone;
};

/**
 * Os tres desfechos possiveis de uma escrita, e nao mais que tres (ADR 0005).
 *
 * `incerto` nao e um erro: e a ausencia de informacao. A API respondeu
 * `{ success: true }` sem identificador e nao ha leitura publica de
 * agendamentos, entao um timeout deixa o agente sem saber se escreveu. Este
 * estado existe no tipo para que seja impossivel esquecer de trata-lo — quem
 * consome e obrigado pelo compilador a decidir o que dizer ao cliente.
 */
export type ResultadoEscrita =
  | { estado: "confirmado" }
  | { estado: "recusado"; codigo: CodigoErro; motivo: string }
  | { estado: "incerto"; causa: string };

export type CodigoErro =
  /** Slug, profissional ou servico que nao existe. */
  | "nao_encontrado"
  /** Requisicao malformada segundo a validacao da API. */
  | "dados_invalidos"
  /** Regra de negocio do servidor: fora do expediente, pausa, bloqueio, antecedencia de 2h. */
  | "regra_de_negocio"
  /** O horario foi tomado entre a consulta e a escrita. */
  | "slot_ocupado"
  /** O Google Agenda nao respondeu. A API se recusa a tratar isso como "livre". */
  | "agenda_indisponivel"
  /** Limite de requisicoes da API. */
  | "limite_excedido"
  /** Rede, timeout ou 5xx: nao se sabe se a chamada teve efeito. */
  | "indisponivel";

export class ErroAgenda extends Error {
  readonly codigo: CodigoErro;
  /** Status HTTP, quando houve resposta. Ausente em falha de rede. */
  readonly status: number | undefined;

  constructor(codigo: CodigoErro, mensagem: string, status?: number) {
    super(mensagem);
    this.name = "ErroAgenda";
    this.codigo = codigo;
    this.status = status;
  }
}

/**
 * Contrato de I/O com o sistema de agendamento. Duas implementacoes: `http.ts`,
 * que fala com o AgendaFacil, e `memoria.ts`, que a suite de avaliacao usa em CI
 * sem banco, sem OAuth e sem rede (ADR 0004).
 *
 * `agendar` nao aplica idempotencia — e a chamada crua. A politica da ADR 0005
 * mora em `idempotencia.ts`, uma camada acima, porque depende de estado duravel
 * que nao pertence a um cliente HTTP.
 */
export interface AgendaClient {
  estabelecimento(slug: string): Promise<Estabelecimento>;
  disponibilidade(consulta: ConsultaDisponibilidade): Promise<Disponibilidade>;
  agendar(pedido: PedidoAgendamento): Promise<ResultadoEscrita>;
}
