
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
};

// ================== AUTH ==================
function checkAuth(req, res, next) {
  const pass = req.headers["x-password"];
  if (pass !== PANEL_PASSWORD) {
    return res.status(401).json({ ok: false, message: "Senha inválida" });
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

// ================== FFmpeg ==================
function createMp3Resource(filePath) {
  const ffmpeg = spawn(ffmpegPath, [
    "-i", filePath,
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1"
  ], { stdio: ["ignore", "pipe", "ignore"] });

  return createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw
  });
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
    res.json({ ok: true, message: "Entrou no canal" });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.post("/api/leave", checkAuth, async (req, res) => {
  if (connection) {
    connection.destroy();
    connection = null;
  }
  res.json({ ok: true, message: "Saiu do canal" });
});

app.post("/api/play/:sound", checkAuth, async (req, res) => {
  try {
    const sound = req.params.sound;

    if (!sounds[sound]) {
      return res.status(400).json({ ok: false, message: "Som inválido" });
    }

    const filePath = sounds[sound];

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, message: "Arquivo não existe" });
    }

    await connectVoice();

    const resource = createMp3Resource(filePath);
    player.play(resource);

    res.json({ ok: true, message: `Tocando ${sound}` });

  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: "Erro ao tocar som" });
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
