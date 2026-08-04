import type { Data, Hora } from "./tipos.ts";

/**
 * O AgendaFacil trabalha inteiro em America/Sao_Paulo — o deslocamento `-03:00`
 * esta escrito no codigo dele (ADR 0003). O agente pode rodar em outro fuso, e
 * roda em CI quase sempre em UTC, entao "hoje" e "amanha" precisam ser
 * calculados no fuso da barbearia, nunca no do processo.
 *
 * Nada aqui reimplementa regra de negocio: antecedencia minima, pausa e
 * expediente sao do servidor, e o agente le o resultado em `/slots`.
 */

export const FUSO_BARBEARIA = "America/Sao_Paulo";

const FORMATO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const FORMATO_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function ehData(valor: string): valor is Data {
  if (!FORMATO_DATA.test(valor)) return false;
  // O formato passa em "2026-02-31"; a data nao existe. Reconstruir e comparar
  // pega isso sem tabela de dias por mes.
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

export function ehHora(valor: string): valor is Hora {
  return FORMATO_HORA.test(valor);
}

/**
 * 0 = domingo, 6 = sabado. Mesma convencao de `Date.getDay()` e do campo `dia`
 * do AgendaFacil.
 *
 * Interpreta a data como civil, em UTC, de proposito: o dia da semana de uma
 * data no calendario nao depende de fuso, e passar pelo fuso local so
 * introduziria a chance de virar o dia.
 */
export function diaDaSemana(data: Data): number {
  return new Date(`${data}T00:00:00Z`).getUTCDay();
}

/** A data de hoje na barbearia, independente do fuso onde o agente roda. */
export function hoje(agora: Date = new Date()): Data {
  return emSaoPaulo(agora).data;
}

/** Data e hora atuais na barbearia. */
export function agoraNaBarbearia(agora: Date = new Date()): { data: Data; hora: Hora } {
  return emSaoPaulo(agora);
}

function emSaoPaulo(instante: Date): { data: Data; hora: Hora } {
  // `en-CA` produz AAAA-MM-DD, que e exatamente o formato que a API espera.
  const formatador = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_BARBEARIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const partes = new Map(formatador.formatToParts(instante).map((p) => [p.type, p.value]));
  const hora = partes.get("hour") === "24" ? "00" : partes.get("hour");
  return {
    data: `${partes.get("year")}-${partes.get("month")}-${partes.get("day")}`,
    hora: `${hora}:${partes.get("minute")}`,
  };
}

export function somarDias(data: Data, dias: number): Data {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * As `dias` datas a partir de `inicio`, inclusive. Serve ao leque de consultas
 * da ADR 0003: "semana que vem" vira uma chamada de `/slots` por dia.
 */
export function intervaloDeDatas(inicio: Data, dias: number): Data[] {
  return Array.from({ length: Math.max(0, dias) }, (_, i) => somarDias(inicio, i));
}

const NOMES_DOS_DIAS = [
  "domingo",
  "segunda-feira",
  "terca-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sabado",
] as const;

export function nomeDoDia(data: Data): string {
  return NOMES_DOS_DIAS[diaDaSemana(data)] ?? "";
}

/**
 * `2026-08-06` para "quinta-feira, 6 de agosto". O agente fala data por extenso
 * na confirmacao: repetir "2026-08-06" para quem esta no telefone nao confirma
 * nada.
 */
export function dataPorExtenso(data: Data): string {
  const meses = [
    "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
  ];
  const [, mes, dia] = data.split("-");
  const indiceMes = Number(mes) - 1;
  return `${nomeDoDia(data)}, ${Number(dia)} de ${meses[indiceMes] ?? mes}`;
}

/** `15:00` para "3 da tarde"; `09:30` para "9 e meia da manha". */
export function horaPorExtenso(hora: Hora): string {
  const [h, m] = hora.split(":").map(Number);
  if (h === undefined || m === undefined) return hora;
  const periodo = h < 12 ? "da manha" : h < 18 ? "da tarde" : "da noite";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (m === 0) return `${h12} ${periodo}`;
  if (m === 30) return `${h12} e meia ${periodo}`;
  return `${h12} e ${m} ${periodo}`;
}
