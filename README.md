# Editor de video Vinicius 2.4.1

Editor contextual para Adobe Premiere Pro focado em automatizar montagem real: material bruto grande entra na timeline, o Gemini entende o conteúdo, decupa as fontes, monta a narrativa e o plugin executa tudo em uma nova sequência com acabamento técnico.

## Correções 2.4.1

- **Corrigido o monitor preto no preset Reels/TikTok.** O Motion > Position do Premiere usa coordenadas normalizadas, com o centro em `0.5, 0.5`. A 2.4.0 convertia o deslocamento para pixels (por exemplo `540, 960`), o que podia jogar o clipe completamente para fora do quadro. A 2.4.1 usa Position normalizada em todo o Auto Reframe e também no posicionamento do logo.
- O campo **Pedido para a IA** agora vem visivelmente pré-preenchido com a direção recomendada de cada preset. Cada preset mantém seu próprio rascunho local se você editar o texto.
- **Modo Avançado** virou um conjunto de seções recolhíveis: Material, Entrega, Acabamento, Contexto da Marca, Brand Assets, Música e Gemini/Diagnóstico.
- **Brand Assets** ganhou um botão claro para selecionar uma pasta contendo `logo.png`/`logo.jpg` e `vinheta_final.mp4`/`vinheta.mp4`/`outro.mp4`, além dos seletores individuais.
- A API Key foi movida para a seção **Gemini e diagnóstico**. Se não houver chave, essa seção abre automaticamente somente quando necessário.


## Interface simples

No uso normal aparecem apenas os controles essenciais:

1. **Preset de entrega**
2. **Direção criativa**
3. **EDITAR COM IA**

O restante fica dentro de **Modo Avançado**: formato, duração, cobertura, Auto Reframe, estilo, ritmo, qualidade da IA, color grading, mixagem, transições, música, branding, Contexto da Marca e diagnóstico.

A Direção criativa pode ficar vazia. Nesse caso o preset fornece uma direção automática adequada ao tipo de entrega.

## Presets

- **Reels / TikTok** — 1080×1920, 9:16, até 120 s, cobertura total ligada e Auto Reframe ligado.
- **Evento / apresentação** — 1920×1080, edição visual, dinâmica e orientada por música/ação.
- **Fotos / slideshow** — 1920×1080, leitura mais longa das imagens e Cross Dissolve mais frequente.
- **Entrevista / depoimento** — 1920×1080, fala como eixo narrativo e cortes naturais.
- **YouTube** — 1920×1080, narrativa longa e ritmo equilibrado.
- **Institucional** — 1920×1080, acabamento mais sóbrio e planos mais longos.
- **Personalizado** — mantém formato de origem por padrão e libera configuração manual.

O último preset escolhido fica salvo localmente.

## Contexto automático do conteúdo

A decupagem classifica os melhores trechos como `speech`, `action`, `visual`, `reaction`, `detail` ou `other`. O Director usa essa informação para inferir o tipo real de vídeo:

- **Fala / entrevista:** frases e continuidade mandam; música fica abaixo da voz; hard cuts, B-roll e punch-ins escondem jump cuts; dissolves são mais seletivos.
- **Visual / performance:** movimento, expressão, composição e progressão visual mandam; música pode conduzir a edição; Cross Dissolve aparece mais em mudanças de plano e fotos.
- **Misto:** fala importante prevalece quando existe, mas blocos puramente visuais podem respirar com a música.

A existência de uma transcrição, sozinha, não é tratada como prova de que o material é falado — isso evita confundir letras de música, plateia ou ruído com entrevista.

## Auto Reframe / entrega 9:16

A API UXP atual não expõe diretamente o comando nativo **Auto Reframe** do Premiere. Esta build implementa o equivalente dentro do motor:

1. o preset Reels/TikTok força a sequência final para **1080×1920 (9:16)**;
2. o plugin lê de forma não destrutiva a escala que o take tinha na timeline de origem e calcula a **escala geométrica base** necessária para cobrir o quadro vertical;
3. o Gemini decide apenas o crop criativo extra e o deslocamento do assunto, evitando superzoom desnecessário;
4. o plugin aplica **Scale + Position** na sequência nova;
5. se o foco se deslocar durante o take, Position pode receber keyframes entre início e fim;
6. se **Auto Reframe** for ativado manualmente em qualquer preset, a entrega passa automaticamente para **1080×1920 / 9:16**, independentemente da origem.

O arquivo original nunca é alterado.

## Transições

As transições agora são contextuais:

- conteúdo visual/evento recebe mais **Cross Dissolve**;
- fotos/stills têm prioridade para dissolves suaves;
- entrevista evita dissolve em jump cut curto da mesma pessoa;
- **Dip to Black** continua raro e reservado a mudanças fortes de bloco;
- B-roll recebe fades sutis quando possível;
- Morph Cut continua bloqueado por estabilidade.

## Música e crossfades

O plugin **nunca abre o Finder automaticamente** para pedir música.

Ele procura apenas:

- músicas já importadas no projeto; e/ou
- uma pasta que o usuário configurou manualmente em Modo Avançado.

Se não houver música, a edição simplesmente segue sem trilha.

Quando uma faixa precisa repetir, os loops são alternados entre **A3 e A4**, com sobreposição e envelopes de volume por keyframes para criar crossfades em vez de cortes secos. Em conteúdo falado a trilha fica mais baixa; em conteúdo visual ela pode ficar mais presente.

## Color grading e mixagem

### Color grading

O plugin procura Lumetri Color no catálogo real do Premiere e aplica correções conservadoras por take: exposição, temperatura, tint, contraste e saturação. Parâmetros não identificados com segurança são ignorados sem cancelar a edição.

### Mixagem fina

A API UXP não oferece um medidor LUFS/Auto Match completo. A build faz nivelamento relativo por take, baseado na análise multimodal, e suaviza diferenças grandes de ganho. Em conteúdo visual sem fala relevante, o motor não força tratamento de voz e deixa a música assumir papel maior.

- A1: áudio principal
- A2: áudio de B-roll/segunda câmera, silenciado quando necessário
- A3/A4: música e loops com crossfade

## Contexto da Marca

Em **Modo Avançado → Contexto da Marca** você pode salvar regras permanentes, por exemplo:

- tom de voz;
- identidade editorial;
- restrições visuais;
- estilo de campanha;
- regras sobre transições, ritmo e linguagem.

O texto fica no `localStorage` e é anexado invisivelmente ao `systemInstruction` em todas as edições até ser alterado/removido.

## Branding automático

Em **Brand Assets** você pode configurar uma vez:

- `logo.png`/JPG/WebP;
- `vinheta_final.mp4`/MOV/M4V.

Os arquivos são lembrados por `createPersistentToken`.

Quando Branding automático está ligado:

- o logo é importado e colocado em **V3**, do início até o fim da montagem principal;
- Scale e Position seguem os controles do painel e também ficam salvos localmente;
- a vinheta é inserida em **V1/A1** exatamente após o último corte principal;
- se houver um limite de duração, a duração da vinheta é reservada **antes** da montagem; se o resultado final ainda ultrapassar o contrato, o QC bloqueia a entrega em vez de aceitar um vídeo acima do limite.

## Segurança

- A edição automática só roda em **nova sequência**.
- O formato de entrega é verificado depois da criação; se 9:16 não puder ser aplicado, a execução é bloqueada em vez de entregar uma sequência errada.
- API Key fica no `SecureStorage` e pode ser trocada no final do painel.
- Rede liberada apenas para a Gemini API.
- QC valida ranges, cobertura, duração e continuidade antes/depois da montagem.
- Falhas de grading, branding, música ou transição são tratadas de forma defensiva para preservar a edição principal.
- Máximo defensivo: 40 fontes únicas por análise multimodal.

## Teste recomendado

Para seu caso comum, escolha **Reels / TikTok**, deixe a Direção criativa vazia ou escreva algo simples como:

> Faça um vídeo forte com os melhores momentos e um pouco de todo o material.

Confirme no log:

- `Contexto automático`
- `Decupagem multi-pass`
- `QC de entrega`
- `Formato de entrega forçado: 1080×1920`
- `Auto Reframe`
- `Plano de transições contextual`
- `Color grading`
- `Mixagem fina`
- `Branding concluído`
- `Continuidade V1 verificada`
