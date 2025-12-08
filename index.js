// -------------------------
// Environment Setup
// -------------------------
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import OpenAI from "openai";

const {
  TELEGRAM_TOKEN,
  OPENAI_API_KEY,
  ASSISTANT_ID,
  BOT_SECRET,
  PORT = 3000,
} = process.env;

if (!TELEGRAM_TOKEN || !OPENAI_API_KEY || !ASSISTANT_ID || !BOT_SECRET) {
  console.error("❌ Missing required environment variables.");
  process.exit(1);
}

// -------------------------
// Initialize Services
// -------------------------
const app = express();
app.use(express.json()); // important for webhooks

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false }); // Webhook mode ONLY

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

console.log("🔧 Using Webhook Mode — polling disabled.");

// -------------------------
// Thread Storage (per chatId)
// -------------------------
const threads = new Map();

/**
 * Returns existing thread or creates a new one for the chat.
 * Each Telegram CHAT gets its own independent thread.
 */
async function getThread(chatId) {
  if (threads.has(chatId)) return threads.get(chatId);

  const thread = await openai.beta.threads.create();
  threads.set(chatId, thread.id);
  console.log(`🧵 Created new thread for chat ${chatId}: ${thread.id}`);

  return thread.id;
}

// -------------------------
// Assistant Interaction
// -------------------------
async function sendToAssistant(chatId, text) {
  const threadId = await getThread(chatId);

  // Add message to the thread
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: text,
  });

  // Run assistant
  const run = await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: ASSISTANT_ID,
  });

  // Handle failure
  if (run.status !== "completed") {
    throw new Error("Assistant run failed: " + run.status);
  }

  // Get the latest assistant reply
  const messages = await openai.beta.threads.messages.list(threadId);
  const replyMessage = messages.data[0]?.content?.[0]?.text?.value;

  return replyMessage || "⚠️ No response from assistant.";
}

// -------------------------
// Telegram Webhook URL
// -------------------------
const WEBHOOK_URL = `https://fff-tutor-todd-bot.onrender.com/webhook/${BOT_SECRET}`;

console.log("➡️ Webhook URL:", WEBHOOK_URL);

// Set webhook on Telegram startup
(async () => {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: WEBHOOK_URL }),
      }
    );

    const data = await res.json();
    console.log("✅ Webhook set successfully:", data);
  } catch (err) {
    console.error("❌ Failed to set webhook:", err);
  }
})();

// -------------------------
// Webhook Endpoint
// -------------------------
app.post(`/webhook/${BOT_SECRET}`, async (req, res) => {
  const update = req.body;

  // Ignore if no message or text
  if (!update.message || !update.message.text) {
    return res.sendStatus(200);
  }

  const chatId = update.message.chat.id;
  const text = update.message.text;

  console.log(`📩 Incoming message from chat ${chatId}: ${text}`);

  try {
    const reply = await sendToAssistant(chatId, text);
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error("Assistant Error:", err);
    await bot.sendMessage(chatId, "⚠️ Error processing your request.");
  }

  res.sendStatus(200);
});

// -------------------------
// Daily Automated Broadcast
// -------------------------
const GROUPS = [
  -1002729874032,
  -1002301644825,
  -1005002769407,
];

cron.schedule(
  "0 16 * * *", // 4 PM PST
  async () => {
    console.log("⏰ Sending 4PM PST daily Todd broadcast...");

    for (const groupId of GROUPS) {
      try {
        const lesson = await sendToAssistant(groupId, "Send today's FFF daily lesson.");
        await bot.sendMessage(groupId, lesson, { parse_mode: "Markdown" });
        console.log(`📨 Sent lesson to ${groupId}`);
      } catch (err) {
        console.error(`❌ Failed to broadcast to ${groupId}:`, err);
      }
    }
  },
  { timezone: "America/Los_Angeles" }
);

// -------------------------
// Express Server (Render)
// -------------------------
app.get("/", (req, res) => {
  res.send("FFF Tutor Todd Telegram Bot is running (Webhook mode).");
});

app.listen(PORT, () => {
  console.log(`Tutor Todd Bot running on port ${PORT}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
});

// ---------------------------------------------------
// 🔄 SELF-PING (Keeps Render Awake)
// ---------------------------------------------------
import axios from "axios";

setInterval(async () => {
  try {
    await axios.get("https://fff-tutor-todd-bot.onrender.com/");
    console.log("🔄 Self-ping OK");
  } catch (err) {
    console.error("⚠️ Self-ping failed:", err.message);
  }
}, 180000); // Ping every 3 minutes