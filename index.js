import dotenv from "dotenv";
dotenv.config();

import express from "express";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import OpenAI from "openai";

// --- Environment variables ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;

// Store threads per user
const userThreads = new Map();

// --- Express Keep-Alive Server for Render ---
const app = express();
app.get("/", (req, res) => {
  res.send("FFF Tutor Todd Telegram Bot is running on Render.");
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// --- Get or Create User Thread ---
async function getThread(userId) {
  if (userThreads.has(userId)) {
    return userThreads.get(userId);
  }

  const thread = await openai.beta.threads.create();
  userThreads.set(userId, thread.id);
  return thread.id;
}


// --- Send message to OpenAI Assistant ---
async function sendToAssistant(threadId, text) {
  // Add user message
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: text,
  });

  // Create + Poll run
  const run = await openai.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: ASSISTANT_ID,
  });

  // Fetch latest thread messages
  const messages = await openai.beta.threads.messages.list(threadId);
  const lastMessage = messages.data[0];

  return lastMessage?.content[0]?.text?.value || "⚠️ No response from assistant.";
}


// --- Telegram Message Listener ---
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  try {
    const threadId = await getThread(userId);
    const reply = await sendToAssistant(threadId, text);

    bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error("Assistant Error:", error);
    bot.sendMessage(chatId, "⚠️ Sorry, something went wrong processing your request.");
  }
});


// --- DAILY 4PM PST CRON BROADCAST ---
const GROUPS = [
  -1002729874032,
  -1002301644825,
  -1005002769407
];

cron.schedule(
  "0 16 * * *", // 4 PM PST
  async () => {
    console.log("⏰ Sending 4PM PST Tutor Todd broadcast...");

    for (const groupId of GROUPS) {
      try {
        const threadId = await getThread(groupId);
        const lesson = await sendToAssistant(threadId, "Send today's FFF daily lesson.");

        await bot.sendMessage(groupId, lesson, { parse_mode: "Markdown" });
        console.log(`📨 Sent lesson to ${groupId}`);
      } catch (err) {
        console.error(`❌ Failed to send message to group ${groupId}:`, err);
      }
    }
  },
  { timezone: "America/Los_Angeles" }
);


console.log("Tutor Todd Bot is fully running...");