# ADR 0001: O LLM não é fonte de verdade de negócio

**Data:** 2026-08-04
**Status:** Aceito

## Contexto

O agente precisa responder perguntas com resposta objetiva e verificável —
"tem horário quinta às 15h?", "quanto custa corte com barba?", "o João atende
sábado?" — e depois criar um agendamento real, com efeito colateral irreversível
na agenda de outra pessoa.

Existe uma API própria em produção (AgendaFácil) que já calcula disponibilidade ao
vivo, valida serviço e profissional, e escreve o agendamento. O dado existe e é
autoritativo.

Um LLM colocado como responsável por qualquer parte dessa resposta vai, em alguma
fração das conversas, produzir um horário que não existe ou um preço que não é o
praticado. Não há prompt que elimine isso, só que reduza a frequência — e a
frequência residual cai em cima de um cliente real.

## Decisão

O LLM interpreta intenção e preenche slots. Nada mais. Toda afirmação sobre
disponibilidade, preço, serviço, profissional ou horário vem de uma chamada à API,
e o texto que o agente fala é montado a partir da resposta dela.

O modelo nunca inventa dado de negócio porque nunca é ele quem tem o dado.

## Alternativas descartadas

- **Injetar a agenda inteira no prompt e deixar o modelo raciocinar** — descartada
  porque o dado vira estado congelado no início do turno: dois clientes ligando ao
  mesmo tempo pegam o mesmo horário, e o modelo ainda erra aritmética de data. Além
  disso o prompt cresce com a agenda, e o custo por conversa junto.
- **Deixar o modelo responder e validar depois, na hora de escrever** — descartada
  porque o cliente já ouviu "quinta às 15h está livre". A correção posterior é pior
  que a pergunta original, e é exatamente o tipo de falha que a suíte de avaliação
  não pega de forma confiável.
- **Modelo maior, com prompt mais rígido** — descartada porque troca um problema de
  arquitetura por um problema de latência e custo, e não resolve: reduz a taxa de
  alucinação, não zera.

## Consequências

- Mais chamadas de rede por turno, e a latência da API entra no orçamento de
  latência da conversa (`plano.md` §6.1). Aceito: é o custo de nunca mentir.
- A camada de ferramentas precisa cobrir todas as perguntas que o agente aceita
  responder. Pergunta sem ferramenta correspondente é resposta que o agente recusa
  ("não sei dizer") — não é resposta que o modelo improvisa.
- O Recepcionista fica acoplado à disponibilidade da API. Se ela cair, o agente
  degrada de forma definida em vez de continuar conversando (`plano.md` §6.5).
- A suíte de avaliação passa a poder verificar **qual ferramenta foi chamada e com
  quais argumentos**, não só o texto final. Isso é o que torna a avaliação objetiva.

## Como saberei que errei

Se aparecer, na suíte de avaliação ou em um trace real, uma resposta do agente
afirmando disponibilidade, preço ou nome de profissional que não veio de uma chamada
de ferramenta registrada no mesmo turno. Um caso é bug de implementação; um padrão
significa que a fronteira desta ADR não está sendo sustentada pelo código.
