import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agoraNaBarbearia,
  dataPorExtenso,
  diaDaSemana,
  ehData,
  ehHora,
  horaPorExtenso,
  hoje,
  intervaloDeDatas,
  nomeDoDia,
  somarDias,
} from "../src/agenda/datas.ts";

describe("validacao de formato", () => {
  it("recusa data que passa no formato mas nao existe no calendario", () => {
    strictEqual(ehData("2026-08-04"), true);
    strictEqual(ehData("2026-02-31"), false);
    strictEqual(ehData("2026-13-01"), false);
    strictEqual(ehData("04/08/2026"), false);
  });

  it("aceita hora em 24h e recusa o resto", () => {
    strictEqual(ehHora("09:30"), true);
    strictEqual(ehHora("23:59"), true);
    strictEqual(ehHora("24:00"), false);
    strictEqual(ehHora("9:30"), false);
  });
});

describe("dia da semana", () => {
  it("usa a mesma convencao do campo `dia` do AgendaFacil", () => {
    strictEqual(diaDaSemana("2026-08-04"), 2); // terca
    strictEqual(diaDaSemana("2026-08-09"), 0); // domingo
    strictEqual(nomeDoDia("2026-08-06"), "quinta-feira");
  });
});

describe("hoje no fuso da barbearia", () => {
  it("nao usa o fuso do processo: em CI ele e UTC", () => {
    // 01:30 UTC de dia 5 ainda e dia 4 em Sao Paulo. Um agente que calculasse
    // "hoje" no fuso local ofereceria o dia errado durante tres horas por dia.
    const instante = new Date("2026-08-05T01:30:00Z");
    strictEqual(hoje(instante), "2026-08-04");
    deepStrictEqual(agoraNaBarbearia(instante), { data: "2026-08-04", hora: "22:30" });
  });
});

describe("aritmetica de datas", () => {
  it("soma dias atravessando a virada de mes", () => {
    strictEqual(somarDias("2026-08-31", 1), "2026-09-01");
    strictEqual(somarDias("2026-01-01", -1), "2025-12-31");
  });

  it("produz o leque de datas que o agente consulta em paralelo", () => {
    deepStrictEqual(intervaloDeDatas("2026-08-04", 3), ["2026-08-04", "2026-08-05", "2026-08-06"]);
    deepStrictEqual(intervaloDeDatas("2026-08-04", 0), []);
  });
});

describe("texto para falar", () => {
  it("data por extenso, porque repetir 2026-08-06 nao confirma nada", () => {
    strictEqual(dataPorExtenso("2026-08-06"), "quinta-feira, 6 de agosto");
  });

  it("hora por extenso", () => {
    strictEqual(horaPorExtenso("15:00"), "3 da tarde");
    strictEqual(horaPorExtenso("09:30"), "9 e meia da manha");
    strictEqual(horaPorExtenso("19:45"), "7 e 45 da noite");
    strictEqual(horaPorExtenso("12:00"), "12 da tarde");
  });
});
