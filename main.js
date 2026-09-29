const ppro = require("premierepro");
const { entrypoints, storage } = require("uxp");
const fs = require("fs");

const secureStorage = storage.secureStorage;
const localFileSystem = storage.localFileSystem;

const KEY_NAME = "spark-premiere-gemini-key-v2";
const CACHE_NAME = "vinicius-gemini-file-cache-v5";
const MUSIC_FOLDER_TOKEN = "vinicius-editor-music-folder-token";
const BRAND_CONTEXT_KEY = "vinicius-editor-brand-context-v1";
const BRAND_LOGO_TOKEN = "vinicius-editor-brand-logo-token-v1";
const BRAND_OUTRO_TOKEN = "vinicius-editor-brand-outro-token-v1";
const BRAND_LOGO_SCALE_KEY = "vinicius-editor-brand-logo-scale-v1";
const BRAND_LOGO_POSITION_KEY = "vinicius-editor-brand-logo-position-v1";
const PRESET_PROMPT_KEY_PREFIX = "vinicius-editor-preset-prompt-v1:";
const MAX_VIDEO_FILES = 40;
const SCOUT_BATCH_SIZE = 5;
const MAX_MUSIC_FILES = 8;
const AUDIO_EXTENSIONS = new Set(["mp3","wav","m4a","aac","aif","aiff","flac","ogg"]);
const IMAGE_EXTENSIONS = new Set(["png","jpg","jpeg","webp","tif","tiff","bmp","gif"]);
const CHUNK_SIZE = 8 * 1024 * 1024;
const BUILD_VARIANT = {
  code: "DIRECTOR_2_4_1",
  name: "Director 2.4.1 Context + Brand + Reframe",
  zoomPattern: [108, 110, 106],
  plannerRules: "Adapte a linguagem editorial ao conteúdo real antes de montar. Em fala, preserve frases e intenção; em conteúdo visual, priorize ação, variedade, ritmo musical e transições elegantes. Respeite o preset de entrega, cobertura e duração como restrições reais. O acabamento técnico deve manter cor natural, áudio coerente e enquadramento adequado ao formato final."
};

const DELIVERY_PRESETS = {
  reels: { label:"Reels / TikTok", aspect:"9:16", duration:120, requireAll:true, style:"tiktok", intensity:"balanced", autoReframe:true, defaultPrompt:"Monte um Reels/TikTok profissional com os melhores momentos. Use um pouco de todo o material, retire erros e repetições e preserve o que realmente importa. Adapte automaticamente a edição se o conteúdo for falado, visual ou misto." },
  event: { label:"Evento / apresentação", aspect:"16:9", duration:180, requireAll:true, style:"visual", intensity:"dynamic", autoReframe:false, defaultPrompt:"Crie um highlight envolvente do evento/apresentação. Priorize os melhores momentos visuais, variedade de planos, emoção e sincronismo com a música. Não procure fala onde ela não é importante." },
  photos: { label:"Fotos / slideshow", aspect:"16:9", duration:120, requireAll:true, style:"visual", intensity:"natural", autoReframe:false, defaultPrompt:"Monte um slideshow elegante e envolvente usando as melhores fotos e um pouco de todo o material. Dê tempo para cada imagem ser lida, use Cross Dissolve com frequência e deixe a música conduzir o ritmo sem transições chamativas." },
  interview: { label:"Entrevista / depoimento", aspect:"16:9", duration:0, requireAll:false, style:"talking", intensity:"balanced", autoReframe:false, defaultPrompt:"Edite a entrevista/depoimento preservando a naturalidade da fala. Retire erros, recomeços, redundâncias e pausas mortas; use B-roll e mudanças de enquadramento apenas quando ajudarem a narrativa." },
  youtube: { label:"YouTube", aspect:"16:9", duration:0, requireAll:false, style:"talking", intensity:"balanced", autoReframe:false, defaultPrompt:"Monte uma edição para YouTube com narrativa clara, ritmo consistente e cortes naturais. Preserve contexto e use recursos visuais somente quando agregarem." },
  institutional: { label:"Institucional", aspect:"16:9", duration:0, requireAll:false, style:"institutional", intensity:"natural", autoReframe:false, defaultPrompt:"Crie uma edição institucional moderna, elegante e clara. Preserve credibilidade, contexto e planos fortes; use transições suaves e acabamento discreto." },
  custom: { label:"Personalizado", aspect:"source", duration:0, requireAll:false, style:"tiktok", intensity:"balanced", autoReframe:false, defaultPrompt:"Edite o material seguindo minha direção criativa e adaptando automaticamente a estratégia ao contexto real do vídeo." }
};

const state = {
  project: null,
  sourceSequence: null,
  targetSequence: null,
  timelineItems: [],
  sources: [],
  sourceById: new Map(),
  effectCatalog: [],
  musicCandidates: [],
  styleStats: { punchIns: 0, transitionsApplied: 0, transitionsSkipped: 0, colorGraded: 0, colorSkipped: 0, voiceMixed: 0, voiceMixSkipped: 0, autoReframed: 0, brandingAdded: 0, musicCrossfades: 0, musicAdded: false, musicFile: "", musicVolumeDb: null, sourcesUsed: 0, finalDuration: 0 },
  contentProfile: { mode:"mixed", speechScore:0.5, visualScore:0.5, label:"misto" },
  brandAssets: { logoEntry:null, logoProjectItem:null, outroEntry:null, outroProjectItem:null, outroDurationSec:0 },
  running: false
};

const $ = (id) => document.getElementById(id);
const el = {};
let activePromptPreset = null;

function wireElements() {
  ["appStatus","advancedMode","geminiAdvancedSection","brandAssetsSection","keySetup","apiKey","apiKeyStatus","saveKey","cancelKey","projectName","sequenceName","timelineCount","sourceCount","refresh","deliveryPreset","simplePresetSummary","outputAspect","stylePreset","styleHint","editIntensity","prompt","durationLimit","optRequireAllSources","optAutoReframe","optAnalyzeVideo","optNewSequence","optMusic","optMusicCrossfade","optStyle","optTransitions","optForceFinish","optColorGrade","optFineMix","optBranding","brandContext","saveBrandContext","brandContextStatus","chooseBrandFolder","chooseLogo","clearLogo","logoStatus","chooseOutro","clearOutro","outroStatus","logoScale","logoPosition","editAI","progressWrap","progressBar","progressText","result","qualityMode","qualityHint","activeModel","contextCacheStatus","changeKey","clearCache","chooseMusicFolder","clearMusicFolder","musicFolderStatus","log"].forEach((id) => el[id] = $(id));
  if (el.editIntensity) {
    el.editIntensity.addEventListener("change", () => {
      const v = el.editIntensity.value;
      if (el.intensityHint) el.intensityHint.textContent = v === "natural"
        ? "Natural: preserva mais cadência, respiração e planos longos."
        : v === "dynamic"
          ? "Dinâmico: remove mais gordura, mas mantém frases inteiras e evita microcortes."
          : "Equilibrado: remove gordura sem transformar cada frase em jump cut.";
    });
  }
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  if (el.log) {
    el.log.textContent += `\n${line}`;
    el.log.scrollTop = el.log.scrollHeight;
  }
}

function status(text, kind = "idle") {
  if (!el.appStatus) return;
  el.appStatus.textContent = text;
  el.appStatus.className = `pill ${kind}`;
}

function result(text) {
  if (el.result) el.result.textContent = text;
}

function progress(percent, text) {
  if (!el.progressWrap) return;
  el.progressWrap.classList.remove("hidden");
  el.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  el.progressText.textContent = text;
}

function hideProgressLater() {
  setTimeout(() => {
    if (!state.running && el.progressWrap) el.progressWrap.classList.add("hidden");
  }, 2500);
}

function friendlyError(error) {
  const message = error?.message || String(error);
  status("Erro", "error");
  result(`❌ ${message}`);
  log(`ERRO: ${error?.stack || message}`);
  return message;
}

function bytesToString(value) {
  if (!value) return "";
  try { return new TextDecoder("utf-8").decode(value); }
  catch (_) { return Array.from(value).map(n => String.fromCharCode(n)).join(""); }
}

function mimeFromPath(path) {
  const ext = String(path).split(".").pop().toLowerCase();
  const map = {
    mp4:"video/mp4", m4v:"video/mp4", mov:"video/quicktime", avi:"video/x-msvideo",
    webm:"video/webm", mpg:"video/mpeg", mpeg:"video/mpeg", mts:"video/mp2t", m2ts:"video/mp2t",
    mxf:"application/mxf", mp3:"audio/mpeg", wav:"audio/wav", m4a:"audio/mp4", aac:"audio/aac",
    aif:"audio/aiff", aiff:"audio/aiff", flac:"audio/flac", ogg:"audio/ogg",
    png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", tif:"image/tiff", tiff:"image/tiff", bmp:"image/bmp", gif:"image/gif"
  };
  return map[ext] || "video/mp4";
}

function basename(path) {
  return String(path || "").replace(/\\/g,"/").split("/").pop() || "video";
}

function normalizePath(path) {
  return String(path || "").replace(/\\/g,"/");
}

function extensionFromPath(path) {
  return String(path || "").split(".").pop().toLowerCase();
}

function isImagePath(path) {
  return IMAGE_EXTENSIONS.has(extensionFromPath(path));
}

function mediaKindFromPath(path) {
  return isImagePath(path) ? "image" : "video";
}


function currentPreset() {
  return DELIVERY_PRESETS[el.deliveryPreset?.value || "reels"] || DELIVERY_PRESETS.reels;
}

function updateSimplePresetSummary() {
  if (!el.simplePresetSummary) return;
  const p = currentPreset();
  const aspect = el.outputAspect?.value || p.aspect;
  const duration = Number(el.durationLimit?.value || p.duration || 0);
  const coverage = el.optRequireAllSources?.checked ? "cobertura total" : "melhores fontes";
  el.simplePresetSummary.textContent = `${p.label} · ${aspect === "source" ? "formato da origem" : aspect}${duration ? ` · até ${duration >= 60 ? (duration/60).toFixed(duration%60?1:0)+" min" : duration+" s"}` : " · duração livre"} · ${coverage}`;
}

function applyDeliveryPreset(value, force = true) {
  const p = DELIVERY_PRESETS[value] || DELIVERY_PRESETS.reels;
  if (force) {
    if (el.outputAspect) el.outputAspect.value = p.aspect;
    if (el.durationLimit) el.durationLimit.value = String(p.duration);
    if (el.optRequireAllSources) el.optRequireAllSources.checked = Boolean(p.requireAll);
    if (el.stylePreset) el.stylePreset.value = p.style;
    if (el.editIntensity) el.editIntensity.value = p.intensity;
    if (el.optAutoReframe) el.optAutoReframe.checked = Boolean(p.autoReframe);
  }
  updateStyleHint();
  updateSimplePresetSummary();
}

function presetPromptStorageKey(value) {
  return `${PRESET_PROMPT_KEY_PREFIX}${value || "reels"}`;
}

function savePromptDraft(value = activePromptPreset) {
  if (!value || !el.prompt) return;
  localStorage.setItem(presetPromptStorageKey(value), String(el.prompt.value || ""));
}

function loadPromptForPreset(value, savePrevious = true) {
  if (!el.prompt) return;
  if (savePrevious && activePromptPreset && activePromptPreset !== value) savePromptDraft(activePromptPreset);
  const p = DELIVERY_PRESETS[value] || DELIVERY_PRESETS.reels;
  const stored = localStorage.getItem(presetPromptStorageKey(value));
  el.prompt.value = stored !== null ? stored : p.defaultPrompt;
  activePromptPreset = value;
}

function resolveInstruction() {
  const typed = String(el.prompt?.value || "").trim();
  return typed || currentPreset().defaultPrompt;
}

function loadBrandContext() {
  const text = String(localStorage.getItem(BRAND_CONTEXT_KEY) || "");
  if (el.brandContext) el.brandContext.value = text;
  if (el.brandContextStatus) el.brandContextStatus.textContent = text ? "Contexto salvo e ativo em todas as edições." : "Nenhum contexto permanente salvo.";
  return text;
}

function saveBrandContext() {
  const text = String(el.brandContext?.value || "").trim();
  if (text) localStorage.setItem(BRAND_CONTEXT_KEY, text);
  else localStorage.removeItem(BRAND_CONTEXT_KEY);
  if (el.brandContextStatus) el.brandContextStatus.textContent = text ? "Contexto salvo e ativo em todas as edições." : "Contexto removido.";
  result(text ? "✓ Contexto da Marca salvo." : "Contexto da Marca removido.");
  return text;
}

function loadBrandLayout() {
  const scale=String(localStorage.getItem(BRAND_LOGO_SCALE_KEY) || "18");
  const position=String(localStorage.getItem(BRAND_LOGO_POSITION_KEY) || "top-right");
  if(el.logoScale) el.logoScale.value=scale;
  if(el.logoPosition && [...el.logoPosition.options].some(o=>o.value===position)) el.logoPosition.value=position;
}

function saveBrandLayout() {
  const scale=String(clampNumber(String(el.logoScale?.value||"18").replace(",","."),5,60,18));
  const position=String(el.logoPosition?.value||"top-right");
  localStorage.setItem(BRAND_LOGO_SCALE_KEY,scale);
  localStorage.setItem(BRAND_LOGO_POSITION_KEY,position);
  if(el.logoScale) el.logoScale.value=scale;
}

async function choosePersistentAsset(tokenKey, types, label) {
  const entry = await localFileSystem.getFileForOpening({ types });
  if (!entry) return null;
  const token = await localFileSystem.createPersistentToken(entry);
  localStorage.setItem(tokenKey, token);
  await updateBrandAssetStatus();
  result(`✓ ${label} salvo para as próximas edições.`);
  return entry;
}

async function chooseBrandAssetsFolder() {
  const folder = await localFileSystem.getFolder();
  if (!folder) return null;
  const entries = await folder.getEntries();
  const files = entries.filter(entry => entry?.isFile);
  const byName = files.map(entry => ({ entry, name:String(entry.name || "").toLowerCase() }));
  const logoPatterns = [
    /^logo\.(png|jpe?g|webp)$/i, /^logo[_ -].+\.(png|jpe?g|webp)$/i, /marca.*\.(png|jpe?g|webp)$/i
  ];
  const outroPatterns = [
    /^vinheta[_ -]?final\.(mp4|mov|m4v)$/i, /^vinheta\.(mp4|mov|m4v)$/i, /^outro\.(mp4|mov|m4v)$/i, /vinheta.*\.(mp4|mov|m4v)$/i
  ];
  const findFirst = patterns => byName.find(row => patterns.some(re => re.test(row.name)))?.entry || null;
  const logo = findFirst(logoPatterns);
  const outro = findFirst(outroPatterns);
  if (!logo && !outro) {
    result("⚠️ Não encontrei logo/vinheta nessa pasta. Use nomes como logo.png e vinheta_final.mp4, ou selecione os arquivos individualmente.");
    return folder;
  }
  if (logo) localStorage.setItem(BRAND_LOGO_TOKEN, await localFileSystem.createPersistentToken(logo));
  if (outro) localStorage.setItem(BRAND_OUTRO_TOKEN, await localFileSystem.createPersistentToken(outro));
  await updateBrandAssetStatus();
  const found=[]; if(logo) found.push(`logo: ${logo.name}`); if(outro) found.push(`vinheta: ${outro.name}`);
  result(`✓ Brand Assets configurados (${found.join(" · ")}).`);
  return folder;
}

async function getPersistentAsset(tokenKey) {
  const token = localStorage.getItem(tokenKey);
  if (!token) return null;
  try {
    const entry = await localFileSystem.getEntryForPersistentToken(token);
    return entry?.isFile ? entry : null;
  } catch (_) {
    localStorage.removeItem(tokenKey);
    return null;
  }
}

async function clearPersistentAsset(tokenKey, label) {
  localStorage.removeItem(tokenKey);
  await updateBrandAssetStatus();
  result(`${label} removido do branding automático.`);
}

async function updateBrandAssetStatus() {
  const logo = await getPersistentAsset(BRAND_LOGO_TOKEN);
  const outro = await getPersistentAsset(BRAND_OUTRO_TOKEN);
  if (el.logoStatus) el.logoStatus.textContent = logo ? `Configurado: ${logo.name}` : "Nenhum logo configurado.";
  if (el.outroStatus) el.outroStatus.textContent = outro ? `Configurada: ${outro.name}` : "Nenhuma vinheta configurada.";
  return { logo, outro };
}

async function loadKey() {
  try {
    const raw = await secureStorage.getItem(KEY_NAME);
    return bytesToString(raw).trim();
  } catch (_) {
    return "";
  }
}

async function updateApiKeyStatus() {
  const key = await loadKey();
  if (el.apiKeyStatus) el.apiKeyStatus.textContent = key
    ? "Chave configurada e protegida no SecureStorage."
    : "Nenhuma chave configurada. Clique em “Alterar API Key” para adicionar.";
  return Boolean(key);
}

async function saveKey() {
  const key = el.apiKey.value.trim();
  if (!key) throw new Error("Cole uma Gemini API Key.");
  await secureStorage.setItem(KEY_NAME, key);
  el.apiKey.value = "";
  el.keySetup?.classList.add("hidden");
  await updateApiKeyStatus();
  result("🔐 API Key salva com segurança.");
}

function revealApiKeyEditor() {
  if (el.advancedMode) el.advancedMode.open = true;
  if (el.geminiAdvancedSection) el.geminiAdvancedSection.open = true;
  el.keySetup?.classList.remove("hidden");
  el.apiKey?.focus();
}

async function showKeySetupIfNeeded() {
  const hasKey = await updateApiKeyStatus();
  if (!hasKey) {
    revealApiKeyEditor();
    result("Configure sua Gemini API Key em Modo Avançado → Gemini e diagnóstico para começar.");
  } else {
    el.keySetup?.classList.add("hidden");
  }
}

async function scanTimeline() {
  status("Lendo timeline…", "working");
  state.project = await ppro.Project.getActiveProject();
  if (!state.project) throw new Error("Abra um projeto no Premiere.");

  state.sourceSequence = await state.project.getActiveSequence();
  if (!state.sourceSequence) throw new Error("Abra a sequência que contém os vídeos brutos.");

  const timelineItems = [];
  const sourceMap = new Map();
  const vCount = await state.sourceSequence.getVideoTrackCount();

  for (let trackIndex = 0; trackIndex < vCount; trackIndex++) {
    const track = await state.sourceSequence.getVideoTrack(trackIndex);
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);

    for (let i = 0; i < items.length; i++) {
      const trackItem = items[i];
      try {
        const projectItem = await trackItem.getProjectItem();
        const clip = ppro.ClipProjectItem.cast(projectItem);
        if (!clip || await clip.isSequence()) continue;
        const path = await clip.getMediaFilePath();
        if (!path) continue;

        const sourceId = String(projectItem.getId());
        const start = Number((await trackItem.getStartTime()).seconds || 0);
        const end = Number((await trackItem.getEndTime()).seconds || 0);
        const inPoint = Number((await trackItem.getInPoint()).seconds || 0);
        const outPoint = Number((await trackItem.getOutPoint()).seconds || 0);
        const name = await trackItem.getName();

        const rec = {
          itemKey: `${sourceId}:${trackIndex}:${start.toFixed(4)}:${i}`,
          sourceId, name, path, projectItem, clipProjectItem: clip,
          trackIndex, timelineStart: start, timelineEnd: end,
          sourceIn: inPoint, sourceOut: outPoint
        };
        timelineItems.push(rec);

        if (!sourceMap.has(sourceId)) {
          sourceMap.set(sourceId, {
            sourceId,
            name: projectItem.name || name,
            path,
            mediaKind: mediaKindFromPath(path),
            projectItem,
            clipProjectItem: clip,
            baselineTrackItem: trackItem,
            allowedRanges: [],
            timelineAppearances: []
          });
        }
        sourceMap.get(sourceId).allowedRanges.push({ start: inPoint, end: outPoint, timelineTrack: trackIndex });
        sourceMap.get(sourceId).timelineAppearances.push({ timelineStart:start, timelineEnd:end, sourceIn:inPoint, sourceOut:outPoint, videoTrack:trackIndex });
      } catch (error) {
        log(`Clip ignorado na V${trackIndex + 1}: ${error.message || error}`);
      }
    }
  }

  if (!timelineItems.length) throw new Error("Não encontrei vídeos na timeline ativa.");

  state.timelineItems = timelineItems.sort((a,b) => a.timelineStart - b.timelineStart);
  state.sources = [...sourceMap.values()];
  state.sourceById = sourceMap;

  el.projectName.textContent = state.project.name || "Sem nome";
  el.sequenceName.textContent = state.sourceSequence.name || "Sem nome";
  el.timelineCount.textContent = String(state.timelineItems.length);
  el.sourceCount.textContent = String(state.sources.length);

  try {
    const names = ppro.VideoFilterFactory?.getMatchNames ? await ppro.VideoFilterFactory.getMatchNames() : [];
    const displays = ppro.VideoFilterFactory?.getDisplayNames ? await ppro.VideoFilterFactory.getDisplayNames() : [];
    state.effectCatalog = names.map((matchName, i) => ({ matchName, displayName: displays[i] || matchName }));
  } catch (_) { state.effectCatalog = []; }

  status("Timeline pronta", "ok");
  log(`Timeline: ${state.timelineItems.length} itens, ${state.sources.length} fontes.`);
  return state.sources;
}

async function collectPremiereTranscripts() {
  const out = [];
  if (!ppro.Transcript?.exportToJSON) return out;
  for (const source of state.sources) {
    try {
      if (ppro.Transcript.hasTranscript && !ppro.Transcript.hasTranscript(source.clipProjectItem)) continue;
      const text = await ppro.Transcript.exportToJSON(source.clipProjectItem);
      if (!text) continue;
      let parsed = text;
      try { parsed = JSON.parse(text); } catch (_) {}
      out.push({ sourceId: source.sourceId, name: source.name, transcript: parsed });
    } catch (_) {}
  }
  return out;
}

function getFileCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_NAME) || "{}"); }
  catch (_) { return {}; }
}

function saveFileCache(cache) {
  const entries = Object.entries(cache).slice(-80);
  localStorage.setItem(CACHE_NAME, JSON.stringify(Object.fromEntries(entries)));
}

function qualityModelChain() {
  const mode = el.qualityMode?.value || "pro";
  return mode === "pro"
    ? ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"]
    : ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
}

function isGemini3Model(model) {
  return /^gemini-3(?:\.|-)/i.test(String(model || ""));
}

function generationConfigForModel(model, schema, purpose = "planner") {
  const config = {
    responseMimeType: "application/json",
    responseSchema: schema
  };

  if (isGemini3Model(model)) {
    const pro = el.qualityMode?.value === "pro";
    config.thinkingConfig = {
      thinkingLevel: purpose === "scout" ? "low" : (pro ? "medium" : "low")
    };
  } else {
    // Sampling fica somente nos modelos 2.x. Gemini 3.6/3.7 rejeita
    // temperature/topP na API atual.
    config.temperature = purpose === "scout" ? 0.12 : 0.22;
    config.topP = purpose === "scout" ? 0.82 : 0.90;
  }
  return config;
}

async function clearAllGeminiCaches() {
  localStorage.removeItem(CACHE_NAME);
  // Remove também o índice legado de Context Cache de builds antigas;
  // não há mais criação/deleção de cachedContents nesta versão.
  localStorage.removeItem("vinicius-gemini-context-cache-v1");
  localStorage.removeItem("vinicius-gemini-file-cache-v4");
  if (el.contextCacheStatus) el.contextCacheStatus.textContent = "uploads reutilizáveis";
  result("Cache local de uploads do Gemini apagado.");
}

function fileStateName(file) {
  if (!file) return "";
  if (typeof file.state === "string") return file.state;
  return file.state?.name || "";
}

async function getGeminiFile(name, apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) return null;
  return await res.json();
}

async function waitGeminiFileActive(file, apiKey, label) {
  let current = file;
  for (let i = 0; i < 120; i++) {
    const s = fileStateName(current);
    if (s === "ACTIVE" || !s) return current;
    if (s === "FAILED") throw new Error(`Gemini não conseguiu processar ${label}.`);
    await new Promise(r => setTimeout(r, 2000));
    current = await getGeminiFile(current.name, apiKey);
    if (!current) throw new Error(`O upload de ${label} deixou de existir na API Gemini.`);
  }
  throw new Error(`Tempo excedido processando ${label} no Gemini.`);
}

async function resolveAnalysisPath(source) {
  const originalPath = normalizePath(source?.path || "");
  if (!source?.clipProjectItem || !originalPath) return originalPath;

  try {
    if (!source.clipProjectItem.hasProxy || !await source.clipProjectItem.hasProxy()) return originalPath;
    const proxyPath = normalizePath(await source.clipProjectItem.getProxyPath());
    if (!proxyPath) return originalPath;

    const [originalStats, proxyStats] = await Promise.all([
      fs.lstat(originalPath).catch(() => null),
      fs.lstat(proxyPath).catch(() => null)
    ]);
    const proxySize = Number(proxyStats?.size || 0);
    const originalSize = Number(originalStats?.size || 0);
    if (proxySize > 0 && (!originalSize || proxySize < originalSize)) {
      log(`Proxy usado na análise: ${source.name} (${(proxySize/1024/1024).toFixed(0)} MB em vez de ${(originalSize/1024/1024).toFixed(0)} MB).`);
      return proxyPath;
    }
  } catch (error) {
    log(`Proxy de ${source.name} não pôde ser usado: ${error.message || error}`);
  }
  return originalPath;
}

async function uploadVideo(source, apiKey, index, total, progressBase = 5, progressSpan = 37) {
  const path = await resolveAnalysisPath(source);
  const stats = await fs.lstat(path);
  const size = Number(stats.size || 0);
  if (!size) throw new Error(`Arquivo vazio ou inacessível: ${source.name}`);
  if (size > 2 * 1024 * 1024 * 1024) throw new Error(`${source.name} tem mais de 2 GB para análise. Anexe um proxy menor no Premiere ou reduza o arquivo de análise.`);

  const mtime = Number(stats.mtimeMs || stats.mtime?.getTime?.() || 0);
  const cacheKey = `${path}|${size}|${mtime}`;
  const cache = getFileCache();
  if (cache[cacheKey]?.name) {
    const remote = await getGeminiFile(cache[cacheKey].name, apiKey);
    if (remote && fileStateName(remote) === "ACTIVE") {
      log(`Usando upload em cache: ${source.name}`);
      return remote;
    }
  }

  progress(progressBase + Math.round((index / Math.max(1,total)) * progressSpan), `Enviando ${source.name} para o Gemini…`);
  const mime = mimeFromPath(path);
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ file: { display_name: `${source.sourceId}__${basename(path)}` } })
  });
  if (!start.ok) throw new Error(`Falha iniciando upload de ${source.name}: HTTP ${start.status}`);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini não retornou URL de upload resumível.");

  const fd = await fs.open(path, "r");
  let offset = 0;
  let finalFile = null;
  try {
    while (offset < size) {
      const length = Math.min(CHUNK_SIZE, size - offset);
      const buffer = new ArrayBuffer(length);
      const readResult = await fs.read(fd, buffer, 0, length, offset);
      const bytesRead = Number(readResult.bytesRead || 0);
      if (!bytesRead) throw new Error(`Falha lendo ${source.name} em ${offset}.`);
      const isLast = offset + bytesRead >= size;
      const body = bytesRead === length ? buffer : buffer.slice(0, bytesRead);
      const up = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Length": String(bytesRead),
          "X-Goog-Upload-Offset": String(offset),
          "X-Goog-Upload-Command": isLast ? "upload, finalize" : "upload"
        },
        body
      });
      if (!up.ok) throw new Error(`Falha no upload de ${source.name}: HTTP ${up.status}`);
      offset += bytesRead;
      const filePct = offset / size;
      const base = progressBase + (index / Math.max(1,total)) * progressSpan;
      progress(Math.round(base + filePct * (progressSpan / Math.max(1,total))), `Enviando ${source.name}: ${Math.round(filePct * 100)}%`);
      if (isLast) {
        const data = await up.json();
        finalFile = data.file || data;
      }
    }
  } finally {
    await fs.close(fd);
  }

  if (!finalFile?.name) throw new Error(`Upload finalizado sem referência para ${source.name}.`);
  finalFile = await waitGeminiFileActive(finalFile, apiKey, source.name);
  cache[cacheKey] = { name: finalFile.name, uri: finalFile.uri, mime_type: finalFile.mimeType || finalFile.mime_type || mime, at: Date.now() };
  saveFileCache(cache);
  return finalFile;
}

async function uploadTimelineSources(apiKey) {
  const sources = state.sources.slice(0, MAX_VIDEO_FILES);
  if (state.sources.length > MAX_VIDEO_FILES) log(`Limite defensivo: ${MAX_VIDEO_FILES} arquivos únicos por edição. A timeline possui ${state.sources.length}; os excedentes não serão analisados.`);
  const uploaded = [];
  for (let i = 0; i < sources.length; i++) {
    const file = await uploadVideo(sources[i], apiKey, i, sources.length);
    uploaded.push({ source: sources[i], file });
  }
  log(`✓ Upload/arquivo remoto pronto para ${uploaded.length}/${sources.length} fonte(s). A análise será feita em lotes de ${SCOUT_BATCH_SIZE}, não apenas nos primeiros vídeos.`);
  return uploaded;
}

function plannerSchema() {
  return {
    type: "object",
    required: ["summary","cuts","music"],
    properties: {
      summary: { type: "string" },
      cuts: {
        type: "array",
        items: {
          type: "object",
          required: ["sourceId","inPoint","outPoint","timelineStart","videoTrack","audioTrack","role","punchIn","transitionIn","confidence","reason"],
          properties: {
            sourceId: { type: "string" },
            inPoint: { type: "number" },
            outPoint: { type: "number" },
            timelineStart: { type: "number" },
            videoTrack: { type: "integer" },
            audioTrack: { type: "integer" },
            role: { type: "string", enum: ["a-roll","b-roll"] },
            punchIn: { type: "number", minimum: 100, maximum: 112 },
            transitionIn: { type: "string", enum: ["none","cross_dissolve","dip_black"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" }
          }
        }
      },
      music: {
        type: "object",
        required: ["use","candidateId","trimStart","volumeDb","reason"],
        properties: {
          use: { type: "boolean" },
          candidateId: { type: "string" },
          trimStart: { type: "number", minimum: 0 },
          volumeDb: { type: "number", minimum: -36, maximum: -14 },
          reason: { type: "string" }
        }
      }
    }
  };
}
function sourceContext() {
  return state.sources.map(s => ({
    sourceId: s.sourceId,
    name: s.name,
    mediaKind: s.mediaKind || mediaKindFromPath(s.path),
    allowedRanges: s.allowedRanges,
    timelineAppearances: s.timelineAppearances || []
  }));
}


function parseEditIntent(instruction) {
  const raw = String(instruction || "");
  const text = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const promptRequiresAll = /um\s+pouco\s+de\s+cada|todos?\s+(?:os\s+)?videos|cada\s+(?:um\s+dos\s+)?videos|todos?.{0,40}time\s*line|time\s*line.{0,40}todos?/.test(text);
  const requireAllSources = Boolean(el.optRequireAllSources?.checked || promptRequiresAll);
  const promptRequestsTransitions = /transic(?:ao|oes)|cross\s*dissolve|dip\s*to\s*black|dissolver|dissolve/.test(text);
  const requestTransitions = Boolean(el.optTransitions?.checked || promptRequestsTransitions);
  const requestEffects = /efeito|effects|acabamento|dinamic|reframe|zoom|punch/.test(text) || Boolean(el.optStyle?.checked && el.optForceFinish?.checked);
  const requestColorGrade = el.optColorGrade ? Boolean(el.optColorGrade.checked) : /color\s*grad|grading|corre[cç][aã]o\s+de\s+cor|corrigir\s+cor|lumetri/.test(text);
  const requestFineMix = el.optFineMix ? Boolean(el.optFineMix.checked) : /mixagem|mix\s+de\s+audio|nivelar\s+(?:a\s+)?voz|normalizar\s+(?:a\s+)?voz|audio\s+fine/.test(text);

  let explicitDurationSec = null;
  let m = text.match(/(?:maximo|ate|no\s+maximo|limite(?:\s+de)?)?\s*(\d+(?:[\.,]\d+)?)\s*(?:minutos?|mins?|min\b)/);
  if (m) explicitDurationSec = Number(String(m[1]).replace(",", ".")) * 60;
  if (!explicitDurationSec) {
    m = text.match(/(?:maximo|ate|no\s+maximo|limite(?:\s+de)?)?\s*(\d+(?:[\.,]\d+)?)\s*(?:segundos?|segs?|sec\b)/);
    if (m) explicitDurationSec = Number(String(m[1]).replace(",", "."));
  }
  if (!Number.isFinite(explicitDurationSec) || explicitDurationSec <= 0) explicitDurationSec = null;

  const uiDurationSec = Number(el.durationLimit?.value || 0);
  const maxDurationSec = explicitDurationSec || (Number.isFinite(uiDurationSec) && uiDurationSec > 0 ? uiDurationSec : null);
  const sourceCount = state.sources.length;
  const targetMaxSec = maxDurationSec ? Math.max(3, maxDurationSec - 1.0) : null;
  let targetGoalSec = maxDurationSec ? Math.max(8, maxDurationSec * 0.94) : null;
  let targetMinSec = maxDurationSec ? Math.max(6, maxDurationSec * 0.86) : null;

  if (requireAllSources && maxDurationSec) {
    const practicalPerSource = Math.max(0.75, Math.min(2.2, targetMaxSec / Math.max(1, sourceCount)));
    const minimumCoverage = Math.min(targetMaxSec, sourceCount * practicalPerSource);
    targetMinSec = Math.min(targetMaxSec, Math.max(targetMinSec, minimumCoverage));
    targetGoalSec = Math.min(targetMaxSec, Math.max(targetGoalSec, Math.min(targetMaxSec, sourceCount * 4.5)));
  }

  const deliveryPreset = el.deliveryPreset?.value || "reels";
  const autoReframe = Boolean(el.optAutoReframe?.checked);
  // Neste produto, Auto Reframe significa entrega vertical real: ativou => 1080×1920, independentemente da origem.
  const outputAspect = autoReframe ? "9:16" : (el.outputAspect?.value || currentPreset().aspect || "source");
  if (autoReframe && el.outputAspect && el.outputAspect.value !== "9:16") el.outputAspect.value = "9:16";
  const brandContext = String(localStorage.getItem(BRAND_CONTEXT_KEY) || "").trim();

  return {
    requireAllSources, requestTransitions, promptRequestsTransitions, requestEffects, requestColorGrade, requestFineMix,
    maxDurationSec, explicitDurationSec, targetMaxSec, targetGoalSec, targetMinSec, sourceCount,
    deliveryPreset, outputAspect, autoReframe, brandContext
  };
}

function scoutSchema() {
  return {
    type: "object",
    required: ["sources"],
    properties: {
      sources: {
        type: "array",
        items: {
          type: "object",
          required: ["sourceId","overallScore","summary","bestSegments"],
          properties: {
            sourceId: { type: "string" },
            overallScore: { type: "number", minimum: 0, maximum: 1 },
            summary: { type: "string" },
            bestSegments: {
              type: "array",
              items: {
                type: "object",
                required: ["inPoint","outPoint","score","kind","summary","technical"],
                properties: {
                  inPoint: { type: "number" },
                  outPoint: { type: "number" },
                  score: { type: "number", minimum: 0, maximum: 1 },
                  kind: { type: "string", enum: ["speech","action","visual","reaction","detail","other"] },
                  summary: { type: "string" },
                  technical: {
                    type: "object",
                    required: ["voiceGainDb","exposure","temperature","tint","contrast","saturation","reframeScale","reframeXStart","reframeYStart","reframeXEnd","reframeYEnd"],
                    properties: {
                      voiceGainDb: { type: "number", minimum: -6, maximum: 6 },
                      exposure: { type: "number", minimum: -0.35, maximum: 0.35 },
                      temperature: { type: "number", minimum: -10, maximum: 10 },
                      tint: { type: "number", minimum: -6, maximum: 6 },
                      contrast: { type: "number", minimum: -12, maximum: 12 },
                      saturation: { type: "number", minimum: -8, maximum: 8 },
                      reframeScale: { type: "number", minimum: 100, maximum: 135 },
                      reframeXStart: { type: "number", minimum: -0.42, maximum: 0.42 },
                      reframeYStart: { type: "number", minimum: -0.30, maximum: 0.30 },
                      reframeXEnd: { type: "number", minimum: -0.42, maximum: 0.42 },
                      reframeYEnd: { type: "number", minimum: -0.30, maximum: 0.30 }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

function scoutModelChain() {
  return ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.7-flash", "gemini-3.6-flash"];
}

function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function neutralTechnical() {
  return { voiceGainDb:0, exposure:0, temperature:0, tint:0, contrast:0, saturation:0, reframeScale:100, reframeXStart:0, reframeYStart:0, reframeXEnd:0, reframeYEnd:0 };
}

function sanitizeTechnical(raw, intent = {}) {
  const t = raw && typeof raw === "object" ? raw : {};
  return {
    voiceGainDb: intent.requestFineMix === false ? 0 : clampNumber(t.voiceGainDb, -5, 5, 0),
    exposure: intent.requestColorGrade === false ? 0 : clampNumber(t.exposure, -0.35, 0.35, 0),
    temperature: intent.requestColorGrade === false ? 0 : clampNumber(t.temperature, -10, 10, 0),
    tint: intent.requestColorGrade === false ? 0 : clampNumber(t.tint, -6, 6, 0),
    contrast: intent.requestColorGrade === false ? 0 : clampNumber(t.contrast, -12, 12, 0),
    saturation: intent.requestColorGrade === false ? 0 : clampNumber(t.saturation, -8, 8, 0),
    reframeScale: intent.autoReframe === false ? 100 : clampNumber(t.reframeScale, 100, 135, 100),
    reframeXStart: intent.autoReframe === false ? 0 : clampNumber(t.reframeXStart, -0.42, 0.42, 0),
    reframeYStart: intent.autoReframe === false ? 0 : clampNumber(t.reframeYStart, -0.30, 0.30, 0),
    reframeXEnd: intent.autoReframe === false ? 0 : clampNumber(t.reframeXEnd, -0.42, 0.42, 0),
    reframeYEnd: intent.autoReframe === false ? 0 : clampNumber(t.reframeYEnd, -0.30, 0.30, 0)
  };
}

function fallbackScoutForSource(source, desiredSec = 5.5) {
  const ranges = [...(source?.allowedRanges || [])].sort((a,b) => (Number(b.end)-Number(b.start)) - (Number(a.end)-Number(a.start)));
  const range = ranges[0];
  if (!range) return null;
  const len = Math.max(0, Number(range.end)-Number(range.start));
  if (len <= 0.15) return null;
  const dur = Math.min(len, Math.max(1.2, desiredSec));
  const start = Number(range.start) + Math.max(0, Math.min(len-dur, (len-dur)*0.18));
  return { inPoint:start, outPoint:start+dur, score:0.35, kind:"other", summary:"fallback de cobertura; scout indisponível", technical:neutralTechnical() };
}

function sanitizeScoutReport(report, intent) {
  const byId = new Map();
  for (const rec of report || []) {
    const source = state.sourceById.get(String(rec?.sourceId));
    if (!source) continue;
    const segs = [];
    for (const raw of rec.bestSegments || []) {
      let a = Number(raw.inPoint), b = Number(raw.outPoint);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
      const range = allowedRangeForCut(source, a, b);
      if (!range) continue;
      a = Math.max(Number(range.start), a);
      b = Math.min(Number(range.end), b);
      if (b-a < 0.25) continue;
      segs.push({
        inPoint:a, outPoint:b,
        score:Math.max(0,Math.min(1,Number(raw.score ?? rec.overallScore ?? 0.65))),
        kind:String(raw.kind||"other"),
        summary:String(raw.summary||rec.summary||"melhor trecho").slice(0,180),
        technical:sanitizeTechnical(raw.technical, intent)
      });
    }
    segs.sort((a,b)=>b.score-a.score);
    byId.set(String(source.sourceId), { sourceId:String(source.sourceId), overallScore:Math.max(0,Math.min(1,Number(rec.overallScore??0.65))), summary:String(rec.summary||"").slice(0,240), bestSegments:segs.slice(0,4) });
  }

  const desired = intent?.targetGoalSec && state.sources.length ? Math.max(2.4, Math.min(6.5, intent.targetGoalSec/state.sources.length)) : 5.5;
  for (const source of state.sources) {
    const id = String(source.sourceId);
    let rec = byId.get(id);
    if (!rec) rec = { sourceId:id, overallScore:0.35, summary:"sem scout retornado", bestSegments:[] };
    if (!rec.bestSegments.length) {
      const fallback = fallbackScoutForSource(source, desired);
      if (fallback) {
        fallback.technical=sanitizeTechnical(fallback.technical,intent);
        rec.bestSegments.push(fallback);
      }
    }
    byId.set(id, rec);
  }
  return [...byId.values()];
}

async function scoutOneBatch(apiKey, batch, transcripts, intent, batchIndex, batchCount) {
  const ids = new Set(batch.map(x => String(x.source.sourceId)));
  const sourceInfo = batch.map(x => ({ sourceId:x.source.sourceId, name:x.source.name, mediaKind:x.source.mediaKind || "video", allowedRanges:x.source.allowedRanges, timelineAppearances:x.source.timelineAppearances || [] }));
  const tx = (transcripts || []).filter(t => ids.has(String(t.sourceId)));
  const perSource = intent?.targetGoalSec && intent.sourceCount ? Math.max(2.5, Math.min(6.5, intent.targetGoalSec/intent.sourceCount)) : 5.5;
  const system = `Você é o assistente de decupagem de um editor profissional. Analise CADA arquivo deste lote separadamente e localize os melhores trechos reais.
REGRAS:
- Retorne um registro para TODO sourceId recebido, sem exceção.
- Use apenas allowedRanges.
- Para cada fonte retorne de 1 a 4 bestSegments, sem sobreposição, ordenados por qualidade.
- Dê preferência a momentos completos: ação legível, fala completa, reação, detalhe ou enquadramento forte.
- Evite começo/fim tremido, câmera sendo posicionada, erro, silêncio morto, repetição e trechos sem assunto.
- Como a montagem final ${intent?.requireAllSources ? "DEVE usar todos os vídeos" : "pode selecionar os melhores vídeos"}, o primeiro bestSegment deve ser realmente utilizável.
- Quando houver material suficiente, faça o melhor segmento ter aproximadamente ${perSource.toFixed(1)} s (faixa aceitável 2,5–7,0 s); não corte palavra pela metade.
- score mede qualidade editorial e visual, não fama/importância.
- Para CADA bestSegment, preencha technical com correções pequenas e conservadoras:
  * voiceGainDb: ajuste relativo de voz para aproximar o take dos demais; use 0 sem fala e evite passar de ±5 dB.
  * exposure: correção de exposição em stops, normalmente entre -0,25 e +0,25.
  * temperature/tint: somente correção leve de balanço de branco, sem criar look artificial.
  * contrast/saturation: ajustes pequenos para igualar fontes; saturation é DELTA em relação ao valor atual, não valor absoluto.
- ${intent?.requestColorGrade ? "COLOR GRADING ATIVO: compare as fontes do lote e ajude a aproximar pele, exposição e balanço de branco entre elas." : "Color grading não foi solicitado: retorne 0 nos campos de cor."}
- ${intent?.requestFineMix ? "MIXAGEM FINA ATIVA: compare a intensidade aparente da voz entre os takes e sugira voiceGainDb moderado." : "Mixagem fina não foi solicitada: retorne voiceGainDb=0."}
- ${intent?.autoReframe ? `AUTO REFRAME ATIVO para saída ${intent.outputAspect}: o plugin calcula sozinho a escala geométrica necessária a partir da sequência de origem. Em technical, reframeScale é SOMENTE um zoom criativo extra relativo: 100 = cobertura geométrica calculada pelo plugin, 103–112 = crop extra sutil, até 135 apenas quando necessário para manter o assunto. reframeX/Y são offsets normalizados do centro da sequência: negativo move a imagem para esquerda/cima, positivo para direita/baixo. Se o assunto se mover durante o segmento, use valores diferentes em Start/End; caso contrário mantenha iguais.` : "Auto Reframe desligado: use reframeScale=100 e offsets=0."}
- Identifique corretamente se o trecho é speech, action, visual, reaction ou detail. Uma apresentação de dança sem fala deve ser action/visual; não marque como speech só porque existe música.
- Não monte a timeline ainda. Apenas faça decupagem objetiva.`;
  const parts = [{ text:`LOTE ${batchIndex+1}/${batchCount}.\nFONTES:\n${JSON.stringify(sourceInfo)}\nTRANSCRIÇÕES SE EXISTIREM:\n${JSON.stringify(tx)}` }];
  for (const u of batch) {
    parts.push({ text:`ARQUIVO sourceId=${u.source.sourceId} | ${u.source.name}` });
    parts.push({ file_data:{ file_uri:u.file.uri, mime_type:u.file.mimeType || u.file.mime_type || mimeFromPath(u.source.path) } });
  }
  let lastError = null;
  for (const model of scoutModelChain()) {
    progress(44 + Math.round(((batchIndex + 0.4) / Math.max(1,batchCount)) * 13), `Decupando lote ${batchIndex+1}/${batchCount} com ${model}…`);
    log(`Scout ${batchIndex+1}/${batchCount}: ${model}.`);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method:"POST", headers:{"Content-Type":"application/json","x-goog-api-key":apiKey},
        body:JSON.stringify({ systemInstruction:{parts:[{text:system}]}, contents:[{role:"user",parts}], generationConfig:generationConfigForModel(model, scoutSchema(), "scout") })
      });
      let data=null; try { data=await response.json(); } catch (_) {}
      if (response.ok) {
        const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
        if (text) return JSON.parse(text).sources || [];
      }
      const msg=data?.error?.message || `HTTP ${response.status}`;
      lastError=new Error(`${model}: ${msg}`);
      if ([401,403].includes(response.status)) throw lastError;
      if (response.status===429 || response.status===400) continue;
    } catch (error) {
      lastError=error;
      if (/401|403|API key|permission|invalid/i.test(String(error?.message||error))) throw error;
    }
  }
  log(`Scout lote ${batchIndex+1} caiu para fallback local: ${lastError?.message || "sem resposta"}.`);
  return [];
}

async function scoutTimelineSources(apiKey, uploaded, transcripts, intent) {
  if (!uploaded.length) return sanitizeScoutReport([], intent);
  const batches=[];
  for (let i=0;i<uploaded.length;i+=SCOUT_BATCH_SIZE) batches.push(uploaded.slice(i,i+SCOUT_BATCH_SIZE));
  const report=[];
  for (let i=0;i<batches.length;i++) {
    const rows=await scoutOneBatch(apiKey,batches[i],transcripts,intent,i,batches.length);
    report.push(...rows);
  }
  const clean=sanitizeScoutReport(report,intent);
  const withCandidates=clean.filter(r=>r.bestSegments?.length).length;
  log(`✓ Decupagem multi-pass: ${withCandidates}/${state.sources.length} fonte(s) com candidato(s). Nenhum vídeo foi silenciosamente ignorado.`);
  return clean;
}


function inferContentProfile(scoutReport, transcripts = []) {
  let speech=0, visual=0, total=0, speechSegments=0, segmentCount=0;
  for (const rec of scoutReport || []) {
    for (const seg of rec.bestSegments || []) {
      const w=Math.max(0.15,Number(seg.score||0.5));
      total+=w; segmentCount++;
      if(seg.kind==="speech") { speech+=w*1.15; speechSegments++; }
      else if(["action","visual","reaction","detail"].includes(seg.kind)) visual+=w;
      else { speech+=w*0.08; visual+=w*0.30; }
    }
  }
  const transcriptRatio=state.sources.length ? Math.min(1,(transcripts||[]).length/state.sources.length) : 0;
  const observedSpeechRatio=segmentCount ? speechSegments/segmentCount : 0;
  // Transcript sozinho não torna um vídeo "falado": música/plateia podem gerar transcrição.
  // Ele reforça a fala quando a análise multimodal já encontrou speech; no modo sem análise de vídeo,
  // o preset Talking Head/Entrevista pode usar a presença consistente de transcrição como sinal secundário.
  const selectedStyle=el.stylePreset?.value || "tiktok";
  if(observedSpeechRatio>=0.18) speech += transcriptRatio*Math.max(1,total)*0.35;
  else if(!el.optAnalyzeVideo?.checked && selectedStyle==="talking" && transcriptRatio>=0.25) speech += transcriptRatio*Math.max(1,total)*0.90;
  const imageRatio=state.sources.length ? state.sources.filter(s=>s.mediaKind==="image").length/state.sources.length : 0;
  visual += imageRatio*Math.max(1,total)*0.80;
  const denom=Math.max(0.001,speech+visual);
  const speechScore=speech/denom, visualScore=visual/denom;
  let mode="mixed", label="misto";
  if(speechScore>=0.64 && (observedSpeechRatio>=0.18 || (!el.optAnalyzeVideo?.checked && selectedStyle==="talking" && transcriptRatio>=0.25))){ mode="spoken"; label="fala / entrevista"; }
  else if(visualScore>=0.63 || (observedSpeechRatio<0.10 && selectedStyle!=="talking" && transcriptRatio<0.35)){ mode="visual"; label="visual / performance"; }
  const profile={ mode, label, speechScore:Number(speechScore.toFixed(3)), visualScore:Number(visualScore.toFixed(3)), transcriptRatio:Number(transcriptRatio.toFixed(3)), observedSpeechRatio:Number(observedSpeechRatio.toFixed(3)), imageRatio:Number(imageRatio.toFixed(3)) };
  state.contentProfile=profile;
  log(`Contexto automático: ${profile.label} (fala ${(speechScore*100).toFixed(0)}% / visual ${(visualScore*100).toFixed(0)}%; speech real ${(observedSpeechRatio*100).toFixed(0)}%).`);
  return profile;
}

function finalContextParts(scoutReport, transcripts, intent) {
  const scoutText = JSON.stringify(scoutReport || []);
  let transcriptText = "[]";
  try {
    const raw = JSON.stringify(transcripts || []);
    // A decupagem já ouviu/viu cada arquivo. Não reenviamos transcrições gigantes para a montagem final.
    transcriptText = raw.length <= 70000 ? raw : "[omitidas na montagem final; use os resumos da decupagem]";
  } catch (_) {}
  return [{ text:`CONTEXTO DE MONTAGEM GLOBAL.
FONTES E RANGES PERMITIDOS:\n${JSON.stringify(sourceContext())}\n\nDECUPAGEM MULTI-PASS DE TODAS AS FONTES:\n${scoutText}\n\nTRANSCRIÇÕES COMPACTAS, SE DISPONÍVEIS:\n${transcriptText}\n\nRESTRIÇÕES DETECTADAS:\n${JSON.stringify(intent)}\n\nPERFIL DE CONTEÚDO INFERIDO:\n${JSON.stringify(intent?.contentProfile || state.contentProfile || {})}` }];
}

async function planWithGemini(apiKey, instruction, scoutReport, transcripts, musicUploaded = [], intent = {}) {
  progress(63, "Director AI montando os melhores takes de todas as fontes…");

  const style = el.stylePreset?.value || "tiktok";
  const intensity = el.editIntensity?.value || "balanced";
  const intensityRules = intensity === "natural"
    ? `RITMO: natural. Preserve pausas expressivas e planos mais longos. Evite microcortes. Só corte quando houver ganho editorial claro.`
    : intensity === "dynamic"
      ? `RITMO: dinâmico. Acelere erros, redundâncias e pausas mortas, mas nunca corte palavras, respirações necessárias ou lógica de frase. Pattern interrupts devem ter motivo.`
      : `RITMO: equilibrado. Remova gordura sem transformar toda frase em jump cut. Prefira poucos cortes bons a muitos cortes medianos.`;

  const styleRules = style === "tiktok"
    ? `ESTILO: TikTok / Reels profissional.
- Gancho nos primeiros segundos sem repetir conteúdo.
- Hard cuts são a base quando existe fala; em conteúdo visual, dissolves e fades podem aparecer mais.
- B-roll/segunda câmera só quando acrescentar contexto, emoção ou esconder um corte real.
- Use punch-ins como ênfase, não como decoração constante.`
    : style === "talking"
      ? `ESTILO: Talking Head dinâmico clean.
- Preserve personalidade e cadência da pessoa.
- Corte erros/recomeços e pausas mortas; evite fala picotada.
- Punch-ins discretos e espaçados. Segunda câmera cobre jump cuts e momentos-chave.`
      : style === "visual"
        ? `ESTILO: Visual / evento.
- Priorize movimento, expressão, composição, reação, variedade de planos e progressão visual.
- Não procure frases ou diálogo quando o material não é falado.
- Sincronize mudanças visuais com a energia da música e use Cross Dissolve em fotos/planos contemplativos quando ficar elegante.
- Evite microclipes sem leitura; deixe ações importantes respirarem.`
        : `ESTILO: Institucional moderno.
- Clareza, credibilidade e naturalidade acima de velocidade.
- Preserve contexto e frases completas quando houver fala.
- B-roll deve ilustrar exatamente o assunto. Transições suaves podem separar blocos.`;

  const profile=intent?.contentProfile || state.contentProfile || {mode:"mixed"};
  const contentRules = profile.mode === "visual"
    ? `CONTEXTO AUTOMÁTICO: CONTEÚDO VISUAL/PERFORMANCE. Não trate fala como eixo narrativo se ela não for relevante. Escolha takes por ação, expressão, timing, composição e variedade. A música pode conduzir a edição e ficar mais presente. Use mais Cross Dissolve em mudanças de plano, fotos e momentos contemplativos, sem transformar tudo em slideshow.`
    : profile.mode === "spoken"
      ? `CONTEXTO AUTOMÁTICO: CONTEÚDO FALADO/ENTREVISTA. A fala é o eixo narrativo. Preserve frases completas, intenção e continuidade; música fica claramente abaixo da voz. Jump cuts podem ser escondidos com B-roll/punch-in e transições devem aparecer principalmente em mudanças de assunto/bloco.`
      : `CONTEXTO AUTOMÁTICO: CONTEÚDO MISTO. Equilibre clareza de fala e força visual. Quando houver fala importante, ela manda; em blocos puramente visuais, deixe música e imagem conduzirem.`;

  const brandRules = intent?.brandContext
    ? `CONTEXTO PERMANENTE DA MARCA (obedeça sempre que não conflitar com o pedido atual):\n${intent.brandContext}`
    : "CONTEXTO PERMANENTE DA MARCA: nenhum configurado.";

  const systemInstruction = `Você é um editor-chefe de vídeo trabalhando dentro do Adobe Premiere Pro. Entregue um plano executável, não sugestões abstratas.

${styleRules}
${intensityRules}
${contentRules}

PROTOCOLO EDITORIAL (faça internamente antes de responder):
1. NARRATIVA: identifique gancho, ideia central, repetições, erros/recomeços e fechamento.
2. FALA: monte A-roll preservando gramática, intenção, final de palavras e respirações naturais. Nunca emende duas metades que soem artificiais.
3. VISUAL: use vídeo/B-roll/segunda câmera apenas quando o conteúdo visual realmente corresponder ao momento/assunto. timelineAppearances ajuda a entender como as câmeras estavam organizadas na timeline original.
4. RITMO: remova silêncio morto e redundância, mas não faça cortes por intervalo fixo. Um bom plano pode durar mais se a fala estiver funcionando.
5. QC: confira sourceId, allowedRanges, duração, continuidade, cobertura das fontes e duplicação antes de emitir JSON.

RESTRIÇÕES DURAS DETECTADAS PELO PLUGIN:
- requireAllSources=${intent.requireAllSources ? "SIM" : "NÃO"}. ${intent.requireAllSources ? `Você DEVE usar pelo menos um A-roll de CADA um dos ${intent.sourceCount} sourceIds. Nenhuma fonte pode desaparecer da montagem.` : "Selecione somente o material que melhorar o resultado."}
- ${intent.maxDurationSec ? `Duração máxima real: ${intent.maxDurationSec.toFixed(1)} s. Alvo de montagem: ${Number(intent.targetMinSec||0).toFixed(1)}–${Number(intent.targetMaxSec||intent.maxDurationSec).toFixed(1)} s, mirando ~${Number(intent.targetGoalSec||intent.maxDurationSec).toFixed(1)} s. NÃO entregue um vídeo de 30–40 s se existe material suficiente para chegar ao alvo.` : "Sem duração máxima explícita detectada."}
- ${intent.requestEffects ? "O usuário pediu EFEITOS: marque punchIn em momentos úteis e varie enquadramento com intenção; o plugin também fará acabamento automático." : "Efeitos não foram exigidos explicitamente."}
- ${intent.requestTransitions ? (profile.mode === "visual" ? "TRANSIÇÕES ATIVAS: use Cross Dissolve com frequência moderada em mudanças de plano/fonte, especialmente fotos e momentos visuais; Dip to Black continua raro." : "TRANSIÇÕES ATIVAS: use Cross Dissolve em mudanças reais de assunto/câmera/bloco; evite dissolve em todo jump cut de fala.") : "Transições desativadas."}
- A lista DECUPAGEM MULTI-PASS contém candidatos dos vídeos que você deve comparar. Priorize score alto, mas obedecer requireAllSources vem antes de simplesmente descartar uma fonte.

REGRAS DE EXECUÇÃO OBRIGATÓRIAS:
- Analise somente o que existe nos arquivos/transcrições. Não invente falas, nomes, fatos ou timecodes.
- Use SOMENTE sourceIds e intervalos dentro de allowedRanges.
- A-roll = V1/A1: role="a-roll", videoTrack=0, audioTrack=0.
- A-roll não pode se sobrepor. timelineStart deve representar uma timeline contínua; o plugin fará a quantização final por frame.
- Por padrão mantenha ordem cronológica da fala. Você pode abrir com uma fala posterior como hook SOMENTE se ela não for repetida depois e a sequência continuar compreensível.
- Não reutilize o mesmo intervalo de fala duas vezes.
- Evite clipes A-roll menores que ~0,65 s. Não faça microcortes para remover pausas minúsculas.
- B-roll = V2/A2: role="b-roll", videoTrack=1, audioTrack=1. O plugin silenciará A2; a fala principal continua em A1.
- B-roll deve ter confidence >= 0.60. Se estiver em dúvida se combina, não use.
- B-roll normalmente deve durar 1,0–5,0 s e nunca existir só para “movimentar” a tela.
- punchIn geralmente 100. Use 106–110 em jump cuts ou ênfase; 112 é o máximo. Evite zoom em cortes consecutivos.
- transitionIn descreve a transição que ENTRA neste A-roll. Valores: "none", "cross_dissolve" ou "dip_black".
- Em fala, use "none" na maioria dos cortes. Em conteúdo visual/fotos, Cross Dissolve pode aparecer com mais frequência quando melhorar fluidez e musicalidade.
- Dip to Black é excepcional: no máximo uma vez, em mudança forte de capítulo/tempo ou reset narrativo.
- Não use transição no primeiro A-roll. Em B-roll, transitionIn deve ser "none"; o plugin aplica fades sutis de entrada/saída automaticamente.
- NUNCA use Morph Cut, wipes, spins, zoom transitions, page peel ou transições chamativas.
- Evite transições chamativas ou sem motivo. Em visual puro, dissolves consecutivos são aceitáveis em sequências de fotos/planos lentos se o resultado continuar elegante.
- LEGENDAS ESTÃO DESATIVADAS. Não gere campo captions e não gaste saída com texto de legenda.
- Música: escolha no máximo uma candidata. Em conteúdo falado, prefira cerca de -26 a -20 dB; em conteúdo visual sem fala relevante, pode ficar aproximadamente -20 a -14 dB. use=false se nenhuma combinar.
- reason deve ser curto e concreto (ex.: "remove recomeço", "cobre jump cut", "ênfase na frase-chave").
- confidence representa sua confiança editorial nesse corte/uso visual.
- Se houver duração detectada acima, use essa faixa como contrato de entrega. Se não houver, entregue a versão mais forte e objetiva sem apagar informação essencial.
- O JSON deve seguir exatamente o schema. Não inclua campos extras.

REGRAS ESPECÍFICAS DESTA BUILD:
${BUILD_VARIANT.plannerRules}

${intent.outroDurationSec ? `RESERVA DE ENTREGA: existe uma vinheta final de ${Number(intent.outroDurationSec).toFixed(1)} s. A duração da montagem principal já foi reduzida para que a entrega final permaneça dentro do limite.` : ""}

${brandRules}`;

  const musicContext = musicUploaded.length
    ? musicUploaded.map(m => ({ candidateId: m.candidate.candidateId, name: m.candidate.name })).slice(0, MAX_MUSIC_FILES)
    : [];

  const requestParts = [{
    text: `OBJETIVO DO USUÁRIO:
${instruction}

CONTRATO AUTOMÁTICO:
${JSON.stringify(intent)}

MÚSICAS DISPONÍVEIS:
${JSON.stringify(musicContext)}

Entregue somente o plano final validado. Quando requireAllSources=true, use TODOS os sourceIds; quando houver targetMinSec/targetMaxSec, mire essa faixa de duração.`
  }];
  for (const m of musicUploaded) {
    requestParts.push({ text: `MÚSICA = ${m.candidate.candidateId} | ${m.candidate.name}. Avalie energia, andamento e conflito com voz.` });
    requestParts.push({ file_data: { file_uri: m.file.uri, mime_type: m.file.mimeType || m.file.mime_type || mimeFromPath(m.candidate.path) } });
  }

  const fallbackModels = qualityModelChain();
  let lastError = null;
  for (let modelIndex = 0; modelIndex < fallbackModels.length; modelIndex++) {
    const model = fallbackModels[modelIndex];
    const maxAttempts = 1;
    try { localStorage.removeItem("vinicius-gemini-context-cache-v1"); } catch (_) {}
    if (el.contextCacheStatus) el.contextCacheStatus.textContent = "uploads reutilizáveis";
    if (modelIndex === 0) log("Director 2.4.1: montagem contextual após decupagem; preset, branding, Auto Reframe e contexto automático ativos quando configurados.");

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const label = modelIndex === 0 ? model : `${model} (fallback)`;
      progress(64 + Math.min(3, modelIndex + attempt - 1), `Director AI montando com ${label}…`);
      log(`Director AI: ${model}, tentativa ${attempt}/${maxAttempts}.`);

      const payload = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [...finalContextParts(scoutReport, transcripts, intent), ...requestParts] }],
        generationConfig: generationConfigForModel(model, plannerSchema(), "planner")
      };

      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(payload)
        });
        let data = null;
        try { data = await response.json(); } catch (_) { data = null; }

        if (response.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
          if (!text) lastError = new Error(`${model} respondeu sem plano de edição.`);
          else {
            try {
              const parsed = JSON.parse(text);
              if (el.activeModel) el.activeModel.textContent = model;
              if (modelIndex > 0) log(`Fallback bem-sucedido: ${model}.`);
              return parsed;
            } catch (_) { lastError = new Error(`${model} retornou JSON inválido.`); }
          }
        } else {
          const message = data?.error?.message || `Gemini HTTP ${response.status}`;
          lastError = new Error(`${model}: ${message}`);
          if ([401,403].includes(response.status)) throw lastError;
          if (response.status === 429) {
            log(`${model}: quota/rate limit atingido. Pulando direto para o próximo modelo.`);
            break;
          }
          if (response.status === 400) {
            log(`${model}: configuração rejeitada (HTTP 400). Pulando para o próximo modelo.`);
            break;
          }
          if (![500,502,503,504].includes(response.status)) break;
        }
      } catch (error) {
        lastError = error;
        const msg = String(error?.message || error);
        if (/401|403|API key|permission|invalid/i.test(msg)) throw error;
      }

      if (attempt < maxAttempts) {
        const waitMs = 1000 + Math.floor(Math.random() * 450);
        result(`⚠️ ${model} ocupado. Mais uma tentativa em ${(waitMs/1000).toFixed(1)}s…`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }
    if (modelIndex < fallbackModels.length - 1) result(`↪️ Mudando para ${fallbackModels[modelIndex + 1]}…`);
  }
  throw lastError || new Error("Todos os modelos Gemini de fallback falharam temporariamente.");
}

function inAllowedRange(source, inPoint, outPoint) {
  return source.allowedRanges.some(r => inPoint >= r.start - 0.08 && outPoint <= r.end + 0.08);
}

function getIntensityProfile() {
  const style = el.stylePreset?.value || "tiktok";
  const intensity = el.editIntensity?.value || "balanced";
  const base = intensity === "natural"
    ? { minA:0.85, minB:1.10, brollGap:9.0, punchGap:7.0 }
    : intensity === "dynamic"
      ? { minA:0.55, minB:0.85, brollGap:4.0, punchGap:3.2 }
      : { minA:0.68, minB:1.00, brollGap:6.0, punchGap:4.6 };
  if (style === "institutional") return { ...base, minA:Math.max(base.minA,0.9), brollGap:Math.max(base.brollGap,9), punchGap:Math.max(base.punchGap,9) };
  if (style === "talking") return { ...base, brollGap:Math.max(base.brollGap,6), punchGap:Math.max(base.punchGap,5) };
  return base;
}

function allowedRangeForCut(source, inPoint, outPoint) {
  const ranges = source?.allowedRanges || [];
  const mid = (inPoint + outPoint) / 2;
  return ranges.find(r => mid >= Number(r.start)-0.08 && mid <= Number(r.end)+0.08)
    || ranges.find(r => outPoint > Number(r.start) && inPoint < Number(r.end))
    || null;
}

function sanitizeCutRanges(plan) {
  if (!plan || !Array.isArray(plan.cuts)) return plan;
  const clean = [];
  for (const raw of plan.cuts) {
    const c = { ...raw };
    const source = state.sourceById.get(String(c.sourceId));
    if (!source) {
      log(`QC: corte descartado — sourceId inexistente (${c.sourceId}).`);
      continue;
    }
    let a = Number(c.inPoint), b = Number(c.outPoint);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
      log(`QC: corte descartado — In/Out inválido em ${source.name}.`);
      continue;
    }
    const range = allowedRangeForCut(source, a, b);
    if (!range) {
      log(`QC: ${c.role === "b-roll" ? "B-roll descartado" : "A-roll inválido"} fora da timeline original: ${source.name}.`);
      if (c.role !== "b-roll") continue;
      continue;
    }
    a = Math.max(Number(range.start), a);
    b = Math.min(Number(range.end), b);
    if (b <= a + 0.08) continue;
    c.inPoint = a;
    c.outPoint = b;
    c.role = c.role === "b-roll" ? "b-roll" : "a-roll";
    c.videoTrack = c.role === "b-roll" ? 1 : 0;
    c.audioTrack = c.role === "b-roll" ? 1 : 0;
    c.confidence = Math.max(0, Math.min(1, Number(c.confidence ?? 0.75)));
    c.reason = String(c.reason || "decisão editorial").slice(0, 160);
    c.punchIn = Math.max(100, Math.min(112, Number(c.punchIn || 100)));
    const tr = String(c.transitionIn || "none").toLowerCase();
    c.transitionIn = ["cross_dissolve","dip_black"].includes(tr) ? tr : "none";
    if (c.role === "b-roll") c.transitionIn = "none";
    clean.push(c);
  }
  plan.cuts = clean;
  return plan;
}

function sourceOverlapRatio(a, b) {
  if (String(a.sourceId) !== String(b.sourceId)) return 0;
  const s = Math.max(Number(a.inPoint), Number(b.inPoint));
  const e = Math.min(Number(a.outPoint), Number(b.outPoint));
  const overlap = Math.max(0, e-s);
  const smaller = Math.max(0.001, Math.min(Number(a.outPoint)-Number(a.inPoint), Number(b.outPoint)-Number(b.inPoint)));
  return overlap / smaller;
}

function deDuplicateARoll(cuts) {
  const out=[];
  for (const c of cuts) {
    if (c.role === "b-roll") { out.push(c); continue; }
    const dup = out.find(x => x.role !== "b-roll" && sourceOverlapRatio(x,c) > 0.55);
    if (dup) {
      log(`QC: A-roll duplicado removido (${c.reason || c.sourceId}).`);
      continue;
    }
    out.push(c);
  }
  return out;
}

function reflowPlanNoGaps(plan) {
  if (!plan || !Array.isArray(plan.cuts)) return plan;
  const profile = getIntensityProfile();
  let cuts = [...plan.cuts].sort((a,b) => Number(a.timelineStart||0)-Number(b.timelineStart||0) || Number(a.videoTrack||0)-Number(b.videoTrack||0));
  cuts = deDuplicateARoll(cuts);

  let aroll = cuts.filter(c => c.role !== "b-roll");
  // Não apagamos fala válida só por ser curta: isso poderia quebrar uma frase.
  // O modelo é instruído a evitar microcortes; aqui descartamos apenas fragmentos claramente inviáveis.
  aroll = aroll.filter(c => {
    const dur = Number(c.outPoint)-Number(c.inPoint);
    if (dur >= 0.28) {
      if (dur < profile.minA) log(`QC: A-roll curto preservado (${dur.toFixed(2)}s) para não quebrar a fala.`);
      return true;
    }
    log(`QC: fragmento A-roll inviável de ${dur.toFixed(2)}s descartado.`);
    return false;
  });
  if (!aroll.length) throw new Error("O plano ficou sem A-roll depois do controle de qualidade.");

  const maps=[];
  let cursor=0;
  for (const c of aroll) {
    const oldStart=Number(c.timelineStart||0);
    const dur=Math.max(0.04, Number(c.outPoint)-Number(c.inPoint));
    const newStart=Math.max(0, Number(cursor.toFixed(6)));
    maps.push({cut:c,oldStart,oldEnd:oldStart+dur,newStart,newEnd:newStart+dur,delta:newStart-oldStart});
    c.timelineStart=newStart;
    c.videoTrack=0; c.audioTrack=0;
    cursor=newStart+dur;
  }

  // B-roll: baixa confiança, microclipes e excesso de frequência são removidos.
  const brollRaw=cuts.filter(c => c.role === "b-roll")
    .filter(c => Number(c.confidence||0) >= 0.60)
    .sort((a,b)=>Number(a.timelineStart||0)-Number(b.timelineStart||0));
  const broll=[];
  let lastB=-Infinity;
  for (const c of brollRaw) {
    const dur=Number(c.outPoint)-Number(c.inPoint);
    if (dur < profile.minB) continue;
    const oldStart=Number(c.timelineStart||0);
    const mid=oldStart+dur/2;
    const map=maps.find(m=>mid>=m.oldStart-0.08 && mid<=m.oldEnd+0.08)
      || [...maps].reverse().find(m=>oldStart>=m.oldStart)
      || maps[0];
    if (!map) continue;
    let ns=Math.max(0, map.newStart + (oldStart-map.oldStart));
    ns=Math.min(ns, Math.max(0,cursor-0.1));
    if (ns-lastB < profile.brollGap) continue;
    const maxDur=Math.min(dur, Math.max(0,cursor-ns), 5.5);
    if (maxDur < profile.minB) continue;
    c.timelineStart=Number(ns.toFixed(6));
    c.outPoint=Number((Number(c.inPoint)+maxDur).toFixed(6));
    c.videoTrack=1; c.audioTrack=1; c.punchIn=100;
    broll.push(c); lastB=ns;
  }

  plan.cuts=[...aroll,...broll].sort((a,b)=>Number(a.timelineStart)-Number(b.timelineStart)||Number(a.videoTrack)-Number(b.videoTrack));
  plan._finalDuration=cursor;
  return plan;
}


function sourceTimelineOrder() {
  const ordered=[...state.sources].sort((a,b)=>{
    const aa=Math.min(...(a.timelineAppearances||[]).map(x=>Number(x.timelineStart||0)), Number.POSITIVE_INFINITY);
    const bb=Math.min(...(b.timelineAppearances||[]).map(x=>Number(x.timelineStart||0)), Number.POSITIVE_INFINITY);
    return aa-bb;
  });
  return new Map(ordered.map((s,i)=>[String(s.sourceId),i]));
}

function scoutCutFromSegment(sourceId, seg, reasonPrefix="decupagem") {
  return {
    sourceId:String(sourceId), inPoint:Number(seg.inPoint), outPoint:Number(seg.outPoint), timelineStart:0,
    videoTrack:0, audioTrack:0, role:"a-roll", punchIn:100, transitionIn:"none",
    confidence:Math.max(0.35,Math.min(1,Number(seg.score||0.65))), reason:`${reasonPrefix}: ${String(seg.summary||"melhor trecho").slice(0,120)}`,
    _technical:sanitizeTechnical(seg.technical || neutralTechnical(), { requestColorGrade:true, requestFineMix:true, autoReframe:true })
  };
}

function segmentOverlapScore(cut, seg) {
  if (!cut || !seg) return -Infinity;
  const a=Math.max(Number(cut.inPoint), Number(seg.inPoint));
  const b=Math.min(Number(cut.outPoint), Number(seg.outPoint));
  const overlap=Math.max(0,b-a);
  if (overlap>0) return 1000 + overlap;
  const cm=(Number(cut.inPoint)+Number(cut.outPoint))/2;
  const sm=(Number(seg.inPoint)+Number(seg.outPoint))/2;
  return -Math.abs(cm-sm);
}

function attachTechnicalPassToCuts(plan, scoutReport, intent = {}) {
  if (!plan || !Array.isArray(plan.cuts)) return plan;
  const byId=new Map((scoutReport||[]).map(r=>[String(r.sourceId),r]));
  for (const cut of plan.cuts) {
    const rec=byId.get(String(cut.sourceId));
    const segs=rec?.bestSegments || [];
    let best=null, bestScore=-Infinity;
    for (const seg of segs) {
      const score=segmentOverlapScore(cut,seg);
      if(score>bestScore){ bestScore=score; best=seg; }
    }
    const raw=cut._technical || best?.technical || neutralTechnical();
    const technical=sanitizeTechnical(raw,intent);
    if(cut.role==="b-roll") technical.voiceGainDb=0;
    cut._technical=technical;
  }
  return plan;
}

function planDurationARoll(plan) {
  return (plan?.cuts||[]).filter(c=>c.role!=="b-roll").reduce((sum,c)=>sum+Math.max(0,Number(c.outPoint)-Number(c.inPoint)),0);
}

function overlapsExistingSourceCut(cut, list, threshold=0.35) {
  return list.some(x=>String(x.sourceId)===String(cut.sourceId) && sourceOverlapRatio(x,cut)>threshold);
}

function repairPlanAgainstIntent(plan, scoutReport, intent) {
  if (!plan || !Array.isArray(plan.cuts)) return plan;
  if (!intent) return plan;
  const scouts = new Map((scoutReport || []).map(r => [String(r.sourceId), r]));
  let aroll = plan.cuts.filter(c => c.role !== "b-roll");
  const broll = plan.cuts.filter(c => c.role === "b-roll");

  if (intent.requireAllSources) {
    // Mantém a ordem editorial que o Gemini criou. A 2.1 reordenava tudo pela
    // timeline original, o que podia destruir um hook ou uma narrativa melhor.
    const counts = new Map();
    aroll = aroll.filter(c => {
      const id = String(c.sourceId);
      const n = counts.get(id) || 0;
      if (n >= 2) return false;
      counts.set(id, n + 1);
      return true;
    });

    const used = new Set(aroll.map(c => String(c.sourceId)));
    const missing = state.sources.filter(src => !used.has(String(src.sourceId)));
    let appendAt = aroll.reduce((m, c) => Math.max(m, Number(c.timelineStart || 0) + Math.max(0, Number(c.outPoint) - Number(c.inPoint))), 0);
    for (const src of missing) {
      const seg = scouts.get(String(src.sourceId))?.bestSegments?.[0]
        || fallbackScoutForSource(src, intent.targetGoalSec && intent.sourceCount ? intent.targetGoalSec / intent.sourceCount : 5.5);
      if (!seg) continue;
      const fallback = scoutCutFromSegment(src.sourceId, seg, "cobertura obrigatória");
      fallback.timelineStart = appendAt;
      appendAt += Math.max(0, Number(fallback.outPoint) - Number(fallback.inPoint));
      aroll.push(fallback);
    }
    if (missing.length) log(`QC de cobertura: ${missing.length} fonte(s) ausente(s) foram reinseridas sem reordenar a narrativa já planejada.`);
  }

  let working = [...aroll].sort((a,b) => Number(a.timelineStart || 0) - Number(b.timelineStart || 0));
  const targetMin = Number(intent.targetMinSec || 0);
  const targetGoal = Number(intent.targetGoalSec || targetMin || 0);
  const targetMax = Number(intent.targetMaxSec || intent.maxDurationSec || 0);
  let duration = working.reduce((sum,c) => sum + Math.max(0, Number(c.outPoint) - Number(c.inPoint)), 0);

  if (targetMin > 0 && duration < targetMin - 0.25) {
    const pool = [];
    for (const src of state.sources) {
      const rec = scouts.get(String(src.sourceId));
      for (const seg of rec?.bestSegments?.slice(1) || []) {
        const c = scoutCutFromSegment(src.sourceId, seg, "take complementar");
        if (!overlapsExistingSourceCut(c, working, 0.30)) pool.push(c);
      }
    }
    pool.sort((a,b) => Number(b.confidence || 0) - Number(a.confidence || 0));
    for (const c of pool) {
      if (duration >= targetGoal - 0.25) break;
      const d = Number(c.outPoint) - Number(c.inPoint);
      if (targetMax > 0 && duration + d > targetMax) {
        const room = targetMax - duration;
        if (room < 0.65) continue;
        c.outPoint = Number(c.inPoint) + room;
      }
      c.timelineStart = duration;
      working.push(c);
      duration += Number(c.outPoint) - Number(c.inPoint);
    }
  }

  if (targetMin > 0 && duration < targetMin - 0.25) {
    const sorted = [...working].sort((a,b) => Number(b.confidence || 0) - Number(a.confidence || 0));
    for (const c of sorted) {
      if (duration >= targetGoal - 0.25) break;
      const src = state.sourceById.get(String(c.sourceId));
      const range = allowedRangeForCut(src, Number(c.inPoint), Number(c.outPoint));
      if (!range) continue;
      const maxExtra = Math.min(2.2, Number(range.end) - Number(c.outPoint), Math.max(0, targetGoal - duration));
      if (maxExtra > 0.25) { c.outPoint = Number(c.outPoint) + maxExtra; duration += maxExtra; }
      const headExtra = Math.min(1.2, Number(c.inPoint) - Number(range.start), Math.max(0, targetGoal - duration));
      if (headExtra > 0.25) { c.inPoint = Number(c.inPoint) - headExtra; duration += headExtra; }
    }
  }

  if (targetMax > 0 && duration > targetMax + 0.05) {
    const counts = new Map();
    for (const c of working) counts.set(String(c.sourceId), (counts.get(String(c.sourceId)) || 0) + 1);
    const candidates = [...working].sort((a,b) => Number(a.confidence || 0) - Number(b.confidence || 0));
    for (const c of candidates) {
      if (duration <= targetMax + 0.05) break;
      const id = String(c.sourceId);
      if (intent.requireAllSources && (counts.get(id) || 0) <= 1) continue;
      const d = Number(c.outPoint) - Number(c.inPoint);
      working = working.filter(x => x !== c);
      duration -= d;
      counts.set(id, (counts.get(id) || 1) - 1);
    }

    if (duration > targetMax + 0.05) {
      const perSourceFloor = intent.requireAllSources && intent.sourceCount && targetMax
        ? Math.max(0.55, Math.min(2.4, (targetMax / intent.sourceCount) * 0.86))
        : 0.8;
      const long = [...working].sort((a,b) => (Number(b.outPoint)-Number(b.inPoint)) - (Number(a.outPoint)-Number(a.inPoint)));
      for (const c of long) {
        if (duration <= targetMax + 0.05) break;
        const d = Number(c.outPoint) - Number(c.inPoint);
        const floor = intent.requireAllSources ? Math.min(perSourceFloor, d) : Math.min(0.8, d);
        const reducible = Math.max(0, d - floor);
        const reduce = Math.min(reducible, duration - targetMax);
        if (reduce > 0.05) { c.outPoint = Number(c.outPoint) - reduce; duration -= reduce; }
      }
    }
  }

  working.sort((a,b) => Number(a.timelineStart || 0) - Number(b.timelineStart || 0));
  let cursor = 0;
  for (const c of working) {
    c.timelineStart = cursor;
    cursor += Math.max(0, Number(c.outPoint) - Number(c.inPoint));
  }

  plan.cuts = [...working, ...broll];
  plan._intent = intent;
  plan._finalDuration = cursor;
  const covered = new Set(working.map(c => String(c.sourceId))).size;
  state.styleStats.sourcesUsed = covered;
  state.styleStats.finalDuration = cursor;
  log(`QC de entrega: ${covered}/${state.sources.length} fonte(s) em A-roll; duração planejada ${cursor.toFixed(1)} s${targetMax ? ` (máx. ${targetMax.toFixed(1)} s)` : ""}.`);
  return plan;
}

function refinePunchPlan(plan, intent = plan?._intent || {}) {
  if (!plan || !Array.isArray(plan.cuts)) return plan;
  const profile=getIntensityProfile();
  const aroll=plan.cuts.filter(c=>c.role!=="b-roll").sort((a,b)=>Number(a.timelineStart)-Number(b.timelineStart));
  const requestedEffects=Boolean(intent?.requestEffects);
  const effectGap=requestedEffects ? (el.editIntensity?.value==="dynamic"?1.8:2.8) : profile.punchGap;
  let lastPunch=-Infinity;
  let punchToggle=0;
  let planned=0;
  for (let i=0;i<aroll.length;i++) {
    const c=aroll[i];
    const prev=i?aroll[i-1]:null;
    const t=Number(c.timelineStart||0);
    const explicit=Number(c.punchIn||100)>100.5;
    const sameSource=prev && String(prev.sourceId)===String(c.sourceId);
    const sourceChanged=Boolean(prev && !sameSource);
    const removedGap=sameSource ? Number(c.inPoint)-Number(prev.outPoint) : 0;
    const jumpCut=Boolean(sameSource && removedGap>0.10);
    const enoughSpace=t-lastPunch>=effectGap;
    const autoRequested=requestedEffects && i>0 && (i%2===1 || (sourceChanged && i%3!==0));
    let target=100;
    if (el.optStyle?.checked && enoughSpace && (explicit || autoRequested || (el.optForceFinish?.checked && jumpCut))) {
      const style=el.stylePreset?.value||"tiktok";
      const autoPattern=[104,108,106,110,105,109];
      const requested=Math.max(103,Math.min(112,Number(c.punchIn||0)>100.5?Number(c.punchIn):autoPattern[punchToggle%autoPattern.length]));
      target=style==="institutional"?Math.min(104,requested):style==="talking"?Math.min(107,requested):Math.min(110,requested);
      punchToggle++; lastPunch=t; planned++;
    }
    c.punchIn=target;
  }
  if(requestedEffects) log(`Plano de efeitos: ${planned} reframing/punch-in(s) distribuído(s) automaticamente, além de B-roll/transições.`);
  return plan;
}

function refineTransitionPlan(plan, intent = plan?._intent || {}) {
  if (!plan || !Array.isArray(plan.cuts)) return plan;
  const enabled=Boolean(el.optTransitions?.checked);
  const aroll=plan.cuts.filter(c=>c.role!=="b-roll").sort((a,b)=>Number(a.timelineStart)-Number(b.timelineStart));
  if(!enabled){ for(const c of aroll)c.transitionIn="none"; return plan; }

  const style=el.stylePreset?.value||"tiktok";
  const intensity=el.editIntensity?.value||"balanced";
  const mode=intent?.contentProfile?.mode || state.contentProfile?.mode || "mixed";
  const visualBias=mode==="visual" || style==="visual";
  const spokenBias=mode==="spoken" || style==="talking";
  const mostlyPhotos=state.sources.length>0 && state.sources.filter(s=>s.mediaKind==="image").length/state.sources.length>=0.45;
  const minSpacing=mostlyPhotos ? 1.15 : visualBias ? (intensity==="dynamic"?1.25:1.75) : spokenBias ? (intensity==="dynamic"?4.0:5.5) : (intensity==="dynamic"?2.4:3.3);
  const maxTransitions=mostlyPhotos
    ? Math.min(24,Math.max(2,Math.floor(aroll.length*0.88)))
    : visualBias ? Math.min(20,Math.max(2,Math.floor(aroll.length*0.75)))
      : spokenBias ? Math.min(8,Math.max(1,Math.floor(aroll.length/3)))
        : Math.min(12,Math.max(2,Math.floor(aroll.length*0.45)));
  const desiredAuto=mostlyPhotos
    ? Math.min(maxTransitions,Math.max(2,Math.floor(aroll.length*0.72)))
    : visualBias ? Math.min(maxTransitions,Math.max(2,Math.floor(aroll.length*0.56)))
      : spokenBias ? Math.min(maxTransitions,Math.max(1,Math.floor(aroll.length/4)))
        : Math.min(maxTransitions,Math.max(2,Math.floor(aroll.length*0.36)));
  let used=0,dips=0;
  const transitionTimes=[];
  const hasNearby=(at)=>transitionTimes.some(t=>Math.abs(Number(t)-Number(at))<minSpacing);

  for(let i=0;i<aroll.length;i++){
    const c=aroll[i];
    if(i===0){c.transitionIn="none";continue;}
    const prev=aroll[i-1];
    const at=Number(c.timelineStart||0);
    const sameSource=String(prev.sourceId)===String(c.sourceId);
    const sourceGap=sameSource?Number(c.inPoint)-Number(prev.outPoint):0;
    let type=String(c.transitionIn||"none");
    if(spokenBias && sameSource && sourceGap>=-0.05 && sourceGap<2.5) type="none";
    if(used>=maxTransitions || hasNearby(at)) type="none";
    if(type==="dip_black" && (dips>=1 || at<4)) type="none";
    c.transitionIn=["cross_dissolve","dip_black"].includes(type)?type:"none";
    if(c.transitionIn!=="none"){used++;transitionTimes.push(at);if(c.transitionIn==="dip_black")dips++;}
  }

  if(used<desiredAuto && aroll.length>2){
    // Prioriza fotos e mudanças reais de fonte, mas mede espaçamento contra TODAS as transições já escolhidas.
    const indexes=[...Array(aroll.length-1)].map((_,k)=>k+1).sort((ia,ib)=>{
      const a=aroll[ia],b=aroll[ib];
      const aImg=state.sourceById.get(String(a.sourceId))?.mediaKind==="image"?1:0;
      const bImg=state.sourceById.get(String(b.sourceId))?.mediaKind==="image"?1:0;
      if(bImg!==aImg) return bImg-aImg;
      return Number(a.timelineStart)-Number(b.timelineStart);
    });
    for(const i of indexes){
      if(used>=desiredAuto) break;
      const c=aroll[i],prev=aroll[i-1],at=Number(c.timelineStart||0);
      if(c.transitionIn!=="none" || hasNearby(at)) continue;
      const sameSource=String(prev.sourceId)===String(c.sourceId);
      if(spokenBias && sameSource) continue;
      const curImage=state.sourceById.get(String(c.sourceId))?.mediaKind==="image";
      const prevImage=state.sourceById.get(String(prev.sourceId))?.mediaKind==="image";
      if(!visualBias && !mostlyPhotos && sameSource) continue;
      c.transitionIn=(intent.promptRequestsTransitions && !visualBias && !mostlyPhotos && used===Math.floor(desiredAuto/2) && at>15 && dips===0)?"dip_black":"cross_dissolve";
      if(curImage||prevImage) c.transitionIn="cross_dissolve";
      used++;transitionTimes.push(at);if(c.transitionIn==="dip_black")dips++;
    }
  }
  log(`Plano de transições contextual: ${used}/${maxTransitions} A-roll; modo=${mode}; ${mostlyPhotos?"slideshow/dissolves fortes":visualBias?"dissolves mais presentes":"dissolves controlados"}.`);
  return plan;
}

async function quantizePlanToSequenceFrames(plan, seq=state.sourceSequence) {
  if (!plan || !Array.isArray(plan.cuts) || !seq?.getTimebase) return plan;
  const PREMIERE_TICKS_PER_SECOND = 254016000000;
  let frameSec=0;
  try {
    const timebaseTicks = Number(await seq.getTimebase());
    frameSec = timebaseTicks / PREMIERE_TICKS_PER_SECOND;
  } catch (_) {}
  if (!Number.isFinite(frameSec) || frameSec<=0 || frameSec>0.2) {
    log("QC por frame: timebase indisponível; mantendo precisão em segundos.");
    return plan;
  }
  const q=(x)=>Math.max(0,Math.round(Number(x||0)/frameSec)*frameSec);
  const aroll=plan.cuts.filter(c=>c.role!=="b-roll").sort((a,b)=>Number(a.timelineStart)-Number(b.timelineStart));
  let cursor=0;
  for (const c of aroll) {
    const source=state.sourceById.get(String(c.sourceId));
    const range=allowedRangeForCut(source,Number(c.inPoint),Number(c.outPoint));
    let inQ=q(c.inPoint);
    let outQ=q(c.outPoint);
    if (range) {
      inQ=Math.max(Number(range.start),inQ);
      outQ=Math.min(Number(range.end),outQ);
    }
    if (outQ<=inQ) outQ=Math.min(range?Number(range.end):inQ+frameSec,inQ+frameSec);
    c.inPoint=Number(inQ.toFixed(6)); c.outPoint=Number(outQ.toFixed(6));
    c.timelineStart=Number(cursor.toFixed(6));
    cursor=q(cursor+(outQ-inQ));
  }
  for (const c of plan.cuts.filter(c=>c.role==="b-roll")) {
    const source=state.sourceById.get(String(c.sourceId));
    const range=allowedRangeForCut(source,Number(c.inPoint),Number(c.outPoint));
    let inQ=q(c.inPoint), outQ=q(c.outPoint);
    if(range){ inQ=Math.max(Number(range.start),inQ); outQ=Math.min(Number(range.end),outQ); }
    if(outQ<=inQ) outQ=Math.min(range?Number(range.end):inQ+frameSec,inQ+frameSec);
    let startQ=q(c.timelineStart); if(startQ>=cursor) startQ=Math.max(0,cursor-frameSec);
    const maxDur=Math.max(frameSec,cursor-startQ);
    if(outQ-inQ>maxDur) outQ=inQ+q(maxDur);
    if(range) outQ=Math.min(Number(range.end),outQ);
    c.inPoint=Number(inQ.toFixed(6)); c.outPoint=Number(outQ.toFixed(6)); c.timelineStart=Number(startQ.toFixed(6));
  }
  plan._finalDuration=cursor;
  plan.cuts.sort((a,b)=>Number(a.timelineStart)-Number(b.timelineStart)||Number(a.videoTrack)-Number(b.videoTrack));
  log(`✓ Plano alinhado à grade de frames (${(1/frameSec).toFixed(2)} fps aprox.).`);
  return plan;
}

function postProcessPlanForStyle(plan, scoutReport = [], intent = {}) {
  if (!plan || !Array.isArray(plan.cuts)) return plan;
  plan=sanitizeCutRanges(plan);
  plan=repairPlanAgainstIntent(plan, scoutReport, intent);
  plan=reflowPlanNoGaps(plan);
  plan=attachTechnicalPassToCuts(plan, scoutReport, intent);
  plan=refinePunchPlan(plan, intent);
  plan=refineTransitionPlan(plan, intent);
  if (!plan.music || typeof plan.music!=="object") plan.music={use:false,candidateId:"",trimStart:0,volumeDb:-22,reason:"Sem plano de música."};
  const contentMode=intent?.contentProfile?.mode || state.contentProfile?.mode || "mixed";
  const requestedMusicDb=Number(plan.music.volumeDb||-22);
  plan.music.volumeDb=contentMode==="spoken"
    ? Math.max(-30,Math.min(-20,requestedMusicDb))
    : contentMode==="visual"
      ? Math.max(-24,Math.min(-14,requestedMusicDb))
      : Math.max(-28,Math.min(-18,requestedMusicDb));
  return plan;
}

function validatePlan(plan) {
  if (!Array.isArray(plan?.cuts)||!plan.cuts.length) throw new Error("A IA não gerou nenhum corte válido.");
  const aroll=plan.cuts.filter(c=>c.role!=="b-roll").sort((a,b)=>Number(a.timelineStart)-Number(b.timelineStart));
  if (!aroll.length) throw new Error("A IA não gerou A-roll válido.");
  for(let i=0;i<plan.cuts.length;i++) {
    const c=plan.cuts[i], s=state.sourceById.get(String(c.sourceId));
    if(!s) throw new Error(`Plano usa sourceId inexistente na ação ${i+1}.`);
    const a=Number(c.inPoint),b=Number(c.outPoint),t=Number(c.timelineStart);
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a) throw new Error(`In/Out inválido na ação ${i+1}.`);
    if(!Number.isFinite(t)||t<0) throw new Error(`timelineStart inválido na ação ${i+1}.`);
    if(!inAllowedRange(s,a,b)) throw new Error(`Ação ${i+1} saiu do range permitido (${s.name}).`);
  }
  let cursor=0;
  for(const c of aroll) {
    if(Math.abs(Number(c.timelineStart)-cursor)>0.06) throw new Error("QC detectou gap/overlap no A-roll antes da execução.");
    cursor=Number(c.timelineStart)+(Number(c.outPoint)-Number(c.inPoint));
  }
  const intent=plan._intent || {};
  if(intent.requireAllSources) {
    const covered=new Set(aroll.map(c=>String(c.sourceId)));
    const missing=state.sources.filter(src=>!covered.has(String(src.sourceId)));
    if(missing.length) throw new Error(`QC bloqueou a execução: ${missing.length} vídeo(s) obrigatório(s) ainda ficaram fora da montagem.`);
  }
  if(intent.maxDurationSec && cursor>Number(intent.maxDurationSec)+0.03) throw new Error(`QC bloqueou a execução: duração ${cursor.toFixed(1)}s excede o máximo solicitado de ${Number(intent.maxDurationSec).toFixed(1)}s.`);
  if(intent.requireAllSources && intent.targetMinSec && cursor<Number(intent.targetMinSec)*0.72) throw new Error(`QC bloqueou uma montagem curta demais (${cursor.toFixed(1)}s) para o alvo solicitado.`);
  return true;
}

function makeRectF(width, height) {
  let rect=null;
  try { rect = new ppro.RectF(); } catch (_) {
    try { rect = ppro.RectF(); } catch (_) { rect=null; }
  }
  if (!rect) return null;
  rect.width=Number(width); rect.height=Number(height);
  return rect;
}

function outputDimensions(aspect) {
  if(aspect==="9:16") return {width:1080,height:1920};
  if(aspect==="16:9") return {width:1920,height:1080};
  if(aspect==="1:1") return {width:1080,height:1080};
  return null;
}

async function copyOriginalSequenceSettings(original, seq, intent = {}) {
  try {
    const settings = await original.getSettings();
    const dims=outputDimensions(intent.outputAspect);
    if(dims) {
      const rect=makeRectF(dims.width,dims.height);
      if(rect) {
        try { await settings.setVideoFrameRect(rect); } catch (error) { log(`Formato de vídeo: ${error.message||error}`); }
        try { await settings.setPreviewFrameRect(rect); } catch (_) {}
      }
    }
    let ok = false;
    state.project.lockedAccess(() => {
      ok = state.project.executeTransaction(compound => {
        compound.addAction(seq.createSetSettingsAction(settings));
      }, dims ? `Vinicius AI: sequência ${dims.width}x${dims.height}` : "Vinicius AI: copiar configurações da sequência");
    });
    if (!ok) log("Não foi possível aplicar todas as configurações da sequência de saída.");
    else if(dims) log(`✓ Formato de entrega forçado: ${dims.width}×${dims.height} (${intent.outputAspect}).`);
    return Boolean(ok);
  } catch (error) {
    log(`Configurações da sequência: ${error.message || error}`);
    return false;
  }
}

async function verifySequenceOutputFormat(seq, intent = {}) {
  const dims=outputDimensions(intent.outputAspect);
  if(!dims) return true;
  try {
    const frame=await seq.getFrameSize();
    const width=Number(frame?.width||0), height=Number(frame?.height||0);
    if(Math.abs(width-dims.width)>1 || Math.abs(height-dims.height)>1) {
      throw new Error(`sequência ficou ${width}×${height}, esperado ${dims.width}×${dims.height}`);
    }
    return true;
  } catch(error) {
    throw new Error(`Não consegui forçar a entrega ${intent.outputAspect} (${dims.width}×${dims.height}): ${error.message||error}`);
  }
}

async function createBlankTargetSequence(intent = {}) {
  const original = state.sourceSequence;
  const presetLabel=(DELIVERY_PRESETS[intent.deliveryPreset]||currentPreset()).label;
  const name = `Vinicius ${presetLabel} - ${original.name} - ${new Date().toLocaleTimeString().replace(/:/g,"-")}`;
  let seq = null;
  let createdFromMedia = false;

  try {
    seq = await state.project.createSequence(name, "");
  } catch (error) {
    log(`createSequence padrão falhou: ${error.message || error}`);
  }

  if (!seq) {
    const first = state.sources[0];
    const root = await state.project.getRootItem();
    seq = await state.project.createSequenceFromMedia(name, [first.clipProjectItem], ppro.ProjectItem.cast(root));
    if (!seq) throw new Error("Não consegui criar a sequência de saída.");
    createdFromMedia = true;
  }

  await state.project.setActiveSequence(seq);
  await state.project.openSequence(seq);

  if (createdFromMedia) await clearSequence(seq);
  const settingsOk=await copyOriginalSequenceSettings(original, seq, intent);
  if(outputDimensions(intent.outputAspect) && !settingsOk) throw new Error(`O Premiere não aceitou o formato de entrega ${intent.outputAspect}.`);
  await verifySequenceOutputFormat(seq,intent);
  return seq;
}

async function clearSequence(seq) {
  const editor = ppro.SequenceEditor.getEditor(seq);
  await seq.clearSelection();
  const selection = await seq.getSelection();
  const vCount = await seq.getVideoTrackCount();
  for (let i=0; i<vCount; i++) {
    const track = await seq.getVideoTrack(i);
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    items.forEach(item => selection.addItem(item, true));
  }
  const aCount = await seq.getAudioTrackCount();
  for (let i=0; i<aCount; i++) {
    const track = await seq.getAudioTrack(i);
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    items.forEach(item => selection.addItem(item, true));
  }
  const selected = await selection.getTrackItems();
  if (!selected.length) return;
  let ok = false;
  state.project.lockedAccess(() => {
    ok = state.project.executeTransaction(compound => {
      compound.addAction(editor.createRemoveItemsAction(selection, false, ppro.Constants.MediaType.ANY, true));
    }, "Vinicius AI: limpar sequência nova");
  });
  if (!ok) throw new Error("Não consegui limpar a sequência de saída.");
}

async function captureSourceInOut(source) {
  let inPoint = null, outPoint = null;
  try { inPoint = await source.clipProjectItem.getInPoint(ppro.Constants.MediaType.VIDEO); } catch (_) {}
  try { outPoint = await source.clipProjectItem.getOutPoint(ppro.Constants.MediaType.VIDEO); } catch (_) {}
  return { inPoint, outPoint };
}

function setSourceInOut(source, inSeconds, outSeconds, label) {
  const tin = ppro.TickTime.createWithSeconds(inSeconds);
  const tout = ppro.TickTime.createWithSeconds(outSeconds);
  let ok = false;
  state.project.lockedAccess(() => {
    ok = state.project.executeTransaction(compound => {
      compound.addAction(source.clipProjectItem.createSetInOutPointsAction(tin, tout));
    }, label);
  });
  return ok;
}

function restoreSourceInOut(source, old, label) {
  let ok = false;
  state.project.lockedAccess(() => {
    ok = state.project.executeTransaction(compound => {
      if (old?.inPoint && old?.outPoint) {
        compound.addAction(source.clipProjectItem.createSetInOutPointsAction(old.inPoint, old.outPoint));
      } else if (source.clipProjectItem.createClearInOutPointsAction) {
        compound.addAction(source.clipProjectItem.createClearInOutPointsAction());
      }
    }, label);
  });
  return ok;
}

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findTrackItem(seq, cut) {
  try {
    const track = await seq.getVideoTrack(Number(cut.videoTrack || 0));
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    let nearest = null;
    let nearestDelta = Infinity;

    for (const item of items) {
      const start = Number((await item.getStartTime()).seconds || 0);
      const delta = Math.abs(start - Number(cut.timelineStart));
      if (delta < nearestDelta) {
        nearest = item;
        nearestDelta = delta;
      }

      if (delta <= 0.12) {
        try {
          const pi = await item.getProjectItem();
          if (String(pi.getId()) === String(cut.sourceId)) return item;
        } catch (_) {
          return item;
        }
      }
    }

    // Em alguns frames o ProjectItem ainda não foi resolvido pelo host.
    // A posição temporal é uma identificação segura porque o plano não sobrepõe A-roll.
    if (nearest && nearestDelta <= 0.20) return nearest;
  } catch (_) {}
  return null;
}

function findTransformEffectMatch() {
  const catalog = state.effectCatalog || [];
  const needles = ["transform", "transformar"];
  for (const needle of needles) {
    const rec = catalog.find(x => `${x.displayName} ${x.matchName}`.toLowerCase().includes(needle));
    if (rec) return rec.matchName;
  }
  return null;
}

async function findExistingScaleParam(trackItem) {
  if (!trackItem) return null;
  try {
    const chain = await trackItem.getComponentChain();
    const count = chain.getComponentCount();
    for (let i = 0; i < count; i++) {
      const component = chain.getComponentAtIndex(i);
      let compName = "";
      try { compName = `${await component.getDisplayName()} ${await component.getMatchName()}`.toLowerCase(); } catch (_) {}
      const pc = component.getParamCount();
      for (let p = 0; p < pc; p++) {
        const param = component.getParam(p);
        const n = String(param.displayName || "").toLowerCase();
        if (/^scale$|escala|scale/.test(n) && (/motion|movimento|transform/.test(compName) || pc > 0)) return param;
      }
    }
  } catch (_) {}
  return null;
}

async function findScaleParam(trackItem) {
  if (!trackItem) return null;
  let param = await findExistingScaleParam(trackItem);
  if (param) return param;

  // Só a sequência AI pode receber esse fallback. A timeline de origem nunca é alterada.
  const matchName = findTransformEffectMatch();
  if (!matchName || !ppro.VideoFilterFactory?.createComponent) return null;

  try {
    const filter = await ppro.VideoFilterFactory.createComponent(matchName);
    const chain = await trackItem.getComponentChain();
    let ok = false;
    state.project.lockedAccess(() => {
      ok = state.project.executeTransaction(compound => {
        compound.addAction(chain.createAppendComponentAction(filter));
      }, "Vinicius AI: adicionar Transform");
    });
    if (ok) {
      await wait(80);
      param = await findExistingScaleParam(trackItem);
    }
  } catch (error) {
    log(`Transform fallback ignorado: ${error.message || error}`);
  }
  return param;
}


async function findPositionParam(trackItem) {
  if(!trackItem) return null;
  try {
    // findScaleParam may append Transform when Motion/Transform is not exposed.
    await findScaleParam(trackItem);
    const chain=await trackItem.getComponentChain();
    const count=chain.getComponentCount();
    for(let i=0;i<count;i++){
      const component=chain.getComponentAtIndex(i);
      let compName="";
      try { compName=`${await component.getDisplayName()} ${await component.getMatchName()}`.toLowerCase(); } catch (_) {}
      const pc=component.getParamCount();
      for(let j=0;j<pc;j++){
        const param=component.getParam(j);
        const n=String(param.displayName||"").toLowerCase();
        if((/^position$|posição|posicao|position/.test(n)) && (/motion|movimento|transform/.test(compName) || pc>0)) return param;
      }
    }
  } catch (_) {}
  return null;
}

function makePointF(x,y) {
  const nx=Number(x), ny=Number(y);
  let point=null;
  try { point=ppro.PointF(nx,ny); } catch (_) {
    try { point=new ppro.PointF(); } catch (_) { point=null; }
    if(point){ point.x=nx; point.y=ny; }
  }
  return point;
}

function normalizedMotionPoint(xOffset=0, yOffset=0) {
  // Motion > Position in Premiere uses normalized coordinates: center = (0.5, 0.5).
  // Pixel coordinates such as (540, 960) are interpreted as huge normalized values and can push the image fully off-canvas.
  const x=clampNumber(0.5 + Number(xOffset||0), -0.25, 1.25, 0.5);
  const y=clampNumber(0.5 + Number(yOffset||0), -0.25, 1.25, 0.5);
  return makePointF(x,y);
}

async function setNumericParamValue(param, value, label) {
  if(!param) return false;
  let ok=false;
  try {
    state.project.lockedAccess(()=>{
      ok=state.project.executeTransaction(compound=>{
        if(param.isTimeVarying && param.isTimeVarying()) compound.addAction(param.createSetTimeVaryingAction(false));
        const k=param.createKeyframe(Number(value));
        compound.addAction(param.createSetValueAction(k,true));
      },label);
    });
  } catch(error){ log(`${label}: ${error.message||error}`); return false; }
  return Boolean(ok);
}

async function applyAutoReframe(seq, trackItem, cut, punch=100, intent={}) {
  if(!intent.autoReframe || !el.optAutoReframe?.checked || !trackItem) return false;
  const tech=sanitizeTechnical(cut?._technical || neutralTechnical(), {requestColorGrade:true,requestFineMix:true,autoReframe:true});
  const scaleParam=await findScaleParam(trackItem);
  const positionParam=await findPositionParam(trackItem);
  let baseScale=100;
  try {
    const source=state.sourceById.get(String(cut.sourceId));
    let originalScale=100;
    if(source?.baselineTrackItem){
      const originalScaleParam=await findExistingScaleParam(source.baselineTrackItem);
      if(originalScaleParam){
        const k=await originalScaleParam.getStartValue();
        const n=numericKeyframeValue(k);
        if(Number.isFinite(n) && n>0.01) originalScale=n;
      }
    } else if(scaleParam) {
      const k=await scaleParam.getStartValue();
      const n=numericKeyframeValue(k);
      if(Number.isFinite(n) && n>0.01) originalScale=n;
    }
    const sourceFrame=await state.sourceSequence.getFrameSize();
    const targetFrame=await seq.getFrameSize();
    const sw=Number(sourceFrame?.width||0), sh=Number(sourceFrame?.height||0);
    const tw=Number(targetFrame?.width||0), th=Number(targetFrame?.height||0);
    const geometricFactor=(sw>0&&sh>0&&tw>0&&th>0)?Math.max(tw/sw,th/sh):1;
    baseScale=originalScale*geometricFactor;
  } catch(error){ log(`Auto Reframe: escala geométrica caiu para fallback (${error.message||error}).`); }
  const creativeZoom=Math.max(1,Math.min(1.35,Number(tech.reframeScale||100)/100));
  const punchZoom=Math.max(1,Number(punch||100)/100);
  const scale=Math.max(1,Math.min(500,baseScale*creativeZoom*punchZoom));
  let applied=false;
  if(scaleParam) applied=await setNumericParamValue(scaleParam,scale,`Vinicius AI: Auto Reframe scale ${scale.toFixed(1)}%`) || applied;

  if(positionParam) {
    try {
      const startPoint=normalizedMotionPoint(tech.reframeXStart,tech.reframeYStart);
      const endPoint=normalizedMotionPoint(tech.reframeXEnd,tech.reframeYEnd);
      if(startPoint && endPoint) {
        const moving=Math.abs(Number(tech.reframeXEnd)-Number(tech.reframeXStart))+Math.abs(Number(tech.reframeYEnd)-Number(tech.reframeYStart))>0.025;
        let ok=false;
        if(moving && positionParam.areKeyframesSupported && await positionParam.areKeyframesSupported()) {
          const dur=Math.max(0.05,Number(cut.outPoint)-Number(cut.inPoint));
          const t0=ppro.TickTime.createWithSeconds(Number(cut.timelineStart||0));
          const t1=ppro.TickTime.createWithSeconds(Number(cut.timelineStart||0)+dur);
          state.project.lockedAccess(()=>{
            ok=state.project.executeTransaction(compound=>{
              compound.addAction(positionParam.createSetTimeVaryingAction(true));
              const k0=positionParam.createKeyframe(startPoint); k0.position=t0;
              const k1=positionParam.createKeyframe(endPoint); k1.position=t1;
              compound.addAction(positionParam.createAddKeyframeAction(k0));
              compound.addAction(positionParam.createAddKeyframeAction(k1));
              try { compound.addAction(positionParam.createSetInterpolationAtKeyframeAction(t0,ppro.Constants.InterpolationMode.BEZIER,true)); } catch (_) {}
              try { compound.addAction(positionParam.createSetInterpolationAtKeyframeAction(t1,ppro.Constants.InterpolationMode.BEZIER,true)); } catch (_) {}
            },"Vinicius AI: Auto Reframe tracking");
          });
        } else {
          state.project.lockedAccess(()=>{
            ok=state.project.executeTransaction(compound=>{
              if(positionParam.isTimeVarying && positionParam.isTimeVarying()) compound.addAction(positionParam.createSetTimeVaryingAction(false));
              const k=positionParam.createKeyframe(startPoint);
              compound.addAction(positionParam.createSetValueAction(k,true));
            },"Vinicius AI: Auto Reframe position");
          });
        }
        applied=Boolean(ok)||applied;
      }
    } catch(error){ log(`Auto Reframe Position ignorado: ${error.message||error}`); }
  }
  if(applied){ state.styleStats.autoReframed++; if(punch>100.5) state.styleStats.punchIns++; }
  return applied;
}

async function applyPunchIn(trackItem, percent) {
  if (!trackItem || !percent || Math.abs(Number(percent) - 100) < 0.5) return false;
  try {
    const scaleParam = await findScaleParam(trackItem);
    if (!scaleParam) {
      log(`Punch-in ${percent}% não aplicado: parâmetro Scale não encontrado.`);
      return false;
    }

    let ok = false;
    state.project.lockedAccess(() => {
      ok = state.project.executeTransaction(compound => {
        const kf = scaleParam.createKeyframe(Number(percent));
        compound.addAction(scaleParam.createSetValueAction(kf, true));
      }, `Vinicius AI: punch-in ${percent}%`);
    });

    if (ok) {
      state.styleStats.punchIns++;
      log(`✓ Punch-in ${percent}% aplicado.`);
      return true;
    }
  } catch (error) {
    log(`Punch-in falhou: ${error.message || error}`);
  }
  return false;
}

function autoPunchForCut(cut, index, cuts) {
  if (!el.optStyle?.checked || cut.role !== "a-roll") return 100;
  const requested = Number(cut.punchIn || 100);
  return requested > 100.5 ? Math.max(100, Math.min(112, requested)) : 100;
}


async function getSequenceFrameSeconds(seq) {
  const TICKS_PER_SECOND = 254016000000;
  try {
    const ticks = Number(await seq.getTimebase());
    const sec = ticks / TICKS_PER_SECOND;
    if (Number.isFinite(sec) && sec > 0 && sec < 0.2) return sec;
  } catch (_) {}
  return 1 / 30;
}

function transitionDurationSeconds(type, forBroll = false) {
  const style = el.stylePreset?.value || "tiktok";
  if (forBroll) return style === "institutional" ? 0.22 : 0.16;
  if (type === "dip_black") return style === "institutional" ? 0.46 : style === "talking" ? 0.38 : 0.32;
  return style === "institutional" ? 0.34 : style === "talking" ? 0.28 : 0.22;
}

async function resolveTransitionCatalog() {
  if (!ppro.TransitionFactory?.getVideoTransitionMatchNames || !ppro.TransitionFactory?.createVideoTransition) {
    log("Transições: TransitionFactory indisponível neste Premiere.");
    return null;
  }
  try {
    const names = await ppro.TransitionFactory.getVideoTransitionMatchNames();
    const list = Array.isArray(names) ? names : [];
    const find = (patterns) => {
      for (const pattern of patterns) {
        const hit = list.find(name => pattern.test(String(name)));
        if (hit) return hit;
      }
      return null;
    };
    const cross = find([
      /^AE\.ADBE Cross Dissolve New$/i,
      /^ADBE Cross Dissolve New$/i,
      /^ADBE Cross Dissolve$/i,
      /cross\s*dissolve/i
    ]);
    const dipBlack = find([
      /dip\s*(to)?\s*black/i,
      /dip.*black/i,
      /black.*dip/i
    ]);
    log(`Catálogo de transições: ${list.length} instalada(s); Cross Dissolve=${cross || "não localizada"}; Dip to Black=${dipBlack || "não localizada"}.`);
    return { cross, dipBlack, names: list };
  } catch (error) {
    log(`Transições: falha ao ler catálogo (${error.message || error}).`);
    return null;
  }
}

function centeredTransitionHasHandles(prevCut, cut, durationSec, frameSec) {
  if (!prevCut || !cut) return false;
  const prevSource = state.sourceById.get(String(prevCut.sourceId));
  const curSource = state.sourceById.get(String(cut.sourceId));
  const prevRange = allowedRangeForCut(prevSource, Number(prevCut.inPoint), Number(prevCut.outPoint));
  const curRange = allowedRangeForCut(curSource, Number(cut.inPoint), Number(cut.outPoint));
  if (!prevRange || !curRange) return false;
  const need = durationSec / 2 + frameSec;
  const tail = Number(prevRange.end) - Number(prevCut.outPoint);
  const head = Number(cut.inPoint) - Number(curRange.start);
  return tail >= need && head >= need;
}

async function addTransitionToTrackItem(trackItem, matchName, applyToStart, durationSec, forceSingleSided, label) {
  if (!trackItem || !matchName) return false;
  try {
    const transition = await ppro.TransitionFactory.createVideoTransition(matchName);
    if (!transition) return false;
    const options = ppro.AddTransitionOptions();
    options.setApplyToStart(Boolean(applyToStart));
    options.setDuration(ppro.TickTime.createWithSeconds(Math.max(0.06, Number(durationSec || 0.2))));
    options.setForceSingleSided(Boolean(forceSingleSided));

    let ok = false;
    state.project.lockedAccess(() => {
      ok = state.project.executeTransaction(compound => {
        compound.addAction(trackItem.createAddVideoTransitionAction(transition, options));
      }, label || "Vinicius AI: adicionar transição");
    });
    return Boolean(ok);
  } catch (error) {
    log(`${label || "Transição"} ignorada: ${error.message || error}`);
    return false;
  }
}

async function applySmartTransitions(seq, plan, cuts, insertedByIndex) {
  state.styleStats.transitionsApplied = 0;
  state.styleStats.transitionsSkipped = 0;
  if (!el.optTransitions?.checked) {
    log("Transições desativadas pelo usuário.");
    return;
  }

  const catalog = await resolveTransitionCatalog();
  if (!catalog?.cross && !catalog?.dipBlack) return;
  const frameSec = await getSequenceFrameSeconds(seq);
  const arollEntries = [];
  const brollEntries = [];

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const item = insertedByIndex.get(i) || await findTrackItem(seq, cut);
    if (!item) continue;
    (cut.role === "b-roll" ? brollEntries : arollEntries).push({ cut, item, index: i });
  }

  // A-roll: only model-approved editorial transitions.
  for (let i = 1; i < arollEntries.length; i++) {
    const prev = arollEntries[i - 1];
    const cur = arollEntries[i];
    const type = String(cur.cut.transitionIn || "none");
    if (type === "none") continue;

    const prevEnd = Number(prev.cut.timelineStart) + (Number(prev.cut.outPoint) - Number(prev.cut.inPoint));
    const contiguous = Math.abs(prevEnd - Number(cur.cut.timelineStart)) <= Math.max(0.08, frameSec * 2);
    if (!contiguous) {
      state.styleStats.transitionsSkipped++;
      log(`Transição ${type} ignorada: edit point não está contíguo.`);
      continue;
    }

    const duration = transitionDurationSeconds(type, false);
    let ok = false;

    if (type === "cross_dissolve") {
      if (!catalog.cross) {
        state.styleStats.transitionsSkipped++;
        continue;
      }
      if (centeredTransitionHasHandles(prev.cut, cur.cut, duration, frameSec)) {
        ok = await addTransitionToTrackItem(
          cur.item, catalog.cross, true, duration, false,
          `Vinicius AI: Cross Dissolve ${(duration*1000).toFixed(0)}ms`
        );
      } else {
        // Sem handles para uma transição centrada: tenta o modo single-sided oficial,
        // que é muito mais tolerante e evita simplesmente ignorar o pedido do usuário.
        ok = await addTransitionToTrackItem(
          cur.item, catalog.cross, true, Math.min(duration,0.18), true,
          `Vinicius AI: Cross Dissolve single-sided seguro`
        );
        if(ok) log("✓ Cross Dissolve aplicado em modo single-sided por falta de handles.");
      }
    } else if (type === "dip_black") {
      const match = catalog.dipBlack || catalog.cross;
      if (!match) continue;
      if (centeredTransitionHasHandles(prev.cut, cur.cut, duration, frameSec)) {
        ok = await addTransitionToTrackItem(
          cur.item, match, true, duration, false,
          `Vinicius AI: Dip to Black ${(duration*1000).toFixed(0)}ms`
        );
      } else {
        ok = await addTransitionToTrackItem(
          cur.item, match, true, duration, true,
          `Vinicius AI: Dip/Fade seguro ${(duration*1000).toFixed(0)}ms`
        );
      }
    }

    if (ok) {
      state.styleStats.transitionsApplied++;
      log(`✓ Transição ${type} aplicada no edit point ${i}.`);
    } else {
      state.styleStats.transitionsSkipped++;
    }
  }

  // B-roll is on V2 above A-roll. Single-sided Cross Dissolve becomes a clean
  // fade to/from the underlying A-roll and does not require a neighboring clip.
  if (catalog.cross) {
    for (const entry of brollEntries) {
      const dur = Number(entry.cut.outPoint) - Number(entry.cut.inPoint);
      if (dur < 0.85) continue;
      const fade = Math.min(transitionDurationSeconds("cross_dissolve", true), Math.max(0.08, dur * 0.18));
      const startOk = await addTransitionToTrackItem(
        entry.item, catalog.cross, true, fade, true,
        `Vinicius AI: fade-in B-roll ${(fade*1000).toFixed(0)}ms`
      );
      await wait(18);
      const endOk = await addTransitionToTrackItem(
        entry.item, catalog.cross, false, fade, true,
        `Vinicius AI: fade-out B-roll ${(fade*1000).toFixed(0)}ms`
      );
      if (startOk) state.styleStats.transitionsApplied++; else state.styleStats.transitionsSkipped++;
      if (endOk) state.styleStats.transitionsApplied++; else state.styleStats.transitionsSkipped++;
    }
  }

  log(`Transições concluídas: ${state.styleStats.transitionsApplied} aplicada(s), ${state.styleStats.transitionsSkipped} ignorada(s) com segurança.`);
}


function normalizedLabel(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function findLumetriMatchName() {
  const catalog=state.effectCatalog || [];
  const rec=catalog.find(x=>/lumetri/i.test(`${x.displayName || ""} ${x.matchName || ""}`));
  return rec?.matchName || null;
}

async function scanComponentByName(trackItem, pattern) {
  try {
    const chain=await trackItem.getComponentChain();
    const count=chain.getComponentCount();
    for(let i=0;i<count;i++) {
      const component=chain.getComponentAtIndex(i);
      let name="";
      try { name=`${await component.getDisplayName()} ${await component.getMatchName()}`; } catch (_) {}
      if(pattern.test(name)) return component;
    }
  } catch (_) {}
  return null;
}

async function findOrAppendLumetri(trackItem) {
  if(!trackItem) return null;
  let component=await scanComponentByName(trackItem,/lumetri/i);
  if(component) return component;
  const matchName=findLumetriMatchName();
  if(!matchName || !ppro.VideoFilterFactory?.createComponent) return null;
  try {
    const filter=await ppro.VideoFilterFactory.createComponent(matchName);
    const chain=await trackItem.getComponentChain();
    let ok=false;
    state.project.lockedAccess(()=>{
      ok=state.project.executeTransaction(compound=>{
        compound.addAction(chain.createAppendComponentAction(filter));
      },"Vinicius AI: adicionar Lumetri Color");
    });
    if(!ok) return null;
    await wait(70);
    component=await scanComponentByName(trackItem,/lumetri/i);
    return component;
  } catch(error) {
    log(`Color grading: Lumetri não pôde ser adicionado (${error.message || error}).`);
    return null;
  }
}

function findComponentParamByLabels(component, labels) {
  if(!component) return null;
  const wanted=labels.map(normalizedLabel);
  const count=component.getParamCount();
  let fuzzy=null;
  for(let i=0;i<count;i++) {
    const param=component.getParam(i);
    const name=normalizedLabel(param?.displayName);
    if(!name) continue;
    if(wanted.includes(name)) return param;
    if(!fuzzy && wanted.some(w=>name.includes(w))) fuzzy=param;
  }
  return fuzzy;
}

function numericKeyframeValue(keyframe) {
  const candidates=[keyframe?.value?.value,keyframe?.value,keyframe];
  for(const v of candidates) {
    if(typeof v === "number" && Number.isFinite(v)) return v;
    if(typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

async function prepareParamDeltaAction(component, labels, delta, mode="linear") {
  if(Math.abs(Number(delta || 0)) < 0.001) return null;
  const param=findComponentParamByLabels(component,labels);
  if(!param) return null;
  try {
    const start=await param.getStartValue();
    const current=numericKeyframeValue(start);
    if(current === null) return null;
    let target=current + Number(delta);
    if(mode === "exposure") target=clampNumber(target,-2,2,current);
    else if(mode === "temperature") target=clampNumber(target,-35,35,current);
    else if(mode === "tint") target=clampNumber(target,-30,30,current);
    else if(mode === "contrast") target=clampNumber(target,-40,40,current);
    else if(mode === "saturation") {
      if(current > 20) target=clampNumber(current + Number(delta),70,130,current);
      else if(current >= 0.15 && current <= 3) target=clampNumber(current + Number(delta)/100,0.70,1.30,current);
      else return null;
    }
    const key=param.createKeyframe(target);
    return { param, key, target };
  } catch (_) {
    return null;
  }
}

function gradeForCut(cut) {
  const t=sanitizeTechnical(cut?._technical || neutralTechnical(), { requestColorGrade:true, requestFineMix:true, autoReframe:true });
  const style=el.stylePreset?.value || "tiktok";
  const base=style === "tiktok"
    ? { contrast:3.0, saturation:2.5 }
    : style === "talking"
      ? { contrast:2.0, saturation:1.5 }
      : { contrast:1.0, saturation:0.5 };
  return {
    exposure:clampNumber(t.exposure,-0.35,0.35,0),
    temperature:clampNumber(t.temperature,-10,10,0),
    tint:clampNumber(t.tint,-6,6,0),
    contrast:clampNumber(t.contrast + base.contrast,-12,14,base.contrast),
    saturation:clampNumber(t.saturation + base.saturation,-8,10,base.saturation)
  };
}

async function applyColorGrade(trackItem, cut) {
  if(!el.optColorGrade?.checked || !trackItem) return false;
  const component=await findOrAppendLumetri(trackItem);
  if(!component) {
    state.styleStats.colorSkipped++;
    return false;
  }
  const g=gradeForCut(cut);
  const specs=[
    [["exposure","exposicao"],g.exposure,"exposure"],
    [["temperature","temperatura"],g.temperature,"temperature"],
    [["tint","matiz"],g.tint,"tint"],
    [["contrast","contraste"],g.contrast,"contrast"],
    [["saturation","saturacao"],g.saturation,"saturation"]
  ];
  const prepared=[];
  for(const [labels,delta,mode] of specs) {
    const item=await prepareParamDeltaAction(component,labels,delta,mode);
    if(item) prepared.push(item);
  }
  if(!prepared.length) {
    state.styleStats.colorSkipped++;
    return false;
  }
  let ok=false;
  try {
    state.project.lockedAccess(()=>{
      ok=state.project.executeTransaction(compound=>{
        for(const item of prepared) {
          if(item.param.isTimeVarying && item.param.isTimeVarying()) compound.addAction(item.param.createSetTimeVaryingAction(false));
          compound.addAction(item.param.createSetValueAction(item.key,true));
        }
      },"Vinicius AI: color grading Lumetri");
    });
  } catch(error) {
    log(`Color grading falhou: ${error.message || error}`);
    ok=false;
  }
  if(ok) state.styleStats.colorGraded++;
  else state.styleStats.colorSkipped++;
  return Boolean(ok);
}

async function applyFinishingPass(seq, plan, insertedByIndex) {
  state.styleStats.punchIns = 0;
  state.styleStats.autoReframed = 0;
  state.styleStats.colorGraded = 0;
  state.styleStats.colorSkipped = 0;

  const cuts = [...plan.cuts].sort((a,b) => Number(a.timelineStart)-Number(b.timelineStart) || Number(a.videoTrack)-Number(b.videoTrack));
  await wait(220);

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const trackItem = insertedByIndex.get(i) || await findTrackItem(seq, cut);
    if (!trackItem) {
      log(`Acabamento ignorado no corte ${i + 1}: TrackItem não localizado após inserção.`);
      continue;
    }

    const punch = el.optStyle?.checked ? autoPunchForCut(cut, i, cuts) : 100;
    const intent=plan?._intent || {};
    if(intent.autoReframe && el.optAutoReframe?.checked) await applyAutoReframe(seq,trackItem,cut,punch,intent);
    else if (punch > 100.5) await applyPunchIn(trackItem, punch);
    if (el.optColorGrade?.checked) await applyColorGrade(trackItem, cut);
  }

  await applySmartTransitions(seq, plan, cuts, insertedByIndex);
  log(`Acabamento: ${state.styleStats.autoReframed} Auto Reframe(s), ${state.styleStats.punchIns} punch-in(s), ${state.styleStats.transitionsApplied} transição(ões), ${state.styleStats.colorGraded} clip(s) com color grading. Morph Cut continua proibido.`);
}

async function verifyV1Continuity(seq) {
  try {
    const track = await seq.getVideoTrack(0);
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    if (!items?.length) throw new Error("A sequência final não contém A-roll em V1.");
    const spans = [];
    for (const item of items) {
      spans.push({
        start: Number((await item.getStartTime()).seconds || 0),
        end: Number((await item.getEndTime()).seconds || 0)
      });
    }
    spans.sort((a,b) => a.start - b.start);
    if (spans[0].start > 0.08) throw new Error(`A timeline final começa com ${(spans[0].start).toFixed(3)}s de espaço vazio.`);
    for (let i = 1; i < spans.length; i++) {
      const gap = spans[i].start - spans[i - 1].end;
      if (gap > 0.08) {
        throw new Error(`Foi detectado um espaço vazio de ${gap.toFixed(3)}s entre os cortes ${i} e ${i + 1}. A edição foi interrompida para não entregar timeline quebrada.`);
      }
    }
    log(`✓ Continuidade V1 verificada: ${spans.length} clipes sem gaps > 80 ms.`);
    return true;
  } catch (error) {
    if (/timeline final|espaço vazio|A-roll/.test(String(error?.message || error))) throw error;
    log(`Verificação de continuidade não pôde ser concluída: ${error.message || error}`);
    return false;
  }
}

async function configureEditorialAudioTracks(seq, plan) {
  // A1 = voz principal. A2 = áudio acompanhante de B-roll (silenciado).
  // Música é reservada para A3, evitando som duplicado de segunda câmera.
  const hasBroll = Array.isArray(plan?.cuts) && plan.cuts.some(c => c.role === "b-roll");
  if (!hasBroll) return;
  try {
    const count = await seq.getAudioTrackCount();
    if (count > 1) {
      const brollTrack = await seq.getAudioTrack(1);
      const ok = await brollTrack.setMute(true);
      log(`✓ A2 (áudio de B-roll/segunda câmera) ${ok ? "silenciada" : "solicitada como mute"}; voz preservada em A1.`);
    }
  } catch (error) { log(`Áudio B-roll: não consegui silenciar A2: ${error.message || error}`); }
}


async function findAudioTrackItem(seq, cut) {
  if(!seq || !cut) return null;
  const trackIndex=Number(cut.audioTrack ?? 0);
  try {
    const track=await seq.getAudioTrack(trackIndex);
    const items=await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
    let nearest=null, nearestDelta=Infinity;
    for(const item of items) {
      const start=Number((await item.getStartTime()).seconds || 0);
      const delta=Math.abs(start-Number(cut.timelineStart || 0));
      if(delta<nearestDelta){ nearest=item; nearestDelta=delta; }
      if(delta<=0.12) {
        try {
          const pi=await item.getProjectItem();
          if(String(pi.getId())===String(cut.sourceId)) return item;
        } catch (_) {
          return item;
        }
      }
    }
    if(nearest && nearestDelta<=0.20) return nearest;
  } catch (_) {}
  return null;
}

function smoothedVoiceGain(cuts, index) {
  const current=clampNumber(cuts[index]?._technical?.voiceGainDb,-5,5,0);
  if(index===0) return current;
  const prev=clampNumber(cuts[index-1]?._appliedVoiceGainDb ?? cuts[index-1]?._technical?.voiceGainDb,-5,5,0);
  return clampNumber(current,prev-3.5,prev+3.5,current);
}

async function applyFineMix(seq, plan) {
  state.styleStats.voiceMixed=0;
  state.styleStats.voiceMixSkipped=0;
  if(!el.optFineMix?.checked) {
    log("Mixagem fina desativada pelo usuário.");
    return;
  }

  const mode=plan?._intent?.contentProfile?.mode || state.contentProfile?.mode || "mixed";
  if(mode==="visual" && Number(plan?._intent?.contentProfile?.observedSpeechRatio||0)<0.12) {
    log("Mixagem fina: contexto visual/performance sem fala relevante; voz não é tratada como eixo principal. A1 é preservada e a música pode conduzir o vídeo.");
    return;
  }

  const aroll=(plan?.cuts || []).filter(c=>c.role!=="b-roll").sort((a,b)=>Number(a.timelineStart)-Number(b.timelineStart));
  for(let i=0;i<aroll.length;i++) {
    const cut=aroll[i];
    const gain=smoothedVoiceGain(aroll,i);
    cut._appliedVoiceGainDb=gain;
    if(Math.abs(gain)<0.20) continue;
    const audioItem=await findAudioTrackItem(seq,cut);
    if(!audioItem) {
      state.styleStats.voiceMixSkipped++;
      continue;
    }
    const ok=await setAudioVolumeDb(audioItem,gain,"Vinicius AI: nivelar voz");
    if(ok) state.styleStats.voiceMixed++;
    else state.styleStats.voiceMixSkipped++;
  }
  log(`Mixagem fina: ${state.styleStats.voiceMixed} take(s) de voz nivelado(s), ${state.styleStats.voiceMixSkipped} ajuste(s) ignorado(s); A2 permanece reservada ao B-roll e A3 à música.`);
}

async function executePlan(plan) {
  progress(68, "Montando nova sequência no Premiere…");
  if (!el.optNewSequence?.checked) throw new Error("Por segurança, a edição automática só pode ser criada em uma nova sequência.");

  const seq = await createBlankTargetSequence(plan?._intent || {});
  state.targetSequence = seq;
  await state.project.setActiveSequence(seq);
  await state.project.openSequence(seq);

  const editor = ppro.SequenceEditor.getEditor(seq);
  if (!editor) throw new Error("SequenceEditor indisponível.");

  const savedInOut = new Map();
  for (const source of state.sources) savedInOut.set(source.sourceId, await captureSourceInOut(source));

  const cuts = [...plan.cuts].sort((a,b) =>
    Number(a.timelineStart)-Number(b.timelineStart) || Number(a.videoTrack)-Number(b.videoTrack)
  );
  const insertedByIndex = new Map();
  let knownVideoTracks = await seq.getVideoTrackCount();
  let knownAudioTracks = await seq.getAudioTrackCount();
  let executionError = null;

  try {
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i];
      const source = state.sourceById.get(String(cut.sourceId));
      progress(70 + Math.round((i / Math.max(1,cuts.length)) * 16), `Aplicando corte ${i+1}/${cuts.length}: ${source.name}`);

      if (!setSourceInOut(source, Number(cut.inPoint), Number(cut.outPoint), `Vinicius AI: In/Out ${source.name}`)) {
        throw new Error(`Não consegui definir In/Out em ${source.name}.`);
      }

      const time = ppro.TickTime.createWithSeconds(Number(cut.timelineStart));
      const v = Number(cut.videoTrack || 0);
      const a = Number(cut.audioTrack ?? (cut.role === "b-roll" ? 1 : 0));
      const needsTrackCreation = v >= knownVideoTracks || a >= knownAudioTracks;
      let ok = false;
      state.project.lockedAccess(() => {
        ok = state.project.executeTransaction(compound => {
          const action = needsTrackCreation
            ? editor.createInsertProjectItemAction(source.projectItem, time, v, a, true)
            : editor.createOverwriteItemAction(source.projectItem, time, v, a);
          compound.addAction(action);
        }, `Vinicius AI: inserir ${source.name}`);
      });
      if (!ok) throw new Error(`Premiere recusou o corte de ${source.name}.`);
      if (needsTrackCreation) {
        knownVideoTracks = Math.max(knownVideoTracks, v + 1);
        knownAudioTracks = Math.max(knownAudioTracks, a + 1);
        log(`✓ Track criada sob demanda para ${cut.role === "b-roll" ? "B-roll" : "A-roll"}: V${v+1}/A${a+1}.`);
      }

      await wait(35);
      const inserted = await findTrackItem(seq, cut);
      if (inserted) insertedByIndex.set(i, inserted);
    }

    progress(87, "Aplicando color grading e acabamento visual…");
    await applyFinishingPass(seq, plan, insertedByIndex);
    progress(90, "Fazendo mixagem fina da voz…");
    await configureEditorialAudioTracks(seq, plan);
    await applyFineMix(seq, plan);
    progress(92, "Aplicando identidade visual…");
    await applyBranding(seq, plan);
    await verifyV1Continuity(seq);
  } catch (error) {
    executionError = error;
  } finally {
    for (const source of state.sources) {
      try {
        restoreSourceInOut(source, savedInOut.get(source.sourceId), `Vinicius AI: restaurar In/Out ${source.name}`);
      } catch (_) {}
    }
  }

  if (executionError) {
    log(`Execução falhou; removendo sequência parcial: ${executionError.message || executionError}`);
    try {
      await state.project.setActiveSequence(state.sourceSequence);
      await state.project.openSequence(state.sourceSequence);
      if (state.project.deleteSequence) await state.project.deleteSequence(seq);
    } catch (cleanupError) {
      log(`Não foi possível remover a sequência parcial automaticamente: ${cleanupError.message || cleanupError}`);
    }
    throw executionError;
  }

  await state.project.save();
  return seq;
}


function isAudioPath(path) {
  const ext = String(path || "").split(".").pop().toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

async function getAllProjectItems() {
  const root = await state.project.getRootItem();
  const out = [];
  const walk = async (folder, depth = 0) => {
    if (!folder || depth > 12) return;
    let items = [];
    try { items = await folder.getItems(); } catch (_) { return; }
    for (const item of items) {
      out.push(item);
      try {
        const asFolder = ppro.FolderItem.cast(item);
        const children = await asFolder.getItems();
        if (Array.isArray(children)) await walk(asFolder, depth + 1);
      } catch (_) {}
    }
  };
  await walk(root);
  return out;
}

async function findProjectItemByNameOrPath(name, nativePath = "") {
  const items = await getAllProjectItems();
  const targetName = String(name || "").toLowerCase();
  const targetPath = normalizePath(nativePath).toLowerCase();

  for (const item of items) {
    if (String(item.name || "").toLowerCase() === targetName) return item;
  }

  if (targetPath) {
    for (const item of items) {
      try {
        const clip = ppro.ClipProjectItem.cast(item);
        const p = normalizePath(await clip.getMediaFilePath()).toLowerCase();
        if (p === targetPath) return item;
      } catch (_) {}
    }
  }

  const stem = targetName.replace(/\.[^.]+$/, "");
  return items.find(item => String(item.name || "").toLowerCase().replace(/\.[^.]+$/, "") === stem) || null;
}

async function chooseMusicFolder() {
  const folder = await localFileSystem.getFolder();
  if (!folder) return null;
  const token = await localFileSystem.createPersistentToken(folder);
  localStorage.setItem(MUSIC_FOLDER_TOKEN, token);
  await updateMusicFolderStatus();
  result(`🎵 Biblioteca de músicas salva: ${folder.name}`);
  return folder;
}

async function getMusicFolder() {
  const token = localStorage.getItem(MUSIC_FOLDER_TOKEN);
  if (!token) return null;
  try {
    const folder = await localFileSystem.getEntryForPersistentToken(token);
    return folder?.isFolder ? folder : null;
  } catch (_) {
    localStorage.removeItem(MUSIC_FOLDER_TOKEN);
    return null;
  }
}

async function clearMusicFolder() {
  localStorage.removeItem(MUSIC_FOLDER_TOKEN);
  await updateMusicFolderStatus();
  result("Pasta de músicas removida. O plugin continuará usando apenas músicas já importadas no projeto.");
}

async function updateMusicFolderStatus() {
  if (!el.musicFolderStatus) return;
  const folder = await getMusicFolder();
  el.musicFolderStatus.textContent = folder
    ? `Pasta adicional: ${folder.name}. Também usa músicas já importadas no projeto.`
    : "Usa músicas já importadas no projeto. Nenhuma pasta adicional configurada.";
}

async function scanMusicFolder(folder, maxFiles = 30) {
  const out = [];
  const walk = async (dir, depth = 0) => {
    if (!dir || depth > 3 || out.length >= maxFiles) return;
    let entries = [];
    try { entries = await dir.getEntries(); } catch (_) { return; }
    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      if (entry.isFolder) {
        await walk(entry, depth + 1);
      } else if (entry.isFile && isAudioPath(entry.name)) {
        out.push({
          candidateId: `folder:${out.length}:${entry.name}`,
          name: entry.name,
          path: entry.nativePath,
          projectItem: null,
          entry
        });
      }
    }
  };
  await walk(folder);
  return out;
}

async function scanProjectMusic() {
  const items = await getAllProjectItems();
  const out = [];
  for (const item of items) {
    if (out.length >= 20) break;
    try {
      const clip = ppro.ClipProjectItem.cast(item);
      if (await clip.isSequence()) continue;
      const path = await clip.getMediaFilePath();
      if (!path || !isAudioPath(path)) continue;
      out.push({
        candidateId: `project:${item.getId()}`,
        name: item.name || basename(path),
        path,
        projectItem: item,
        entry: null
      });
    } catch (_) {}
  }
  return out;
}

async function collectMusicCandidates() {
  if (!el.optMusic?.checked) return [];

  const projectCandidates = await scanProjectMusic();
  let folder = await getMusicFolder();

  // Nunca abre o Finder automaticamente. Sem música disponível, a edição segue sem trilha.

  const folderCandidates = folder ? await scanMusicFolder(folder) : [];

  const seen = new Set();
  const merged = [];
  for (const c of [...projectCandidates, ...folderCandidates]) {
    const key = normalizePath(c.path).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }

  state.musicCandidates = merged.slice(0, 30);
  log(`Música: ${state.musicCandidates.length} candidata(s) encontrada(s).`);
  return state.musicCandidates;
}

function chooseMusicCandidatesForAnalysis(candidates) {
  if (candidates.length <= MAX_MUSIC_FILES) return [...candidates];
  const out=[]; const seen=new Set();
  for(let i=0;i<MAX_MUSIC_FILES;i++) {
    const idx=Math.round(i*(candidates.length-1)/Math.max(1,MAX_MUSIC_FILES-1));
    const c=candidates[idx]; if(c && !seen.has(c.candidateId)){ seen.add(c.candidateId); out.push(c); }
  }
  return out;
}

async function uploadMusicCandidates(apiKey, candidates) {
  const chosen = chooseMusicCandidatesForAnalysis(candidates);
  const uploaded = [];
  for (let i = 0; i < chosen.length; i++) {
    const c = chosen[i];
    try {
      const stats = await fs.lstat(normalizePath(c.path));
      if (Number(stats.size || 0) > 160 * 1024 * 1024) {
        log(`Música ignorada por tamanho (>160 MB): ${c.name}`);
        continue;
      }
      progress(58 + Math.round((i / Math.max(1, chosen.length)) * 5), `Ouvindo opção de música ${i + 1}/${chosen.length}: ${c.name}`);
      const synthetic = {
        sourceId: c.candidateId,
        name: c.name,
        path: c.path
      };
      const file = await uploadVideo(synthetic, apiKey, i, chosen.length, 58, 5);
      uploaded.push({ candidate: c, file });
    } catch (error) {
      log(`Música ${c.name} não pôde ser enviada para análise: ${error.message || error}`);
    }
  }
  return uploaded;
}

async function ensureMusicProjectItem(candidate) {
  if (candidate.projectItem) return candidate.projectItem;
  const existing = await findProjectItemByNameOrPath(candidate.name, candidate.path);
  if (existing) {
    candidate.projectItem = existing;
    return existing;
  }

  const root = await state.project.getRootItem();
  const ok = await state.project.importFiles([candidate.path], true, ppro.ProjectItem.cast(root), false);
  if (!ok) throw new Error(`Não consegui importar a música ${candidate.name}.`);
  await wait(180);
  const imported = await findProjectItemByNameOrPath(candidate.name, candidate.path);
  if (!imported) throw new Error(`A música ${candidate.name} foi importada, mas não consegui localizar o item no Projeto.`);
  candidate.projectItem = imported;
  return imported;
}

async function getClipDurationSeconds(projectItem) {
  try {
    const clip = ppro.ClipProjectItem.cast(projectItem);
    const media = await clip.getMedia();
    const duration = await media.duration;
    return Number(duration?.seconds || 0);
  } catch (_) {
    return 0;
  }
}


async function ensureBrandProjectItem(entry, label="asset") {
  if(!entry?.nativePath) throw new Error(`${label}: arquivo não está mais acessível.`);
  const cached = label.toLowerCase().includes("logo") ? state.brandAssets.logoProjectItem : state.brandAssets.outroProjectItem;
  if(cached) return cached;
  const existing=await findProjectItemByNameOrPath(entry.name,entry.nativePath);
  if(existing) {
    if(label.toLowerCase().includes("logo")) state.brandAssets.logoProjectItem=existing;
    else state.brandAssets.outroProjectItem=existing;
    return existing;
  }
  const root=await state.project.getRootItem();
  const ok=await state.project.importFiles([entry.nativePath],true,ppro.ProjectItem.cast(root),false);
  if(!ok) throw new Error(`Não consegui importar ${label}: ${entry.name}.`);
  await wait(180);
  const imported=await findProjectItemByNameOrPath(entry.name,entry.nativePath);
  if(!imported) throw new Error(`${label} foi importado, mas não consegui localizar o item no projeto.`);
  if(label.toLowerCase().includes("logo")) state.brandAssets.logoProjectItem=imported;
  else state.brandAssets.outroProjectItem=imported;
  return imported;
}

async function captureProjectItemInOut(projectItem, mediaType=ppro.Constants.MediaType.VIDEO) {
  const clip=ppro.ClipProjectItem.cast(projectItem);
  let inPoint=null,outPoint=null;
  try { inPoint=await clip.getInPoint(mediaType); } catch (_) {}
  try { outPoint=await clip.getOutPoint(mediaType); } catch (_) {}
  return {clip,inPoint,outPoint};
}

function restoreProjectItemInOut(capture,label) {
  if(!capture?.clip) return false;
  let ok=false;
  try {
    state.project.lockedAccess(()=>{
      ok=state.project.executeTransaction(compound=>{
        if(capture.inPoint && capture.outPoint) compound.addAction(capture.clip.createSetInOutPointsAction(capture.inPoint,capture.outPoint));
        else if(capture.clip.createClearInOutPointsAction) compound.addAction(capture.clip.createClearInOutPointsAction());
      },label);
    });
  } catch (_) {}
  return Boolean(ok);
}

async function findVideoItemByProjectItem(seq, trackIndex, projectItem, startApprox=0) {
  try {
    const track=await seq.getVideoTrack(trackIndex);
    const items=await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
    let nearest=null,nearestDelta=Infinity;
    for(const item of items){
      try {
        const pi=await item.getProjectItem();
        if(String(pi.getId())!==String(projectItem.getId())) continue;
      } catch (_) { continue; }
      const start=Number((await item.getStartTime()).seconds||0);
      const delta=Math.abs(start-Number(startApprox||0));
      if(delta<nearestDelta){nearest=item;nearestDelta=delta;}
    }
    return nearest;
  } catch (_) { return null; }
}

async function setPointParamValue(param, point, label) {
  if(!param || !point) return false;
  let ok=false;
  try {
    state.project.lockedAccess(()=>{
      ok=state.project.executeTransaction(compound=>{
        if(param.isTimeVarying && param.isTimeVarying()) compound.addAction(param.createSetTimeVaryingAction(false));
        const k=param.createKeyframe(point);
        compound.addAction(param.createSetValueAction(k,true));
      },label);
    });
  } catch(error){ log(`${label}: ${error.message||error}`); }
  return Boolean(ok);
}

async function applyLogoPlacement(seq, trackItem) {
  if(!trackItem) return false;
  const scale=clampNumber(String(el.logoScale?.value||"18").replace(",","."),5,60,18);
  const pos=String(el.logoPosition?.value||"top-right");
  const x=pos.includes("right")?0.88:0.12;
  const y=pos.includes("bottom")?0.90:0.10;
  const scaleParam=await findScaleParam(trackItem);
  const positionParam=await findPositionParam(trackItem);
  let ok=false;
  if(scaleParam) ok=await setNumericParamValue(scaleParam,scale,`Vinicius Branding: logo scale ${scale}%`) || ok;
  if(positionParam) ok=await setPointParamValue(positionParam,makePointF(x,y),`Vinicius Branding: posição ${pos}`) || ok;
  return ok;
}

async function insertBrandLogo(seq, plan, entry) {
  const mainDuration=Math.max(0.1,Number(plan?._mainEditDuration || plan?._finalDuration || 0));
  if(!mainDuration || !entry) return false;
  const item=await ensureBrandProjectItem(entry,"Logo");
  const capture=await captureProjectItemInOut(item,ppro.Constants.MediaType.VIDEO);
  const editor=ppro.SequenceEditor.getEditor(seq);
  try {
    let marksOk=false;
    state.project.lockedAccess(()=>{
      marksOk=state.project.executeTransaction(compound=>{
        compound.addAction(capture.clip.createSetInOutPointsAction(ppro.TickTime.createWithSeconds(0),ppro.TickTime.createWithSeconds(mainDuration)));
      },"Vinicius Branding: duração do logo");
    });
    if(!marksOk) throw new Error("não consegui definir a duração do logo");
    let insertOk=false;
    state.project.lockedAccess(()=>{
      insertOk=state.project.executeTransaction(compound=>{
        compound.addAction(editor.createInsertProjectItemAction(item,ppro.TickTime.createWithSeconds(0),2,0,true));
      },"Vinicius Branding: inserir logo V3");
    });
    if(!insertOk) throw new Error("Premiere recusou a inserção do logo em V3");
    await wait(90);
    const trackItem=await findVideoItemByProjectItem(seq,2,item,0);
    if(trackItem) {
      try {
        let stretchOk=false;
        state.project.lockedAccess(()=>{
          stretchOk=state.project.executeTransaction(compound=>{
            if(trackItem.createSetStartAction) compound.addAction(trackItem.createSetStartAction(ppro.TickTime.createWithSeconds(0)));
            if(trackItem.createSetEndAction) compound.addAction(trackItem.createSetEndAction(ppro.TickTime.createWithSeconds(mainDuration)));
          },"Vinicius Branding: esticar logo até o fim");
        });
        if(!stretchOk) log("Branding: não consegui confirmar a duração do logo por TrackItem; mantendo In/Out aplicado.");
      } catch (_) {}
      await applyLogoPlacement(seq,trackItem);
    }
    log(`✓ Branding: logo ${entry.name} em V3 por ${mainDuration.toFixed(1)} s.`);
    return true;
  } finally {
    restoreProjectItemInOut(capture,"Vinicius Branding: restaurar In/Out do logo");
  }
}

async function insertBrandOutro(seq, plan, entry) {
  if(!entry) return 0;
  const item=await ensureBrandProjectItem(entry,"Vinheta final");
  const duration=state.brandAssets.outroDurationSec || await getClipDurationSeconds(item);
  if(!duration || duration<0.1) throw new Error("A vinheta final não tem duração de vídeo válida.");
  const at=Math.max(0,Number(plan?._mainEditDuration || plan?._finalDuration || 0));
  const editor=ppro.SequenceEditor.getEditor(seq);
  const capture=await captureProjectItemInOut(item,ppro.Constants.MediaType.VIDEO);
  try {
    let marksOk=false;
    state.project.lockedAccess(()=>{
      marksOk=state.project.executeTransaction(compound=>{
        compound.addAction(capture.clip.createSetInOutPointsAction(ppro.TickTime.createWithSeconds(0),ppro.TickTime.createWithSeconds(duration)));
      },"Vinicius Branding: duração da vinheta");
    });
    if(!marksOk) throw new Error("não consegui definir In/Out da vinheta");
    let insertOk=false;
    state.project.lockedAccess(()=>{
      insertOk=state.project.executeTransaction(compound=>{
        compound.addAction(editor.createOverwriteItemAction(item,ppro.TickTime.createWithSeconds(at),0,0));
      },"Vinicius Branding: inserir vinheta final");
    });
    if(!insertOk) throw new Error("Premiere recusou a vinheta final");
    plan._finalDuration=at+duration;
    state.styleStats.finalDuration=plan._finalDuration;
    log(`✓ Branding: vinheta ${entry.name} adicionada em ${at.toFixed(1)} s (${duration.toFixed(1)} s).`);
    return duration;
  } finally {
    restoreProjectItemInOut(capture,"Vinicius Branding: restaurar In/Out da vinheta");
  }
}

async function prepareBrandingIntent(intent) {
  state.brandAssets={logoEntry:null,logoProjectItem:null,outroEntry:null,outroProjectItem:null,outroDurationSec:0};
  if(!el.optBranding?.checked) return intent;
  const logo=await getPersistentAsset(BRAND_LOGO_TOKEN);
  const outro=await getPersistentAsset(BRAND_OUTRO_TOKEN);
  state.brandAssets.logoEntry=logo;
  state.brandAssets.outroEntry=outro;
  if(!outro) return intent;
  try {
    const projectItem=await ensureBrandProjectItem(outro,"Vinheta final");
    const duration=await getClipDurationSeconds(projectItem);
    if(duration>0.1) {
      state.brandAssets.outroDurationSec=duration;
      intent.outroDurationSec=duration;
      if(intent.maxDurationSec) {
        const deliveryMax=intent.maxDurationSec;
        const mainMax=Math.max(3,deliveryMax-duration);
        intent.deliveryMaxDurationSec=deliveryMax;
        intent.maxDurationSec=mainMax;
        intent.targetMaxSec=Math.max(3,mainMax-1.0);
        intent.targetGoalSec=Math.max(3,Math.min(intent.targetMaxSec,mainMax*0.94));
        intent.targetMinSec=Math.max(3,Math.min(intent.targetMaxSec,mainMax*0.86));
        if(intent.requireAllSources){
          const per=Math.max(0.55,Math.min(2.2,intent.targetMaxSec/Math.max(1,intent.sourceCount)));
          intent.targetMinSec=Math.min(intent.targetMaxSec,Math.max(intent.targetMinSec,intent.sourceCount*per));
        }
        log(`Branding: reservando ${duration.toFixed(1)} s para a vinheta; montagem principal limitada a ${mainMax.toFixed(1)} s para manter entrega ≤ ${deliveryMax.toFixed(1)} s.`);
      }
    }
  } catch(error) {
    log(`Vinheta configurada, mas não pôde ser preparada: ${error.message||error}. A edição continuará sem reservar duração.`);
  }
  return intent;
}

async function applyBranding(seq, plan) {
  state.styleStats.brandingAdded=0;
  plan._mainEditDuration=Number(plan?._finalDuration||state.styleStats.finalDuration||0);
  if(!el.optBranding?.checked) { log("Branding automático desativado."); return; }
  const logo=state.brandAssets.logoEntry || await getPersistentAsset(BRAND_LOGO_TOKEN);
  const outro=state.brandAssets.outroEntry || await getPersistentAsset(BRAND_OUTRO_TOKEN);
  if(!logo && !outro){ log("Branding: nenhum logo/vinheta configurado; seguindo sem assets."); return; }
  if(logo){
    try { if(await insertBrandLogo(seq,plan,logo)) state.styleStats.brandingAdded++; }
    catch(error){ log(`Logo ignorado sem cancelar edição: ${error.message||error}`); }
  }
  if(outro){
    try { if(await insertBrandOutro(seq,plan,outro)>0) state.styleStats.brandingAdded++; }
    catch(error){ log(`Vinheta ignorada sem cancelar edição: ${error.message||error}`); }
  }
  if(plan?._intent?.deliveryMaxDurationSec && Number(plan._finalDuration)>Number(plan._intent.deliveryMaxDurationSec)+0.08){
    throw new Error(`QC bloqueou a entrega: branding levou a duração final a ${Number(plan._finalDuration).toFixed(1)} s, acima do contrato de ${Number(plan._intent.deliveryMaxDurationSec).toFixed(1)} s.`);
  }
  log(`Branding concluído: ${state.styleStats.brandingAdded} asset(s) aplicado(s).`);
}

async function findMusicAudioItems(seq, audioTrackIndex, projectItem) {
  const matches = [];
  try {
    const track = await seq.getAudioTrack(audioTrackIndex);
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    for (const item of items) {
      try {
        const pi = await item.getProjectItem();
        if (String(pi.getId()) === String(projectItem.getId())) matches.push(item);
      } catch (_) {}
    }
  } catch (_) {}
  return matches;
}

async function removeItemsFromSequence(seq, items, label = "Vinicius: remover itens") {
  if (!items?.length) return true;
  try {
    const editor = ppro.SequenceEditor.getEditor(seq);
    await seq.clearSelection();
    const selection = await seq.getSelection();
    for (const item of items) selection.addItem(item, true);
    let ok = false;
    state.project.lockedAccess(() => {
      ok = state.project.executeTransaction(compound => {
        compound.addAction(editor.createRemoveItemsAction(selection, false, ppro.Constants.MediaType.ANY, false));
      }, label);
    });
    return Boolean(ok);
  } catch (error) {
    log(`${label} falhou: ${error.message || error}`);
    return false;
  }
}

async function findAudioLevelParam(audioItem) {
  try {
    const chain = await audioItem.getComponentChain();
    const count = chain.getComponentCount();
    let fallback = null;
    for (let i = 0; i < count; i++) {
      const comp = chain.getComponentAtIndex(i);
      let compName = "";
      try { compName = `${await comp.getDisplayName()} ${await comp.getMatchName()}`.toLowerCase(); } catch (_) {}
      const pc = comp.getParamCount();
      for (let p = 0; p < pc; p++) {
        const param = comp.getParam(p);
        const n = String(param.displayName || "").toLowerCase();
        if (/level|nível/.test(n) && /volume|vol|level|nível/.test(compName)) return param;
        if (!fallback && /level|nível|volume/.test(n)) fallback = param;
      }
    }
    return fallback;
  } catch (_) {
    return null;
  }
}

async function setAudioVolumeDb(audioItem, db, label = "Vinicius AI: volume") {
  const param = await findAudioLevelParam(audioItem);
  if (!param) return false;

  try {
    const start = await param.getStartValue();
    const raw = numericKeyframeValue(start);
    const target = Number.isFinite(raw) && raw > 0.001 && raw <= 2.5
      ? Math.pow(10, Number(db) / 20)
      : Number(db);

    let ok = false;
    state.project.lockedAccess(() => {
      ok = state.project.executeTransaction(compound => {
        if (param.isTimeVarying && param.isTimeVarying()) {
          compound.addAction(param.createSetTimeVaryingAction(false));
        }
        const key = param.createKeyframe(target);
        compound.addAction(param.createSetValueAction(key, true));
      }, `${label} ${Number(db).toFixed(1)} dB`);
    });
    return Boolean(ok);
  } catch (error) {
    log(`${label} não pôde ser ajustado: ${error.message || error}`);
    return false;
  }
}

async function setMusicVolume(audioItem, db) {
  return setAudioVolumeDb(audioItem, db, "Vinicius AI: música");
}

function dbValueForParam(rawStart, db) {
  return Number.isFinite(rawStart) && rawStart>0.001 && rawStart<=2.5 ? Math.pow(10,Number(db)/20) : Number(db);
}

async function applyAudioCrossfadeEnvelope(audioItem, baseDb, fadeInSec, fadeOutSec, label="música") {
  const param=await findAudioLevelParam(audioItem);
  if(!param) return false;
  try {
    if(!param.areKeyframesSupported || !(await param.areKeyframesSupported())) return setAudioVolumeDb(audioItem,baseDb,`Vinicius AI: ${label}`);
    const startValue=await param.getStartValue();
    const raw=numericKeyframeValue(startValue);
    const base=dbValueForParam(raw,baseDb);
    const silence=dbValueForParam(raw,-60);
    const itemStart=Number((await audioItem.getStartTime()).seconds||0);
    const itemEnd=Number((await audioItem.getEndTime()).seconds||itemStart);
    const dur=Math.max(0,itemEnd-itemStart);
    const fi=Math.max(0,Math.min(Number(fadeInSec||0),dur/2));
    const fo=Math.max(0,Math.min(Number(fadeOutSec||0),dur/2));
    let ok=false;
    state.project.lockedAccess(()=>{
      ok=state.project.executeTransaction(compound=>{
        compound.addAction(param.createSetTimeVaryingAction(true));
        const points=[];
        if(fi>0) points.push([itemStart,silence],[itemStart+fi,base]); else points.push([itemStart,base]);
        if(fo>0) points.push([Math.max(itemStart,itemEnd-fo),base],[itemEnd,silence]); else points.push([itemEnd,base]);
        for(const [sec,val] of points){
          const k=param.createKeyframe(val); k.position=ppro.TickTime.createWithSeconds(sec);
          compound.addAction(param.createAddKeyframeAction(k));
        }
      },`Vinicius AI: crossfade ${label}`);
    });
    return Boolean(ok);
  } catch(error){ log(`Crossfade ${label} ignorado: ${error.message||error}`); return false; }
}

async function addBackgroundMusic(seq, plan) {
  state.styleStats.musicAdded=false;
  state.styleStats.musicFile="";
  state.styleStats.musicVolumeDb=null;
  state.styleStats.musicCrossfades=0;
  if(!el.optMusic?.checked || !plan?.music?.use) return null;

  const candidate=state.musicCandidates.find(c=>c.candidateId===plan.music.candidateId);
  if(!candidate){ log(`Música pedida pela IA não foi encontrada: ${plan.music.candidateId||"(sem ID)"}`); return null; }

  const projectItem=await ensureMusicProjectItem(candidate);
  const clip=ppro.ClipProjectItem.cast(projectItem);
  const mediaDuration=await getClipDurationSeconds(projectItem);
  const seqEnd=await seq.getEndTime();
  const targetDuration=Math.max(0.1,Number(seqEnd?.seconds||0));
  if(!targetDuration) return null;

  const profile=plan?._intent?.contentProfile || state.contentProfile || {mode:"mixed"};
  let volumeDb=Math.max(-36,Math.min(-14,Number(plan.music.volumeDb||-20)));
  if(profile.mode==="spoken") volumeDb=Math.min(volumeDb,-20);
  else if(profile.mode==="visual") volumeDb=Math.max(-20,volumeDb);

  const trimStart=Math.max(0,Math.min(Number(plan.music.trimStart||0),Math.max(0,mediaDuration-0.5)));
  const crossfadeEnabled=Boolean(el.optMusicCrossfade?.checked);
  const crossfadeSec=crossfadeEnabled ? Math.min(0.8,Math.max(0.35,targetDuration*0.006)) : 0;
  let oldIn=null,oldOut=null;
  try{oldIn=await clip.getInPoint(ppro.Constants.MediaType.AUDIO);}catch(_){}
  try{oldOut=await clip.getOutPoint(ppro.Constants.MediaType.AUDIO);}catch(_){}
  const editor=ppro.SequenceEditor.getEditor(seq);
  let cursor=0,loop=0,insertionError=null;
  const placements=[];

  try{
    while(cursor<targetDuration-0.05 && loop<28){
      const loopTrimStart=loop===0?trimStart:0;
      const available=mediaDuration>0?Math.max(0.1,mediaDuration-loopTrimStart):targetDuration;
      let at=loop===0?0:Math.max(0,cursor-crossfadeSec);
      const remaining=Math.max(0.05,targetDuration-at);
      const segmentDuration=Math.min(available,remaining);
      if(segmentDuration<=0.05) break;
      const inTime=ppro.TickTime.createWithSeconds(loopTrimStart);
      const outTime=ppro.TickTime.createWithSeconds(loopTrimStart+segmentDuration);
      let marksOk=false;
      state.project.lockedAccess(()=>{marksOk=state.project.executeTransaction(compound=>{compound.addAction(clip.createSetInOutPointsAction(inTime,outTime));},"Vinicius: trecho da música");});
      if(!marksOk) throw new Error("Não consegui definir In/Out da música.");

      const trackIndex=2+(loop%2); // A3/A4 alternadas para crossfade real.
      const trackCount=await seq.getAudioTrackCount();
      const atTime=ppro.TickTime.createWithSeconds(at);
      let insertOk=false;
      state.project.lockedAccess(()=>{
        insertOk=state.project.executeTransaction(compound=>{
          const action=trackCount<=trackIndex
            ? editor.createInsertProjectItemAction(projectItem,atTime,0,trackIndex,true)
            : editor.createOverwriteItemAction(projectItem,atTime,0,trackIndex);
          compound.addAction(action);
        },`Vinicius: trilha ${loop+1}`);
      });
      if(!insertOk) throw new Error(`O Premiere recusou a inserção da música em A${trackIndex+1}.`);
      placements.push({trackIndex,at,duration:segmentDuration,fadeIn:loop>0?crossfadeSec:0,fadeOut:0});
      if(placements.length>1) placements[placements.length-2].fadeOut=crossfadeSec;
      cursor=at+segmentDuration;
      loop++;
      await wait(40);
    }
  }catch(error){insertionError=error;}
  finally{
    try{state.project.lockedAccess(()=>{state.project.executeTransaction(compound=>{if(oldIn&&oldOut)compound.addAction(clip.createSetInOutPointsAction(oldIn,oldOut));else if(clip.createClearInOutPointsAction)compound.addAction(clip.createClearInOutPointsAction());},"Vinicius: restaurar In/Out da música");});}catch(_){}
  }

  await wait(180);
  const allItems=[];
  for(const trackIndex of [2,3]){
    const arr=await findMusicAudioItems(seq,trackIndex,projectItem);
    for(const item of arr) allItems.push({item,trackIndex});
  }
  if(insertionError){
    if(allItems.length) await removeItemsFromSequence(seq,allItems.map(x=>x.item),"Vinicius: limpar música parcial");
    log(`Música ignorada sem cancelar a edição: ${insertionError.message||insertionError}`);
    return null;
  }

  // Relaciona pela posição real para aplicar envelopes nos loops.
  const ordered=[];
  for(const row of allItems){
    const st=Number((await row.item.getStartTime()).seconds||0);
    ordered.push({...row,start:st});
  }
  ordered.sort((a,b)=>a.start-b.start);
  let volumeCount=0,crossfadeCount=0;
  for(let i=0;i<ordered.length;i++){
    const fadeIn=(i>0&&crossfadeEnabled)?crossfadeSec:0;
    const fadeOut=(i<ordered.length-1&&crossfadeEnabled)?crossfadeSec:0;
    const ok=(fadeIn||fadeOut)
      ? await applyAudioCrossfadeEnvelope(ordered[i].item,volumeDb,fadeIn,fadeOut,"música")
      : await setMusicVolume(ordered[i].item,volumeDb);
    if(ok) volumeCount++;
    if(ok&&(fadeIn||fadeOut)) crossfadeCount++;
  }

  state.styleStats.musicAdded=ordered.length>0;
  state.styleStats.musicFile=candidate.name;
  state.styleStats.musicVolumeDb=volumeDb;
  state.styleStats.musicCrossfades=Math.max(0,ordered.length-1);
  log(`✓ Música: ${candidate.name}; ${ordered.length} trecho(s) em A3/A4; ${state.styleStats.musicCrossfades} crossfade(s); alvo ${volumeDb} dB.`);
  return {candidate,audioTracks:[2,3],volumeDb,items:ordered.length,crossfades:state.styleStats.musicCrossfades};
}


async function runAI() {
  if (state.running) return;
  state.running = true;
  el.editAI.disabled = true;

  try {
    const apiKey = await loadKey();
    if (!apiKey) {
      revealApiKeyEditor();
      throw new Error("Configure sua Gemini API Key em Modo Avançado → Gemini e diagnóstico antes de editar.");
    }

    const instruction = resolveInstruction();

    progress(2, "Lendo a timeline ativa…");
    await scanTimeline();
    if (el.optAnalyzeVideo?.checked && state.sources.length > MAX_VIDEO_FILES) {
      throw new Error(`Esta build analisa no máximo ${MAX_VIDEO_FILES} fontes por edição. A timeline tem ${state.sources.length}. Divida o bruto em duas timelines ou reduza o número de fontes.`);
    }
    const intent=parseEditIntent(instruction);
    await prepareBrandingIntent(intent);
    log(`Contrato detectado: todos=${intent.requireAllSources?"SIM":"não"}, fontes=${state.sources.length}, máximo=${intent.maxDurationSec?intent.maxDurationSec.toFixed(0)+"s":"livre"}, efeitos=${intent.requestEffects?"SIM":"não"}, transições=${intent.requestTransitions?"SIM":"não"}, color=${intent.requestColorGrade?"SIM":"não"}, mix=${intent.requestFineMix?"SIM":"não"}.`);

    const transcripts = await collectPremiereTranscripts();
    log(`${transcripts.length} transcrição(ões) existente(s) no Premiere.`);

    let uploaded = [];
    if (el.optAnalyzeVideo.checked) uploaded = await uploadTimelineSources(apiKey);
    if (!uploaded.length && !transcripts.length) throw new Error("A IA precisa analisar os vídeos ou ter transcrições disponíveis para decidir cortes com qualidade.");

    progress(44, "Decupando TODOS os vídeos em lotes…");
    const scoutReport = el.optAnalyzeVideo.checked
      ? await scoutTimelineSources(apiKey, uploaded, transcripts, intent)
      : sanitizeScoutReport([], intent);
    intent.contentProfile=inferContentProfile(scoutReport, transcripts);

    let musicCandidates = [];
    let musicUploaded = [];
    if (el.optMusic?.checked) {
      progress(58, "Procurando e pré-selecionando música de fundo…");
      musicCandidates = await collectMusicCandidates();
      if (musicCandidates.length) {
        musicUploaded = await uploadMusicCandidates(apiKey, musicCandidates);
        log(`Música: ${musicUploaded.length} opção(ões) distribuídas pela biblioteca foram enviadas para comparação final.`);
      } else {
        log("Nenhuma música disponível no projeto ou na biblioteca configurada. Para seleção automática, importe músicas no projeto ou escolha uma pasta uma única vez.");
      }
    }

    let plan = await planWithGemini(apiKey, instruction, scoutReport, transcripts, musicUploaded, intent);
    plan = postProcessPlanForStyle(plan, scoutReport, intent);
    plan = await quantizePlanToSequenceFrames(plan, state.sourceSequence);
    validatePlan(plan);

    if (plan.music?.use && !state.musicCandidates.some(c => c.candidateId === plan.music.candidateId)) {
      log(`A IA escolheu uma música não disponível (${plan.music.candidateId}); trilha desativada.`);
      plan.music.use = false;
    }

    log(`Plano Director 2.4.1: ${plan.cuts.filter(c=>c.role!=="b-roll").length} A-roll, ${plan.cuts.filter(c=>c.role==="b-roll").length} B-roll, legendas DESATIVADAS, música ${plan.music?.use ? "sim" : "não"}.`);

    const seq = await executePlan(plan);

    let musicResult = null;
    if (el.optMusic?.checked && plan.music?.use) {
      progress(93, "Colocando música de fundo e finalizando mix…");
      try {
        musicResult = await addBackgroundMusic(seq, plan);
      } catch (musicError) {
        log(`Música não aplicada; edição principal preservada: ${musicError.message || musicError}`);
        musicResult = null;
      }
    }
    log("Legendas fora do motor: esta build não contém código MOGRT/SRT.");

    await state.project.save();

    progress(100, "Concluído.");
    status("Edição concluída", "ok");

    const captionLine = "desativadas nesta versão (nenhum MOGRT/SRT)";

    const musicLine = !el.optMusic?.checked
      ? "desativada"
      : musicResult
        ? `${state.styleStats.musicFile} em volume alvo ${state.styleStats.musicVolumeDb} dB · ${state.styleStats.musicCrossfades} crossfade(s)`
        : plan.music?.use
          ? "selecionada pela IA, mas não inserida"
          : "nenhuma música compatível/disponível";

    result(
      `✅ ${plan.summary || "Edição concluída."}` +
      `

Sequência criada: ${seq.name}` +
      `
Cortes: ${plan.cuts.length}` +
      `
Fontes usadas no A-roll: ${state.styleStats.sourcesUsed || new Set(plan.cuts.filter(c=>c.role!=="b-roll").map(c=>String(c.sourceId))).size}/${state.sources.length}` +
      `
Duração final: ${(Number(plan._finalDuration||state.styleStats.finalDuration||0)).toFixed(1)} s` +
      `
Preset: ${currentPreset().label} · ${plan?._intent?.outputAspect || "origem"}` +
      `
Contexto detectado: ${plan?._intent?.contentProfile?.label || state.contentProfile?.label || "misto"}` +
      `
Auto Reframe: ${plan?._intent?.autoReframe ? `${state.styleStats.autoReframed} clipe(s) reenquadrado(s)` : "desativado"}` +
      `
Efeitos/reframes aplicados: ${state.styleStats.punchIns}` +
      `
Transições: ${state.styleStats.transitionsApplied} aplicada(s) (${state.styleStats.transitionsSkipped} ignorada(s) com segurança)` +
      `
Color grading: ${el.optColorGrade?.checked ? `${state.styleStats.colorGraded} clipe(s) tratados` : "desativado"}` +
      `
Mixagem fina: ${el.optFineMix?.checked ? `${state.styleStats.voiceMixed} take(s) de voz nivelado(s)` : "desativada"}` +
      `
Música de fundo: ${musicLine}` +
      `
Branding: ${el.optBranding?.checked ? (state.styleStats.brandingAdded ? `${state.styleStats.brandingAdded} asset(s) aplicado(s)` : "sem assets configurados") : "desativado"}` +
      `
Legendas: ${captionLine}` +
      `
Estilo: ${el.stylePreset?.options?.[el.stylePreset.selectedIndex]?.text || "—"}`
    );
  } catch (error) {
    friendlyError(error);
  } finally {
    state.running = false;
    el.editAI.disabled = false;
    hideProgressLater();
  }
}

async function boot() {
  try {
    wireElements();
    wireUI();
    loadBrandContext();
    loadBrandLayout();
    await updateBrandAssetStatus();
    await showKeySetupIfNeeded();
    await updateMusicFolderStatus();
    const savedPreset=localStorage.getItem("vinicius-editor-delivery-preset-v1") || "reels";
    if(el.deliveryPreset && DELIVERY_PRESETS[savedPreset]) el.deliveryPreset.value=savedPreset;
    applyDeliveryPreset(el.deliveryPreset?.value || "reels", true);
    loadPromptForPreset(el.deliveryPreset?.value || "reels", false);
    try { await scanTimeline(); }
    catch (error) { status("Abra uma timeline", "idle"); log(error.message || error); }
    if (await loadKey()) result("Pronto. Escreva o que deseja — ou deixe a caixa vazia para usar a direção automática do preset.");
  } catch (error) {
    friendlyError(error);
  }
}

function updateStyleHint() {
  if (!el.styleHint) return;
  const style = el.stylePreset?.value || "tiktok";
  el.styleHint.textContent = style === "tiktok"
    ? "Reels First: decupa todas as fontes, preserva a ordem editorial, força cobertura quando ativada e finaliza com color grading e mixagem fina."
    : style === "talking"
      ? "Talking head clean: decupagem multi-pass, melhores takes globais, jump cuts limpos, reframes úteis e transições só em mudanças reais de seção/câmera."
      : style === "visual"
        ? "Visual/evento: imagem e movimento conduzem a edição; música pode ficar mais presente e Cross Dissolve aparece mais em mudanças de plano e fotos."
        : "Institucional moderno: compara todas as fontes, preserva planos mais longos, usa Cross Dissolve suave, Dip to Black raro e B-roll funcional.";
}

function updateQualityHint() {
  if (!el.qualityHint) return;
  const pro = el.qualityMode?.value === "pro";
  el.qualityHint.textContent = pro
    ? "Director Pro: Gemini 3.7 Flash com thinking médio na montagem final; decupagem usa modelos Lite com thinking baixo."
    : "Econômico: Flash Lite primeiro, com thinking baixo e fallback automático se necessário.";
  if (el.activeModel) el.activeModel.textContent = pro ? "gemini-3.7-flash" : "gemini-3.5-flash-lite";
}

function wireUI() {
  el.saveKey?.addEventListener("click", () => saveKey().catch(friendlyError));
  el.changeKey?.addEventListener("click", () => revealApiKeyEditor());
  el.cancelKey?.addEventListener("click", async () => {
    el.apiKey.value = "";
    if (await loadKey()) el.keySetup?.classList.add("hidden");
  });
  el.clearCache?.addEventListener("click", () => clearAllGeminiCaches().catch(friendlyError));
  el.chooseMusicFolder?.addEventListener("click", () => chooseMusicFolder().catch(friendlyError));
  el.clearMusicFolder?.addEventListener("click", () => clearMusicFolder().catch(friendlyError));
  el.saveBrandContext?.addEventListener("click", () => saveBrandContext());
  el.chooseBrandFolder?.addEventListener("click", () => chooseBrandAssetsFolder().catch(friendlyError));
  el.logoScale?.addEventListener("change", saveBrandLayout);
  el.logoPosition?.addEventListener("change", saveBrandLayout);
  el.chooseLogo?.addEventListener("click", () => choosePersistentAsset(BRAND_LOGO_TOKEN,["png","jpg","jpeg","webp"],"Logo").catch(friendlyError));
  el.clearLogo?.addEventListener("click", () => clearPersistentAsset(BRAND_LOGO_TOKEN,"Logo").catch(friendlyError));
  el.chooseOutro?.addEventListener("click", () => choosePersistentAsset(BRAND_OUTRO_TOKEN,["mp4","mov","m4v"],"Vinheta final").catch(friendlyError));
  el.clearOutro?.addEventListener("click", () => clearPersistentAsset(BRAND_OUTRO_TOKEN,"Vinheta final").catch(friendlyError));
  el.deliveryPreset?.addEventListener("change", () => {
    const value=el.deliveryPreset.value;
    localStorage.setItem("vinicius-editor-delivery-preset-v1",value);
    loadPromptForPreset(value,true);
    applyDeliveryPreset(value,true);
  });
  el.prompt?.addEventListener("input", () => savePromptDraft(el.deliveryPreset?.value || activePromptPreset || "reels"));
  for(const id of ["outputAspect","durationLimit","optRequireAllSources"]) el[id]?.addEventListener("change",updateSimplePresetSummary);
  el.optAutoReframe?.addEventListener("change", () => {
    if (el.optAutoReframe.checked && el.outputAspect) el.outputAspect.value = "9:16";
    updateSimplePresetSummary();
  });
  el.refresh?.addEventListener("click", () => scanTimeline().catch(friendlyError));
  el.stylePreset?.addEventListener("change", updateStyleHint);
  el.qualityMode?.addEventListener("change", updateQualityHint);
  updateStyleHint();
  updateQualityHint();
  el.editAI?.addEventListener("click", runAI);
}

entrypoints.setup({
  panels: {
    editorViniciusB: {
      create() { setTimeout(() => boot(), 0); },
      show() { if (!el.editAI) setTimeout(() => boot(), 0); }
    }
  }
});

// Fallback de inicialização para Reload do UDT.
setTimeout(() => { if (!el.editAI) boot(); }, 100);
