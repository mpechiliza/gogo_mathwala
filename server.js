import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent
} from "tiktok-live-connector";

// ==========================================
// CONFIGURATION
// ==========================================

const username = process.env.TIKTOK_USERNAME || "gogo_mathwala";
const LIKE_TARGET = Number(process.env.LIKE_TARGET || 100);
const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is missing!");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// GAME DATA
// ==========================================

const viewers = new Map();
const queue = [];
const addedUsers = new Set();
const clients = new Set();

let processing = false;
let currentContestant = null;

// ==========================================
// PUBLIC CONTESTANT DATA
// ==========================================

function publicContestant(person) {
  if (!person) return null;

  return {
    username: person.username,
    nickname: person.nickname,
    avatar: person.avatar || null,
    likes: person.likes,
    position: person.position,
    roast: person.roast || null
  };
}

function queueSnapshot() {
  return queue.map(publicContestant);
}

// ==========================================
// SERVER SENT EVENTS
// ==========================================

function sendEvent(response, type, payload) {
  response.write(`event: ${type}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(type, payload) {
  for (const response of clients) {
    try {
      sendEvent(response, type, payload);
    } catch {
      clients.delete(response);
    }
  }
}

function broadcastQueue() {
  broadcast("queue", {
    items: queueSnapshot()
  });
}

// ==========================================
// FRONTEND ROUTES
// ==========================================

app.get("/", (_request, response) => {
  response.sendFile(
    path.join(__dirname, "index.html")
  );
});

app.get("/IMG_5619.jpeg", (_request, response) => {
  response.sendFile(
    path.join(__dirname, "IMG_5619.jpeg"),
    (error) => {
      if (error && !response.headersSent) {
        response.status(404).send(
          "Add IMG_5619.jpeg beside index.html."
        );
      }
    }
  );
});

// Health check
app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    tiktokUsername: username,
    queueLength: queue.length,
    connectedClients: clients.size
  });
});

// Live browser connection
app.get("/events", (request, response) => {

  response.setHeader(
    "Content-Type",
    "text/event-stream; charset=utf-8"
  );

  response.setHeader(
    "Cache-Control",
    "no-cache, no-transform"
  );

  response.setHeader(
    "Connection",
    "keep-alive"
  );

  response.setHeader(
    "X-Accel-Buffering",
    "no"
  );

  response.flushHeaders?.();

  clients.add(response);

  sendEvent(response, "state", {
    currentContestant: publicContestant(
      currentContestant
    ),
    queue: queueSnapshot()
  });

  const heartbeat = setInterval(() => {
    if (!response.writableEnded) {
      response.write(": keep-alive\n\n");
    }
  }, 20000);

  request.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(response);
  });

});

// ==========================================
// START WEB SERVER
// ==========================================

const server = app.listen(PORT, HOST, () => {

  console.log("==================================");
  console.log("🔥 GOGO & TOKOLOSHE - ROAST ARENA");
  console.log("==================================");

  console.log(`Frontend: http://localhost:${PORT}`);
  console.log(`TikTok LIVE: @${username}`);
  console.log(`Entry: ${LIKE_TARGET} likes`);

});

// ==========================================
// TIKTOK CONNECTION
// ==========================================

const connection = new TikTokLiveConnection(
  username,
  {
    processInitialData: true,
    fetchRoomInfoOnConnect: true,
    enableExtendedGiftInfo: false
  }
);

// ==========================================
// GENERATE AI ZULU ROAST
// ==========================================

async function generateRoast(contestant) {

  const instructions = `
You are a hilarious South African Zulu comedy roast writer.

Create a funny, savage, creative Zulu roast.

Contestant:
Username: @${contestant.username}
Nickname: ${contestant.nickname}
Likes: ${contestant.likes}

Rules:
- Write primarily in natural isiZulu.
- Use authentic South African Zulu slang.
- Make it funny, savage and entertaining.
- Use clever jokes and unexpected punchlines.
- Maximum 3 sentences.
- Do not use hateful slurs, threats or discriminatory insults.
- Do not guess sensitive personal characteristics.
- Do not attack someone's physical features.
- If an image is provided, only use harmless visible details.
- If the image is unavailable, roast their username and nickname.
- Return ONLY the roast, no explanations.
`;

  const content = [
    {
      type: "input_text",
      text: instructions
    }
  ];

  if (contestant.avatar) {
    content.push({
      type: "input_image",
      image_url: contestant.avatar,
      detail: "low"
    });
  }

  const result = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content
      }
    ]
  });

  return result.output_text.trim();
}

// ==========================================
// PROCESS CONTESTANTS ONE AT A TIME
// ==========================================

async function processQueue() {

  if (processing) return;

  processing = true;

  try {

    while (queue.length > 0) {

      const contestant = queue.shift();

      currentContestant = contestant;

      broadcast(
        "contestant",
        publicContestant(contestant)
      );

      broadcastQueue();

      console.log(
        `🔥 Roasting @${contestant.username}`
      );

      try {

        const roast = await generateRoast(
          contestant
        );

        contestant.roast = roast;

        console.log("🤣 ZULU ROAST:", roast);

        broadcast("roast", {
          username: contestant.username,
          nickname: contestant.nickname,
          position: contestant.position,
          roast
        });

      } catch (error) {

        console.error(
          "AI ROAST ERROR:",
          error.message
        );

        broadcast("roast", {
          username: contestant.username,
          position: contestant.position,
          roast: "Hawu! UGogo uhlangabezane nenkinga encane. Sizozama futhi maduze! 😂"
        });

      }

    }

  } finally {

    processing = false;

    broadcastQueue();

    if (queue.length > 0) {
      void processQueue();
    }

  }

}

// ==========================================
// TIKTOK EVENTS
// ==========================================

connection.on(
  ControlEvent.CONNECTED,
  () => {
    console.log("✅ CONNECTED TO TIKTOK LIVE!");
  }
);

connection.on(
  ControlEvent.ERROR,
  (error) => {
    console.error("TIKTOK ERROR:", error);
  }
);

// ==========================================
// LIKE DETECTION
// ==========================================

connection.on(
  WebcastEvent.LIKE,
  (data) => {

    const user = data.user || {};

    const userId =
      user.uniqueId ||
      user.displayId ||
      user.id;

    if (!userId) return;

    const newLikes = Number(
      data.count ??
      data.likeCount ??
      0
    );

    if (
      !Number.isFinite(newLikes) ||
      newLikes <= 0
    ) {
      return;
    }

    let viewer = viewers.get(userId);

    if (!viewer) {

      viewer = {
        username: userId,
        nickname: user.nickname || userId,
        avatar:
          user.profilePicture?.urls?.[0] ||
          user.profilePictureUrl ||
          null,
        likes: 0
      };

    }

    viewer.likes += newLikes;

    viewer.nickname =
      user.nickname || viewer.nickname;

    viewer.avatar =
      user.profilePicture?.urls?.[0] ||
      user.profilePictureUrl ||
      viewer.avatar;

    viewers.set(userId, viewer);

    console.log(
      `❤️ @${viewer.username}: ${viewer.likes}/${LIKE_TARGET}`
    );

    if (
      viewer.likes >= LIKE_TARGET &&
      !addedUsers.has(userId)
    ) {

      addedUsers.add(userId);

      const contestant = {
        username: viewer.username,
        nickname: viewer.nickname,
        avatar: viewer.avatar,
        likes: viewer.likes,
        position: addedUsers.size,
        roast: null
      };

      queue.push(contestant);

      console.log(
        `🎉 QUALIFIED: @${contestant.username}`
      );

      broadcastQueue();

      void processQueue();

    }

  }
);

// ==========================================
// LIVE TIKTOK COMMENTS
// ==========================================

const chatEvent = WebcastEvent.CHAT || "chat";

connection.on(chatEvent, (data) => {

  const user = data.user || {};

  const message =
    data.comment ||
    data.content ||
    "";

  if (!message) return;

  broadcast("comment", {
    username:
      user.uniqueId ||
      user.displayId ||
      "viewer",

    nickname:
      user.nickname ||
      user.uniqueId ||
      "Viewer",

    comment: message
  });

});

// ==========================================
// CONNECT TO TIKTOK LIVE
// ==========================================

connection.connect()

  .then((state) => {

    console.log("✅ TIKTOK CONNECTION SUCCESSFUL");

    console.log(
      "Room ID:",
      state.roomId
    );

  })

  .catch((error) => {

    console.error(
      "❌ COULD NOT CONNECT TO TIKTOK:",
      error
    );

  });

// ==========================================
// SHUTDOWN
// ==========================================

async function shutdown() {

  console.log("\nStopping Roast Arena...");

  for (const client of clients) {
    client.end();
  }

  clients.clear();

  try {
    await connection.disconnect();
  } catch (error) {
    console.error(
      "Disconnect error:",
      error.message
    );
  }

  server.close(() => process.exit(0));

  setTimeout(
    () => process.exit(0),
    3000
  ).unref();

}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);