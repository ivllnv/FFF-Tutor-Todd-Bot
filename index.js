import dotenv from "dotenv";
dotenv.config();

import express from "express";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import OpenAI from "openai";

// -------------------------
// ENVIRONMENT VARIABLES
// -------------------------
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;
const BOT_SECRET = process.env.BOT_SECRET; // random string
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN || !OPENAI_API_KEY || !ASSISTANT_ID || !BOT_SECRET) {
  console.error("❌ Missing required environment variables.");
  process.exit(1);
}

// -------------------------
// INIT SERVICES
// -------------------------
const bot = new TelegramBot(TELEGRAM_TOKEN); // ❗ NO POLLING
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// thread cache
const userThreads = new Map();

const app = express();
app.use(express.json());

// -------------------------
// GET OR CREATE THREAD
// -------------------------
async function getThread(userId) {
  if (userThreads.has(userId)) return userThreads.get(userId);

  const thread = await client.beta.threads.create();
  userThreads.set(userId, thread.id);

  return thread.id;
}

// -------------------------
// SEND MESSAGE TO ASSISTANT
// -------------------------
async function sendToAssistant(userId, text) {
  const threadId = await getThread(userId);

  // Add message to thread
  await client.beta.threads.messages.create(threadId, {
    role: "user",
    content: text,
  });

  // Run assistant
  const run = await client.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: ASSISTANT_ID,
  });

  if (run.status !== "completed") {
    console.error("❌ Assistant run failed:", run.status);
    return "⚠️ I'm having trouble thinking right now.";
  }

  // Get assistant message
  const messages = await client.beta.threads.messages.list(threadId);
  const aiMsg = messages.data[0];

  try {
    return aiMsg.content[0].text.value;
  } catch {
    return "⚠️ Sorry, I couldn't form a proper response.";
  }
}

// -------------------------
// TELEGRAM WEBHOOK ENDPOINT
// -------------------------
const WEBHOOK_URL = `https://fff-tutor-todd-bot.onrender.com/webhook/${BOT_SECRET}`;

app.post(`/webhook/${BOT_SECRET}`, async (req, res) => {
  const message = req.body?.message;

  if (!message?.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;

  try {
    const reply = await sendToAssistant(userId, text);

    await bot.sendMessage(chatId, reply).catch(err =>
      console.error("Telegram send error:", err.message)
    );
  } catch (err) {
    console.error("Assistant Error:", err);
    await bot.sendMessage(chatId, "⚠️ Something went wrong.").catch(() => {});
  }

  return res.sendStatus(200);
});

// -------------------------
// REGISTER TELEGRAM WEBHOOK
// -------------------------
async function initWebhook() {
  const set = await bot.setWebHook(WEBHOOK_URL);

  if (set) {
    console.log("✅ Webhook set successfully:", WEBHOOK_URL);
  } else {
    console.log("❌ Failed to set webhook.");
  }
}

initWebhook();

// -------------------------
// DAILY 4PM PST CRON
// -------------------------
const GROUPS = [
  -1002729874032,
  -1002301644825,
  -1005002769407
];

cron.schedule("0 16 * * *", async () => {
  console.log("⏰ Sending 4PM PST Tutor Todd daily broadcast...");

  for (const groupId of GROUPS) {
    try {
      const lesson = await sendToAssistant(groupId, "Send today's FFF daily lesson.");
      await bot.sendMessage(groupId, lesson, { parse_mode: "Markdown" });
      console.log(`📨 Lesson sent to group ${groupId}`);
    } catch (err) {
      console.error(`❌ Error sending to group ${groupId}:`, err);
    }
  }
}, {
  timezone: "America/Los_Angeles"
});

// -------------------------
// EXPRESS SERVER (RENDER)
// -------------------------
app.get("/", (req, res) => {
  res.send("FFF Tutor Todd Telegram Bot is running via Webhook.");
});

app.listen(PORT, () => {
  console.log(`Tutor Todd Bot running on port ${PORT}`);
  console.log("Webhook URL:", WEBHOOK_URL);
});