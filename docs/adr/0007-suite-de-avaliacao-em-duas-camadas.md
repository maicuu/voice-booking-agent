# ADR 0007: Suíte de avaliação em duas camadas — reprodução gravada no CI, execução ao vivo sob demanda

**Data:** 2026-08-04
**Status:** Aceito

## Contexto

O `plano.md` §6.2 chama a suíte de avaliação de "o item mais sênior da lista": 25 a
40 conversas de teste, cada uma declarando qual ferramenta deveria ser chamada e com
quais argumentos, **rodando no CI a cada commit**, com a taxa de aprovação publicada.

A ADR 0006 fixou o modelo e o preço por token, e mostrou que a conta que importa não
é a da conversa avulsa. É esta:

```
casos por execução  ×  custo por conversa  ×  execuções
```

Com 30 casos e execução a cada commit, algumas centenas de commits ao longo do
projeto multiplicam o custo por conversa por **cinco mil**. Qualquer valor
plausível de custo por conversa, multiplicado por cinco mil, estoura um orçamento de
R$10. O item mais sênior do plano é também o que consome o orçamento inteiro.

Há um segundo problema, independente de dinheiro: **um LLM não é determinístico**. Uma
suíte que chama o modelo de verdade a cada commit falha de forma intermitente por
motivos que não têm relação com o commit. Isso não é uma suíte de testes — é uma
fonte de ruído que o time aprende a ignorar.

## Decisão

A suíte roda em **duas camadas**, com propósitos diferentes.

**Camada 1 — reprodução gravada, a cada commit, custo zero.** Cada caso tem um
diálogo gravado: as respostas que o modelo deu quando o caso foi executado ao vivo,
guardadas em arquivo. No CI, o `ModeloDeLinguagem` é substituído por uma
implementação que lê a gravação em vez de chamar a API. O que essa camada verifica é
tudo que fica **em volta** do modelo: máquina de estados, guardas de confirmação,
idempotência, tradução de nome para id, montagem da frase, degradação em erro. Sem
rede, sem chave de API, sem custo, e determinística.

**Camada 2 — execução ao vivo, sob demanda, paga.** Roda contra o modelo de verdade,
por escolha explícita, nunca automaticamente. Ela faz duas coisas: produz a **taxa de
aprovação que vai ao README**, e **regrava** os diálogos da camada 1. É executada
quando o prompt muda, quando o modelo muda, e antes de publicar um número.

**Uma gravação ausente é falha, não pulo.** Um caso sem diálogo gravado faz a camada
1 falhar em vez de passar silenciosamente — senão a suíte degrada para "verde porque
não testou nada", que é pior que vermelho.

## Alternativas descartadas

- **Rodar a suíte ao vivo a cada commit, como o plano dizia** — descartada por custo,
  e o custo não é marginal: é o orçamento inteiro do projeto, várias vezes. Seria
  descartada mesmo sem restrição financeira, pela intermitência.
- **Reduzir o número de casos até caber no orçamento** — descartada porque ataca o
  lado errado da multiplicação. Cortar de 30 casos para 8 sacrifica exatamente a
  cobertura que dá valor à suíte (ambiguidade, correção no meio, desistência) e ainda
  assim não resolve, porque o outro fator é o número de commits.
- **Rodar ao vivo só no merge para a branch principal** — descartada porque reduz a
  frequência sem mudar a natureza: continua pago, continua intermitente, e agora
  falha no pior momento possível. A camada 2 sob demanda dá o mesmo controle sem o
  gatilho automático.
- **Testar só o texto final da conversa** — descartada porque o texto é a parte que o
  modelo escreve e portanto a que mais varia. O que a ADR 0001 tornou verificável foi
  **qual ferramenta foi chamada e com quais argumentos** — asserção objetiva, estável
  entre execuções. É nisso que os casos afirmam.
- **Modelo local para rodar a suíte de graça** — descartada porque a suíte passaria a
  medir o comportamento de um modelo que não é o que roda em produção. Uma taxa de
  aprovação obtida com outro modelo não é a taxa de aprovação do sistema.

## Consequências

- **O número publicado no README vem da camada 2, e carrega a data em que foi
  medido.** Ele não se atualiza sozinho a cada commit — e o README precisa dizer
  isso, senão vira um número que parece contínuo e não é.
- **Gravação desatualizada é uma classe de bug nova.** Se o prompt mudar e ninguém
  regravar, a camada 1 continua verde testando um diálogo que o modelo não produz
  mais. Mitigação: a gravação guarda o hash do prompt de sistema e das definições de
  ferramenta que a produziram, e a camada 1 falha quando ele não bate com o atual.
- **A camada 1 não detecta regressão de prompt.** Ela não pode: não chama o modelo. O
  que a protege é a camada 2 rodar quando o prompt muda — o hash acima transforma
  esse "quando" de disciplina humana em falha de teste.
- **O `ModeloDeLinguagem` da ADR 0006 vira ponto de gravação**, e não só de troca de
  provedor. A interface passa a ter dois motivos para existir.
- O CI deixa de precisar de chave de API, o que também elimina um segredo do
  ambiente de integração contínua.

## Como saberei que errei

Se aparecer um bug em conversa real que a camada 1 tinha condição de pegar e não
pegou — porque a gravação estava velha e o hash não detectou — então a fronteira
entre as camadas está no lugar errado e mais coisa precisa subir para a camada 2.

E se a camada 2 for executada com frequência tão baixa que a taxa de aprovação
publicada fique meses desatualizada, o número perde o sentido, e a decisão de tirar a
avaliação ao vivo do CI terá custado a métrica que o projeto existe para produzir.
