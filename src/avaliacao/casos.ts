import type { CasoDeAvaliacao } from "./tipos.ts";

/**
 * Os casos da suite (`plano.md` §6.2).
 *
 * O relogio da avaliacao esta congelado em **terca, 4 de agosto de 2026, meio-dia**
 * (`executor.ts`). As datas dos casos saem dai:
 *
 *   ter 04/08 (hoje) · qua 05 · qui 06 · sex 07 · sab 08 · dom 09 (fechado)
 *
 * A barbearia de teste tem dois profissionais — Ricardo, que atende tudo, e Ana,
 * que so faz Corte — e dois servicos: Corte (R$45, 30 min) e Corte com barba
 * (R$70, 60 min). Domingo fechado; a antecedencia minima e de 2 horas.
 *
 * Cada caso afirma **o que o agente fez**, nunca o que ele disse. Um caso que
 * afirmasse texto quebraria na primeira vez que o modelo escolhesse outra
 * palavra, e a suite viraria ruido.
 */
export const CASOS: CasoDeAvaliacao[] = [
  {
    nome: "caminho-feliz",
    descricao:
      "Cliente diz tudo que precisa, confirma, e o agendamento existe no fim. " +
      "Se este caso falhar, nada mais importa.",
    falas: [
      "oi, queria marcar um corte pra hoje as tres da tarde",
      "meu nome e Joao Victor, meu celular e 11 99999-8888",
      "isso mesmo, pode confirmar",
    ],
    espera: {
      agendamentos: 1,
      chamou: ["consultar_horarios", "preparar_confirmacao", "agendar"],
      argumentosDe: { ferramenta: "preparar_confirmacao", contendo: { data: "2026-08-04", hora: "15:00" } },
      degradado: false,
    },
  },
  {
    nome: "pergunta-preco",
    descricao:
      "Preco tem que sair de listar_servicos, nunca da memoria do modelo (ADR 0001). " +
      "Perguntar preco nao pode acabar em agendamento.",
    falas: ["quanto ta o corte com barba?"],
    espera: {
      agendamentos: 0,
      chamou: ["listar_servicos"],
      naoChamou: ["agendar", "preparar_confirmacao"],
    },
  },
  {
    nome: "escolhe-profissional",
    descricao: "Cliente pede um profissional pelo nome; o agente precisa resolver nome para id.",
    falas: [
      "queria marcar com a Ana",
      "corte simples, quinta que vem de manha",
      "pode ser as dez. sou a Maria, 11 98888-7777",
      "confirma sim",
    ],
    espera: {
      agendamentos: 1,
      chamou: ["listar_profissionais", "consultar_horarios", "agendar"],
      argumentosDe: { ferramenta: "preparar_confirmacao", contendo: { profissional_id: "prof_2" } },
    },
  },
  {
    nome: "ambiguidade-de-data",
    descricao:
      "'Quinta que vem' numa terca e ambiguo: pode ser depois de amanha ou a semana " +
      "seguinte. O agente pode perguntar ou assumir, mas nao pode consultar uma data " +
      "que nao seja quinta-feira.",
    falas: ["tem horario quinta que vem?", "essa mesmo, a mais proxima"],
    espera: {
      agendamentos: 0,
      chamou: ["consultar_horarios"],
      naoChamou: ["agendar"],
    },
  },
  {
    nome: "correcao-no-meio",
    descricao:
      "Cliente troca o dia depois de o agente ja ter lido a confirmacao. A leitura " +
      "antiga precisa morrer: agendar na quinta depois de o cliente pedir sexta e o " +
      "erro que este caso existe para pegar.",
    falas: [
      "quero corte quinta as quatro da tarde",
      "sou o Pedro, 11 97777-6666",
      "nao, espera, sexta e melhor",
      "isso, sexta as quatro. pode confirmar",
    ],
    espera: {
      agendamentos: 1,
      chamou: ["agendar"],
      argumentosDe: { ferramenta: "preparar_confirmacao", contendo: { data: "2026-08-07" } },
    },
  },
  {
    nome: "dia-fechado",
    descricao:
      "Domingo a barbearia nao abre. A API devolve lista vazia tanto para fechado " +
      "quanto para lotado, e o agente precisa dizer a frase certa — oferecer outro " +
      "dia, nao outro horario.",
    falas: ["da pra marcar domingo?"],
    espera: {
      agendamentos: 0,
      chamou: ["consultar_horarios"],
      naoChamou: ["agendar"],
    },
  },
  {
    nome: "antecedencia-minima",
    descricao:
      "Sao meio-dia e o cliente quer 13h. O servidor exige 2 horas de antecedencia, " +
      "e o horario nem aparece em /slots. O agente tem que oferecer alternativa em vez " +
      "de insistir.",
    falas: ["consegue me encaixar hoje a uma da tarde?"],
    espera: {
      agendamentos: 0,
      chamou: ["consultar_horarios"],
      naoChamou: ["agendar"],
    },
  },
  {
    nome: "fora-de-escopo",
    descricao:
      "Nao existe ferramenta para produto. O agente recusa dizendo que nao sabe — nunca " +
      "improvisa um preco de pomada, que e exatamente o que a ADR 0001 proibe.",
    falas: ["voces vendem pomada modeladora?", "e quanto custa mais ou menos?"],
    espera: {
      agendamentos: 0,
      naoChamou: ["agendar", "preparar_confirmacao"],
    },
  },
  {
    nome: "desiste-no-meio",
    descricao: "Cliente some no meio da coleta de dados. Nada pode ter sido escrito.",
    falas: ["queria marcar um corte", "quinta de tarde", "deixa pra la, depois eu vejo"],
    espera: {
      agendamentos: 0,
      naoChamou: ["agendar"],
    },
  },
  {
    nome: "nunca-confirma",
    descricao:
      "Cliente da todos os dados mas nunca diz sim. A guarda de confirmacao tem que " +
      "segurar a escrita ate o fim da conversa.",
    falas: [
      "corte hoje as quatro, sou o Lucas, 11 96666-5555",
      "deixa eu ver com minha esposa e te falo",
    ],
    espera: {
      agendamentos: 0,
      naoChamou: ["agendar"],
    },
  },
  {
    nome: "agendar-duas-vezes",
    descricao:
      "Cliente confirma e depois pede de novo, achando que nao foi. Tem que continuar " +
      "um agendamento so — e o caso da ADR 0005 visto pela conversa.",
    falas: [
      "corte hoje as tres, sou o Joao Victor, 11 99999-8888",
      "pode confirmar",
      "acho que nao foi, marca de novo pra mim",
    ],
    espera: { agendamentos: 1 },
  },
  {
    nome: "telefone-invalido",
    descricao:
      "Telefone fixo nao serve: a barbearia usa o numero no WhatsApp. A recusa tem que " +
      "vir antes de o agente ler a confirmacao inteira em voz alta.",
    falas: [
      "quero corte hoje as tres, sou a Carla, meu telefone e 11 3333-4444",
      "ah sim, o celular e 11 95555-4444",
      "pode confirmar",
    ],
    // Sem afirmar o texto exato do telefone que o modelo repassa: ele pode mandar
    // com mascara ou so digitos, e as duas formas estao certas — a normalizacao e
    // do agente. O que prova o caso e o estado final: um agendamento, depois de
    // uma recusa.
    espera: {
      agendamentos: 1,
      chamou: ["preparar_confirmacao", "agendar"],
    },
  },
];
