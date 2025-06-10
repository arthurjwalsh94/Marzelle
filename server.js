// server.js
const express        = require("express");
const http           = require("http");
const { createClient } = require("@deepgram/sdk");
const { OpenAI }     = require("openai");
const { Server }     = require("socket.io");
const dotenv         = require("dotenv");
dotenv.config();

// ——— Deepgram & OpenAI clients —————————————————————————————————————
const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
const openai         = new OpenAI({ apiKey: process.env.OPENAI_KEY });

// ——— “Marzelle” memory + chat function ————————————————————————————
let memory = [
  {
    role: "system",
    content: "You are Marzelle, an eccentric glass-mosaic alien producer. Speak in clipped, dry sentences. End jokes with a soft robotic chuckle: *k-ch*."
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

app.use(express.static("public"));
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

// ——— Project‐key management endpoints (optional) ————————————————
const getProjectId = async () => {
  const { result, error } = await deepgramClient.manage.getProjects();
  if (error) throw error;
  return result.projects[0].project_id;
};

const getTempApiKey = async (projectId) => {
  const { result, error } = await deepgramClient.manage.createProjectKey(
    projectId,
    {
      comment: "short lived",
      scopes: ["usage:write"],
      time_to_live_in_seconds: 20,
    }
  );
  if (error) throw error;
  return result;
};

app.get("/key", async (req, res) => {
  const projectId = await getProjectId();
  const key       = await getTempApiKey(projectId);
  res.json(key);
});

// ——— Socket.IO for transcripts → LLM → responses —————————————
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
      socket.emit("assistantResponse", {
        response: "Oops, something broke in Marzelle's mind.",
      });
    }
  });
});

// ——— Start server ——————————————————————————————————————————————
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});