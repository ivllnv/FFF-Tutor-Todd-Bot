// -------------------------
// Environment Setup
// -------------------------
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import OpenAI from "openai";
import axios from "axios";
import fs from "node:fs";

const promptsPath = new URL("./tutor_todd_daily_checkins.json", import.meta.url);
const prompts = JSON.parse(fs.readFileSync(promptsPath, "utf-8"));

const {
  TELEGRAM_TOKEN,
  OPENAI_API_KEY,
  ASSISTANT_ID,
  BOT_SECRET,
  PORT = 3000,
} = process.env;

if (! TELEGRAM_TOKEN || ! OPENAI_API_KEY || ! ASSISTANT_ID || ! BOT_SECRET) {
  console.error("❌ Missing required environment variables.");
  process.exit(1);
}

// -------------------------
// Initialize Services
// -------------------------
const app = express();
app.use(express.json());

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

console.log("🔧 Using Webhook Mode — polling disabled.");

// -------------------------
// Thread Storage (per chatId)
// -------------------------
const threads = new Map();

/**
 * Returns existing thread or creates a new one for the chat.
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

  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: text,
  });

  const run = await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: ASSISTANT_ID,
  });

  if (run.status !== "completed") {
    throw new Error("Assistant run failed: " + run.status);
  }

  const messages = await openai.beta.threads.messages.list(threadId);
  const replyMessage = messages.data[0]?.content?.[0]?.text?.value;

  return replyMessage || "⚠️ No response from assistant.";
}

// -------------------------
// Webhook URL Setup
// -------------------------
const WEBHOOK_URL = `https://fff-tutor-todd-bot.onrender.com/webhook/${BOT_SECRET}`;
console.log("➡️ Webhook URL:", WEBHOOK_URL);

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
// Safe Telegram Sender (Retry + Quarantine)
// -------------------------
const invalidGroups = new Set();

async function safeSendMessage(chatId, message, options = {}) {
  try {
    return await bot.sendMessage(chatId, message, options);
  } catch (err) {
    // Rate limit retry
    if (err.code === "ETELEGRAM" && err.response?.statusCode === 429) {
      const retryAfter = err.response?.body?.parameters?.retry_after || 1;
      console.log(`⏳ Rate limit hit. Retrying in ${retryAfter}s...`);
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      return safeSendMessage(chatId, message, options);
    }

    // Chat not found (bot removed / group deleted / wrong ID)
    if (err.code === "ETELEGRAM" && err.response?.statusCode === 400) {
      console.error(`❌ Invalid or inaccessible group ${chatId}. Quarantining.`);
      invalidGroups.add(chatId);
      return null;
    }

    console.error(`❌ Failed to send message to ${chatId}:`, err.message);
    return null;
  }
}

// -------------------------
// DAILY CONTENT HELPERS (Fatherbot / Student)
// -------------------------

function getDayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Deterministic daily picker:
 * - Changes each day
 * - Also offset by groupId so each group gets a different item
 */
function getDailyItem(arr, seed = 0, groupId = 0) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const day = getDayOfYear();
  const base = day + seed + Math.abs(Number(groupId) || 0);
  const index = ((base % arr.length) + arr.length) % arr.length;
  return arr[index];
}

function buildFatherbotMessage(groupId) {
  const f = prompts.fatherbot;

  const intro      = getDailyItem(f.intros, 3, groupId);
  const title      = getDailyItem(f.motivational_titles, 7, groupId);
  const quote      = getDailyItem(f.quotes, 11, groupId);
  const reflection = getDailyItem(f.reflection_templates, 17, groupId);
  const checkin    = getDailyItem(f.checkins, 23, groupId);
  const closing    = getDailyItem(f.closing_messages, 29, groupId);

  return [
    intro,
    "",
    `${title}`,
    `“${quote}”`,
    "",
    `*Reflection:* ${reflection}`,
    "",
    `*Check-in:* ${checkin}`,
    "",
    closing,
  ].join("\n");
}

function buildStudentMessage(groupId) {
  const s = prompts.student;

  const intro      = getDailyItem(s.intros, 5, groupId);
  const title      = getDailyItem(s.motivational_titles, 9, groupId);
  const quote      = getDailyItem(s.quotes, 13, groupId);
  const reflection = getDailyItem(s.reflection_templates, 19, groupId);
  const checkin    = getDailyItem(s.checkins, 31, groupId);
  const closing    = getDailyItem(s.closing_messages, 37, groupId);

  return [
    intro,
    "",
    `${title}`,
    `“${quote}”`,
    "",
    `*Reflection:* ${reflection}`,
    "",
    `*Check-in:* ${checkin}`,
    "",
    closing,
  ].join("\n");
}

// -------------------------
// Upgraded Daily Broadcast
// -------------------------
const GROUPS = [
  -1002729874032, // Student
  -1002301644825, // Fatherbot
  -1003239995492, // Student
];

cron.schedule(
  "0 4 * * *", // 4 AM PST
  async () => {
    console.log("⏰ Sending 4AM PST Daily Lesson...");

    for (const groupId of GROUPS) {
      try {
        if (invalidGroups.has(groupId)) {
          console.log(`⚠️ Skipping quarantined group ${groupId}`);
          continue;
        }

        // 👉 DIFFERENT CONTENT PER GROUP
        // Fatherbot: -1002301644825
        // Students:  -1002729874032, -1003239995492
        let lesson;
        if (groupId === -1002301644825) {
          lesson = buildFatherbotMessage(groupId);
        } else {
          lesson = buildStudentMessage(groupId);
        }

        const result = await safeSendMessage(groupId, lesson, {
          parse_mode: "Markdown",
        });

        if (result) {
          console.log(`📨 Sent lesson to ${groupId}`);
        }

      } catch (err) {
        console.error(`❌ Critical broadcast error for ${groupId}:`, err);
      }
    }

    console.log("📊 Daily broadcast complete.");
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

// -------------------------
// Self-Ping (Keeps Render Awake)
// -------------------------
setInterval(async () => {
  try {
    await axios.get("https://fff-tutor-todd-bot.onrender.com/");
    console.log("🔄 Self-ping OK");
  } catch (err) {
    console.error("⚠️ Self-ping failed:", err.message);
  }
}, 180000);