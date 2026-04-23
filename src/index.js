require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const { spawn } = require("child_process");

const {
  Client,
  GatewayIntentBits
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus,
  StreamType
} = require("@discordjs/voice");

const ffmpegPath = require("ffmpeg-static");
const userSoundsPath = path.join(__dirname, "..", "userSounds.json");

console.log("FFMPEG PATH:", ffmpegPath);

// ================== ENV ==================
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
const PORT = process.env.PORT || 3000;

if (!TOKEN || !GUILD_ID || !VOICE_CHANNEL_ID || !PANEL_PASSWORD) {
  console.error("Faltam variáveis obrigatórias no .env");
  process.exit(1);
}

// ================== APP ==================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// ================== BOT ==================
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

let connection = null;
let lastJoinSoundAt = 0;

const player = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Pause
  }
});

// ================== SONS ==================
const sounds = {
  eu_vou_pra_narguila: path.join(__dirname, "..", "sounds", "eu_vou_pra_narguila.mp3"),
  rosh_duplo: path.join(__dirname, "..", "sounds", "rosh_duplo.mp3"),
  alemanha: path.join(__dirname, "..", "sounds", "alemanha.mp3"),
  me_derrubaram: path.join(__dirname, "..", "sounds", "me_derrubaram.mp3"),
  vai_chupetinha: path.join(__dirname, "..", "sounds", "vai_chupetinha.mp3"),
  senhor_me_ouve: path.join(__dirname, "..", "sounds", "senhor_me_ouve.mp3"),
  ouvo_sim: path.join(__dirname, "..", "sounds", "ouvo_sim.mp3"),
  ce_ta_brabo: path.join(__dirname, "..", "sounds", "ce_ta_brabo.mp3"),
  max_verstappen: path.join(__dirname, "..", "sounds", "max_verstappen.mp3"),
  ele_fez_um_giro: path.join(__dirname, "..", "sounds", "ele_fez_um_giro.mp3"),
  dilma: path.join(__dirname, "..", "sounds", "dilma.mp3")
};

// ================== USER SOUNDS ==================
function getUserSounds() {
  try {
    if (!fs.existsSync(userSoundsPath)) {
      return {};
    }

    const data = fs.readFileSync(userSoundsPath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("Erro ao ler userSounds.json:", err.message);
    return {};
  }
}

// ================== AUTH ==================
function checkAuth(req, res, next) {
  const pass = req.headers["x-password"];

  if (pass !== PANEL_PASSWORD) {
    return res.status(401).json({
      ok: false,
      message: "Senha inválida"
    });
  }

  next();
}

// ================== VOICE ==================
async function connectVoice() {
  const guild = await client.guilds.fetch(GUILD_ID);
  const channel = await guild.channels.fetch(VOICE_CHANNEL_ID);

  if (!channel || !channel.isVoiceBased()) {
    throw new Error("Canal de voz inválido");
  }

  if (
    connection &&
    connection.joinConfig.channelId === VOICE_CHANNEL_ID &&
    connection.state.status !== VoiceConnectionStatus.Destroyed
  ) {
    return connection;
  }

  connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });

  connection.subscribe(player);

  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  return connection;
}

// ================== FFMPEG ==================
function createMp3Resource(filePath) {
  const ffmpeg = spawn(ffmpegPath, [
    "-i", filePath,
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1"
  ], {
    stdio: ["ignore", "pipe", "ignore"]
  });

  return createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw
  });
}

async function playSound(sound) {
  if (!sounds[sound]) {
    throw new Error("Som inválido");
  }

  const filePath = sounds[sound];

  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo não existe: ${sound}`);
  }

  await connectVoice();

  const resource = createMp3Resource(filePath);
  player.play(resource);
}

// ================== API ==================
app.get("/api/status", checkAuth, async (req, res) => {
  try {
    res.json({
      ok: true,
      botReady: client.isReady(),
      connected: !!connection
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: "Erro ao obter status"
    });
  }
});

app.post("/api/join", checkAuth, async (req, res) => {
  try {
    await connectVoice();

    res.json({
      ok: true,
      message: "Entrou no canal"
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: e.message
    });
  }
});

app.post("/api/leave", checkAuth, async (req, res) => {
  try {
    if (connection) {
      connection.destroy();
      connection = null;
    }

    res.json({
      ok: true,
      message: "Saiu do canal"
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      message: "Erro ao sair do canal"
    });
  }
});

app.post("/api/play/:sound", checkAuth, async (req, res) => {
  try {
    const sound = req.params.sound;

    await playSound(sound);

    res.json({
      ok: true,
      message: `Tocando ${sound}`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      ok: false,
      message: e.message || "Erro ao tocar som"
    });
  }
});

// ================== AUTO PLAY AO ENTRAR ==================
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    if (!client.isReady()) return;
    if (newState.member?.user?.bot) return;

    const entrouNoCanal =
      newState.channelId === VOICE_CHANNEL_ID &&
      oldState.channelId !== VOICE_CHANNEL_ID;

    if (!entrouNoCanal) return;

    const now = Date.now();
    const cooldownMs = 10000;

    if (now - lastJoinSoundAt < cooldownMs) {
      return;
    }

    lastJoinSoundAt = now;

    const userId = newState.member.user.id;
    const userSounds = getUserSounds();

    const sound = userSounds[userId] || "max_verstappen";

    console.log(`${newState.member.user.tag} entrou. Tocando ${sound}...`);

    await playSound(sound);
  } catch (err) {
    console.error("Erro ao tocar som automático:", err);
  }
});

// ================== PLAYER EVENTS ==================
player.on(AudioPlayerStatus.Playing, () => {
  console.log("▶️ Tocando áudio");
});

player.on(AudioPlayerStatus.Idle, () => {
  console.log("⏹️ Parado");
});

player.on("error", (err) => {
  console.error("Erro no player:", err.message);
});

// ================== START ==================
client.once("clientReady", () => {
  console.log(`🤖 Bot conectado como ${client.user.tag}`);
});

client.login(TOKEN).then(() => {
  app.listen(PORT, () => {
    console.log(`🌐 Painel rodando em http://localhost:${PORT}`);
  });
});
