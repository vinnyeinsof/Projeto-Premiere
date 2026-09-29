# Changelog — 2.4.1

## Hotfix Reels / Auto Reframe

- Corrigido o bug que podia deixar o Programa completamente preto em 9:16. `Motion > Position` passa a receber coordenadas normalizadas (`0.5, 0.5` = centro), e não coordenadas em pixels.
- O posicionamento do logo foi corrigido pelo mesmo motivo.
- A criação de `PointF` passou a usar o construtor com valores quando disponível, com fallback compatível.

## Interface

- O texto recomendado de cada preset agora aparece diretamente no campo **Pedido para a IA** e pode ser editado.
- Cada preset mantém um rascunho persistente próprio em `localStorage`.
- Modo Avançado continua fechado por padrão e, ao abrir, mostra subseções também recolhíveis.
- API Key/diagnóstico foram movidos para a última subseção do Modo Avançado.

## Brand Assets

- Novo botão **Selecionar pasta de Brand Assets**.
- A pasta é examinada por nomes usuais de logo e vinheta e os arquivos encontrados recebem tokens persistentes.
- Seleção individual de logo e vinheta continua disponível.

---

# Changelog — 2.4.0 (anterior)

## Interface

- Interface principal reduzida a **Preset + Direção criativa + Editar com IA**.
- Todos os controles técnicos foram movidos para **Modo Avançado**.
- Novo seletor de presets: Reels/TikTok, Evento/Apresentação, Fotos/Slideshow, Entrevista/Depoimento, YouTube, Institucional e Personalizado.
- Último preset fica persistido localmente.
- API Key continua fácil de alterar no final do painel.

## Contexto editorial

- Novo classificador contextual que diferencia conteúdo falado, visual/performance e misto.
- Transcrição deixou de ser tratada isoladamente como prova de conteúdo falado.
- Conteúdo visual prioriza ação, composição, reação, ritmo e música.
- Entrevista/talking head prioriza continuidade da fala e deixa música mais baixa.

## Auto Reframe / formatos

- Reels/TikTok agora força sequência **1080×1920 9:16**.
- Presets 16:9 usam **1920×1080** e quadrado pode usar **1080×1080** no modo avançado.
- Auto Reframe próprio: o plugin calcula a escala geométrica base a partir da sequência/escala original, o Gemini decide crop extra e Position inicial/final e a sequência nova recebe Scale/Position com keyframes quando há movimento.
- Ativar Auto Reframe manualmente força automaticamente a entrega para **1080×1920 / 9:16**, independentemente do preset/origem.
- Verificação pós-criação bloqueia entrega se o Premiere não aceitar o formato pedido.

## Transições

- Cross Dissolve ficou mais presente em conteúdo visual/evento.
- Fotos/stills recebem prioridade para dissolves e o preset Fotos/Slideshow aumenta deliberadamente a frequência, mantendo espaçamento mínimo para não empilhar transições.
- Entrevistas mantêm hard cuts em jump cuts curtos da mesma fonte.
- Dip to Black continua raro; Morph Cut continua proibido.

## Música

- Removida totalmente a abertura automática do Finder.
- Música só vem do projeto ou de pasta explicitamente escolhida pelo usuário.
- Loops agora alternam entre **A3/A4** com sobreposição e envelopes de volume para crossfade.
- Volume musical adapta-se ao perfil detectado: mais baixo sob fala, mais presente em conteúdo visual.

## Contexto da Marca

- Novo campo persistente em `localStorage`.
- Regras permanentes são anexadas ao final do `systemInstruction` em todas as edições.

## Branding automático

- Logo persistente por token, inserido em **V3** até o fim da montagem principal.
- Controle de Scale e posição do logo, agora persistentes entre projetos.
- Vinheta persistente por token, inserida em **V1/A1** ao final.
- Se houver limite de duração, a duração conhecida da vinheta é reservada antes da montagem principal e o QC final bloqueia qualquer entrega que ainda ultrapasse o contrato.

## Mantido e refinado

- Color grading conservador via Lumetri.
- Mixagem fina por take, agora ignorada quando o conteúdo é visual e não há fala relevante.
- Até 40 fontes com decupagem em lotes.
- QC determinístico de cobertura, duração, ranges e continuidade.
- Uso de proxy menor quando já anexado no Premiere.
- Nova sequência obrigatória e cleanup defensivo de execução parcial.
