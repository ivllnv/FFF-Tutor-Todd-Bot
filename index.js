import dotenv from "dotenv";
dotenv.config();

import express from "express";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import OpenAI from "openai";

// --- Initialize environment + services ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

const PORT = process.env.PORT || 3000;

// Thread cache for storing conversations per user
const threads = new Map();

// --- Express server for Render keep-alive ---
const app = express();
app.get("/", (req, res) => {
  res.send("FFF Tutor Todd Telegram Bot is running on Render.");
});
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));


// --- Get or create thread for user ---
async function getThread(userId) {
  if (threads.has(userId)) return threads.get(userId);

  const thread = await client.beta.threads.create();
  threads.set(userId, thread.id);
  return thread.id;
}


// --- Send message to Assistant ---
async function sendToAssistant(userId, text) {
  const threadId = await getThread(userId);

  // Add message to thread
  await client.beta.threads.messages.create(threadId, {
    role: "user",
    content: text
  });

  // Run assistant and wait for response
  const run = await client.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: ASSISTANT_ID
  });

  // Extract the latest message from thread
  const messages = await client.beta.threads.messages.list(threadId);
  const aiMsg = messages.data[0];

  return aiMsg.content[0].text.value;
}


// --- Telegram message handler ---
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  try {
    // Create or reuse thread for user
    let threadId = userThreads.get(userId);
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      userThreads.set(userId, threadId);
    }

    // Add user message to thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: text,
    });

    // Start a run
    let run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
    });

    // WAIT for run to complete
    let runStatus = run.status;
    while (runStatus === "queued" || runStatus === "in_progress") {
      await new Promise((r) => setTimeout(r, 1000));
      const updatedRun = await openai.beta.threads.runs.retrieve(threadId, run.id);
      runStatus = updatedRun.status;
    }

    // If run failed
    if (runStatus !== "completed") {
      throw new Error("Run failed with status: " + runStatus);
    }

    // Fetch the assistant reply
    const messages = await openai.beta.threads.messages.list(threadId);
    const lastMessage = messages.data[0];

    const reply = lastMessage?.content[0]?.text?.value || "⚠️ No response from assistant.";

    bot.sendMessage(chatId, reply);
  } catch (error) {
    console.error("Assistant Error:", error);
    bot.sendMessage(chatId, "⚠️ Sorry, something went wrong processing your request.");
  }
});

// --- DAILY 4 PM PST BROADCAST ---
const GROUPS = [
  -1002729874032,
  -1002301644825,
  -1005002769407
];

cron.schedule("0 0 * * *", async () => {
  console.log("⏰ Sending 4PM PST Tutor Todd broadcast...");

  for (const groupId of GROUPS) {
    try {
      const lesson = await sendToAssistant(groupId, "Send today's FFF daily lesson.");
      await bot.sendMessage(groupId, lesson, { parse_mode: "Markdown" });
      console.log(`📨 Sent lesson to ${groupId}`);
    } catch (err) {
      console.error(`❌ Failed to send message to group ${groupId}:`, err);
    }
  }
}, {
  timezone: "America/Los_Angeles"
});

console.log("Tutor Todd Bot is fully running...");