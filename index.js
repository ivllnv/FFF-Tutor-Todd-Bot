import dotenv from "dotenv";
dotenv.config();

import express from "express";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import OpenAI from "openai";

// --- Initialize ---
const bot = new TelegramBot(process.env.TELEGRAM_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

// Memory: thread per Telegram user
const threads = new Map();

// --- Express server (needed for Render keep-alive) ---
const app = express();
app.get("/", (req, res) => {
  res.send("FFF Tutor Todd Telegram Bot is running (Render).");
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// --- Function: Get or create a thread for the user ---
async function getThread(userId) {
  if (threads.has(userId)) return threads.get(userId);

  const thread = await client.beta.threads.create();
  threads.set(userId, thread.id);
  return thread.id;
}


// --- Function: Send message to OpenAI Assistant ---
async function sendToAssistant(userId, text) {
  const threadId = await getThread(userId);

  // Add message to thread
  await client.beta.threads.messages.create(threadId, {
    role: "user",
    content: text
  });

  // Run assistant
  const run = await client.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: ASSISTANT_ID
  });

  // Extract response
  const messages = await client.beta.threads.messages.list(threadId);
  const aiMsg = messages.data[0];

  return aiMsg.content[0].text.value;
}


// --- Telegram Listener ---
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  // ignore service messages
  if (!text) return;

  try {
    const reply = await sendToAssistant(userId, text);
    bot.sendMessage(chatId, reply, { parse_mode: "Markdown" });

  } catch (err) {
    console.error("Assistant Error:", err);
    bot.sendMessage(chatId, "⚠️ Sorry, something went wrong processing your message.");
  }
});


// --- Daily Schedule (4 PM PST every day) ---
cron.schedule("0 0 * * *", async () => {
  console.log("⏰ Sending 4PM PST Tutor Todd message...");

  const GROUPS = [
    -1002729874032,
    -1002301644825,
    -1005002769407
  ];

  for (const groupId of GROUPS) {
    try {
      const lesson = await sendToAssistant(groupId, "Send today's FFF daily lesson.");
      bot.sendMessage(groupId, lesson, { parse_mode: "Markdown" });

    } catch (err) {
      console.error("Daily message error:", err);
    }
  }
}, {
  timezone: "America/Los_Angeles"
});

console.log("Tutor Todd Bot is running...");