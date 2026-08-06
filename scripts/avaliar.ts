import { CASOS } from "../src/avaliacao/casos.ts";
import { rodarSuite, RELOGIO_DA_AVALIACAO } from "../src/avaliacao/executor.ts";
import {
  carregarGravacao,
  ModeloGravado,
  ModeloGravador,
  salvarGravacao,
} from "../src/avaliacao/gravacao.ts";
import { ModeloClaude, MODELO_PADRAO } from "../src/conversa/claude.ts";
import type { CasoDeAvaliacao } from "../src/avaliacao/tipos.ts";

/**
 * A suite de avaliacao (ADR 0007).
 *
 *   npm run avaliar                -> camada 1: reproduz as gravacoes. Sem rede,
 *                                     sem chave, sem custo. E o que roda no CI.
 *   npm run avaliar -- --ao-vivo   -> camada 2: chama o modelo de verdade,
 *                                     regrava e produz o numero publicavel.
 *                                     CUSTA DINHEIRO.
 *
 * Um caso pode ser filtrado por nome: `npm run avaliar -- caminho-feliz`.
 */

const argumentos = process.argv.slice(2);
const aoVivo = argumentos.includes("--ao-vivo");
const filtro = argumentos.filter((a) => !a.startsWith("--"));
const casos: CasoDeAvaliacao[] =
  filtro.length > 0 ? CASOS.filter((c) => filtro.includes(c.nome)) : CASOS;

if (casos.length === 0) {
  console.error(`Nenhum caso corresponde a ${filtro.join(", ")}.`);
  process.exit(1);
}

const modelo = process.env["LLM_MODEL"] ?? MODELO_PADRAO;
const gravadores = new Map<string, ModeloGravador>();

console.log(
  aoVivo
    ? `Camada 2 — ao vivo contra ${modelo}. Isto gasta tokens.\n`
    : "Camada 1 — reproduzindo gravacoes. Sem rede e sem custo.\n",
);

const resumo = await rodarSuite(casos, {
  modeloPara: async (caso) => {
    if (!aoVivo) return new ModeloGravado(await carregarGravacao(caso.nome));
    const gravador = new ModeloGravador(new ModeloClaude({ modelo }));
    gravadores.set(caso.nome, gravador);
    return gravador;
  },
});

for (const resultado of resumo.resultados) {
  console.log(`${resultado.passou ? "ok  " : "FALHA"} ${resultado.caso}`);
  for (const falha of resultado.falhas) console.log(`      ${falha}`);
  if (!resultado.passou && resultado.turnos.length > 0) {
    // A transcricao so aparece no caso que falhou: e o que se olha para
    // entender o porque, e ruido em todos os outros.
    for (const turno of resultado.turnos) {
      console.log(`      cliente: ${turno.fala}`);
      console.log(`      agente:  ${turno.resposta}`);
    }
  }
}

if (aoVivo) {
  const gravadoEm = RELOGIO_DA_AVALIACAO.toISOString();
  for (const [caso, gravador] of gravadores) {
    try {
      await salvarGravacao(gravador.gravacao(caso, modelo, gravadoEm));
    } catch (erro) {
      console.error(`Nao consegui gravar "${caso}": ${erro instanceof Error ? erro.message : erro}`);
    }
  }
  console.log(`\nGravacoes atualizadas em avaliacao/gravacoes/.`);
}

const taxa = resumo.total > 0 ? (resumo.aprovados / resumo.total) * 100 : 0;
console.log(`\n${resumo.aprovados}/${resumo.total} casos — ${taxa.toFixed(1)}% de aprovacao`);

if (aoVivo) {
  console.log(`tokens: ${resumo.uso.entrada} de entrada, ${resumo.uso.saida} de saida`);
  console.log(
    "\nEste e o numero que pode ir para o README, com a data de hoje. O da camada 1 nao vai:\n" +
      "ele mede o codigo em volta do modelo, nao o modelo.",
  );
}

process.exit(resumo.aprovados === resumo.total ? 0 : 1);
