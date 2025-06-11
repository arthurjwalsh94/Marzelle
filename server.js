// server.js
const express         = require("express");
const http            = require("http");
const { createClient }= require("@deepgram/sdk");
const { OpenAI }      = require("openai");
const { Server }      = require("socket.io");
const dotenv          = require("dotenv");
dotenv.config();

// ——— Deepgram & OpenAI clients —————————————————————————————————————
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
const openai         = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// ——— “Marzelle” memory + chat function ————————————————————————————
let memory = [
  {
    role: "system",
    content:
      "You are Marzelle, an eccentric glass-mosaic alien producer. " +
      "Speak in clipped, dry sentences. End jokes with a soft robotic chuckle: *k-ch*."
  }
];

async function askMarzelle(userText) {
  memory.push({ role: "user", content: userText });
  memory = memory.slice(-10);

  const stream = await openai.chat.completions.create({
    model: "gpt-4o",
    stream: true,
    temperature: 0.6,
    messages: memory
  });

  let reply = "";
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || "";
    reply += token;
  }

  memory.push({ role: "assistant", content: reply });
  return reply;
}

// ——— Express setup —————————————————————————————————————————————
const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// JSON parsing for TTS
app.use(express.json());
app.use(express.static("public"));

// serve homepage
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ——— Deepgram key endpoint ————————————————————————————————————————
// Serve the static API key from env rather than dynamic project keys
app.get("/key", (req, res) => {
  res.json({ key: process.env.DEEPGRAM_API_KEY });
});

// ——— ElevenLabs TTS proxy ————————————————————————————————————————
app.post("/tts", async (req, res) => {
  const { text } = req.body;
  if (!text) return res.sendStatus(400);

  try {
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVEN_VOICE_ID}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "xi-api-key":     process.env.ELEVEN_KEY
        },
        body: JSON.stringify({
          text,
          model_id:      "eleven_multilingual_v1",
          voice_settings:{ stability: 0.75, similarity_boost: 0.75 }
        })
      }
    );

    if (!elevenRes.ok) {
      console.error("TTS error:", await elevenRes.text());
      return res.sendStatus(502);
    }

    const arrayBuffer = await elevenRes.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(audioBuffer);
  } catch (err) {
    console.error("Fetch TTS error:", err);
    res.sendStatus(500);
  }
});

// ——— Socket.IO for transcripts → LLM → responses —————————————————————
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("transcript", async ({ transcript }) => {
    console.log("▶️  User:", transcript);
    try {
      const assistantReply = await askMarzelle(transcript);
      console.log("🤖 Marzelle:", assistantReply);
      socket.emit("assistantResponse", { response: assistantReply });
    } catch (err) {
      console.error("Error in askMarzelle:", err);
      socket.emit("assistantResponse", { response: "Oops, something broke in Marzelle's mind." });
    }
  });
});

// ——— Start server ——————————————————————————————————————————————
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});