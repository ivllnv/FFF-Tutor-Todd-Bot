import dotenv from "dotenv";
dotenv.config();

import express from "express";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import OpenAI from "openai";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = `https://fff-tutor-todd-bot.onrender.com/webhook`;

const app = express();
app.use(express.json());

// Store thread IDs per user
const userThreads = new Map();

// --- Get or Create Thread ---
async function getThread(userId) {
  if (userThreads.has(userId)) return userThreads.get(userId);

  const thread = await openai.beta.threads.create();
  userThreads.set(userId, thread.id);
  return thread.id;
}

// --- Send Message to Assistant ---
async function sendToAssistant(threadId, text) {
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: text,
  });

  await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: ASSISTANT_ID,
  });

  const messages = await openai.beta.threads.messages.list(threadId);
  return messages.data[0]?.content[0]?.text?.value || "⚠️ No response.";
}

// --- Telegram Bot in Webhook Mode ---
const SECRET_PATH = `/bot${TELEGRAM_TOKEN}`;

const bot = new TelegramBot(TELEGRAM_TOKEN, {
  webHook: {
    port: PORT,
  }
});

bot.setWebHook(`https://fff-tutor-todd-bot.onrender.com${SECRET_PATH}`);

// Set webhook on startup
bot.setWebHook(WEBHOOK_URL);

// Webhook endpoint for Telegram
app.post(SECRET_PATH, async (req, res) => {
  const message = req.body?.message;

  // Ignore empty or unsupported updates
  if (!message?.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text;

  try {
    // Get or create a thread based on USER ID (correct)
    const threadId = await getThread(userId);

    // Send text to OpenAI (corrected argument order)
    const reply = await sendToAssistant(userId, text);

    // Reply to user (safe error handling)
    await bot.sendMessage(chatId, reply)
      .catch(err => console.error("Telegram send error:", err.message));

  } catch (err) {
    console.error("Assistant Error:", err);
    await bot.sendMessage(chatId, "⚠️ Error processing your request.")
      .catch(() => {});
  }

  return res.sendStatus(200);
});

// --- DAILY 4PM BROADCAST ---
const GROUPS = [-1002729874032, -1002301644825, -1005002769407];

cron.schedule("0 16 * * *", async () => {
  console.log("⏰ 4PM PST Broadcast...");

  for (const groupId of GROUPS) {
    try {
      const threadId = await getThread(groupId);
      const lesson = await sendToAssistant(threadId, "Send today's FFF daily lesson.");
      await bot.sendMessage(groupId, lesson, { parse_mode: "Markdown" });
      console.log(`📨 Sent to group ${groupId}`);
    } catch (error) {
      console.error(`❌ Failed to send to ${groupId}`, error);
    }
  }
}, { timezone: "America/Los_Angeles" });

console.log("Tutor Todd Bot is running via Webhook...");
