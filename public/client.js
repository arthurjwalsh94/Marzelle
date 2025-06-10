// public/client.js
const captions = document.getElementById("captions");

async function getMicrophone() {
  const userMedia = await navigator.mediaDevices.getUserMedia({ audio: true });
  return new MediaRecorder(userMedia);
}

async function openMicrophone(microphone, dgSocket) {
  await microphone.start(500);

  microphone.onstart = () => {
    console.log("client: microphone opened");
    document.body.classList.add("recording");
  };

  microphone.onstop = () => {
    console.log("client: microphone closed");
    document.body.classList.remove("recording");
  };

  microphone.ondataavailable = (e) => {
    dgSocket.send(e.data);  // send raw audio to Deepgram
    console.log("client: sent data to Deepgram");
  };
}

async function closeMicrophone(microphone) {
  microphone.stop();
}

async function startDeepgram(dgSocket, chatSocket) {
  const listenButton = document.getElementById("record");
  let microphone;

  listenButton.addEventListener("click", async () => {
    if (!microphone) {
      microphone = await getMicrophone();
      await openMicrophone(microphone, dgSocket);
    } else {
      await closeMicrophone(microphone);
      microphone = undefined;
    }
  });

  // When Deepgram returns a final transcript:
  dgSocket.on("Results", (data) => {
    const alt       = data.channel.alternatives[0];
    const transcript = alt.transcript.trim();
    if (!transcript) return;

    console.log("YOU ▸", transcript);
    captions.innerHTML = `<span class="you">${transcript}</span>`;

    // send it to your Node server
    chatSocket.emit("transcript", { transcript });
  });
}

async function getTempApiKey() {
  const res  = await fetch("/key");
  const json = await res.json();
  return json.key;
}

window.addEventListener("load", async () => {
  // 1) Chat socket to your Express+Socket.IO server
  const chatSocket = io();

  // Listen for Marzelle’s reply
  chatSocket.on("assistantResponse", ({ response }) => {
    console.log("🪸 Marzelle ▸", response);
    captions.innerHTML = `<span class="marzelle">${response}</span>`;
  });

  // 2) Deepgram STT setup
  const key       = await getTempApiKey();
  const { createClient } = deepgram;
  const _deepgram = createClient(key);

  // rename this to avoid confusion with chatSocket
  const dgSocket = _deepgram.listen.live({
    model:       "nova",
    smart_format:true
  });

  dgSocket.on("open", async () => {
    console.log("client: connected to Deepgram");
    await startDeepgram(dgSocket, chatSocket);
  });

  dgSocket.on("error", (e)   => console.error("Deepgram error:", e));
  dgSocket.on("warning", (w) => console.warn("Deepgram warning:", w));
  dgSocket.on("close", (c)   => console.log("Deepgram closed:", c));
});