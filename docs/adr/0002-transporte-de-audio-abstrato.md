# ADR 0002: Transporte de áudio abstrato, WebRTC antes de telefonia

**Data:** 2026-08-04
**Status:** Aceito

## Contexto

O agente pode receber áudio por dois caminhos: navegador via WebRTC, ou telefonia
via SIP/Twilio. Telefonia é o caminho mais impressionante de descrever e o mais caro
de construir — número, provedor, custo por minuto, codec estreito.

O projeto existe para ser aberto por quem avalia. Um recrutador em São Paulo, ou
fora do Brasil, não vai discar um número brasileiro para testar um projeto de
portfólio. Vai clicar num link, falar dez segundos e fechar. Se a porta de entrada
for um telefone, a taxa de uso tende a zero — e projeto que ninguém abre não prova
nada.

## Decisão

O orquestrador conversa com uma interface `AudioTransport`. WebRTC e SIP são
implementações dela, e nenhuma detalhe de transporte vaza para a máquina de estados.

WebRTC é entregue primeiro, com um botão "falar com o agente" na página pública.
Telefonia entra depois, na Fase 4, e é provada por um vídeo curto de ligação real no
README — o que demonstra a capacidade sem exigir que ninguém ligue.

## Alternativas descartadas

- **Telefonia primeiro, navegador depois** — descartada por taxa de uso: o custo de
  construir é maior e o número de pessoas que efetivamente testam é menor.
- **Só navegador, sem abstração** — descartada porque o acoplamento a WebRTC no
  orquestrador tornaria a Fase 4 uma reescrita, e porque a fronteira de transporte é
  justamente um ponto de design que vale defender em entrevista.
- **Framework pronto de agente de voz, que já resolve os dois transportes** —
  descartada porque entrega mais rápido e **prova menos**. O objetivo declarado do
  projeto é mostrar que sei montar o loop, não que sei configurar um.

## Consequências

- A interface precisa acomodar a diferença real entre os transportes: taxa de
  amostragem, codec, latência de rede e barge-in se comportam de formas distintas em
  WebRTC e em SIP. A abstração tem que ser desenhada com telefonia em mente desde o
  dia 1, mesmo sem ela existir — abstração descoberta depois costuma nascer errada.
- O orçamento de latência (`plano.md` §6.1) passa a ser medido por transporte, não
  uma vez só. Os números do WebRTC não valem para o telefone.
- Fase 4 pode nunca acontecer, e o projeto continua completo. Isso é intencional.

## Como saberei que errei

Se, ao plugar o primeiro transporte de telefonia, for preciso mudar código dentro do
orquestrador ou da máquina de estados — e não só escrever uma nova implementação da
interface. Isso significaria que a abstração foi desenhada para o caso que já existia
em vez de para os dois.
