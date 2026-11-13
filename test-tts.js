require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const fs = require("fs");
const { exec } = require("child_process");

const MODEL_ID = "gemini-3.8-flash-lite-tts";
const SAMPLE_RATE = 24000;
const USD_TO_BDT = 125; // Approximate exchange rate

// Pricing per 1 Million tokens (USD)
const MODEL_PRICING = {
  "gemini-3.8-flash-lite-tts": { inputPer1M: 0.50, audioOutputPer1M: 6.00 },
  "gemini-3.8-flash-tts": { inputPer1M: 0.50, audioOutputPer1M: 9.00 },
  "gemini-2.5-flash-preview-tts": { inputPer1M: 0.50, audioOutputPer1M: 10.00 },
};

let apiKey = process.env.GEMINI_API_KEY;
if (apiKey) {
  apiKey = apiKey.trim().replace(/^["']|["'];?$/g, "").replace(/;$/, "").trim();
}
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is missing. Add your API key to the .env file.");
}

const ai = new GoogleGenAI({
  apiKey,
  apiVersion: "v1beta",
  httpOptions: { apiVersion: "v1beta" },
});

function ensureWavHeader(buffer, sampleRate = 24000) {
  if (buffer.length > 44 && buffer.subarray(0, 4).toString("ascii") === "RIFF") {
    return buffer;
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([header, buffer]);
}

const oneMinuteBanglaScript = `আসসালামু আলাইকুম। প্রিয় কৃষক ভাই ও বোনেরা, কৃষি আবহাওয়া ও বন্যা পূর্বাভাস কেন্দ্রের বিশেষ ভয়েস বার্তায় আপনাদের স্বাগতম। এখন শুনুন আপনার জেলা ও উপজেলার আগামী চব্বিশ ঘণ্টার আবহাওয়া এবং জরুরি কৃষি পরামর্শ।

আবহাওয়া অধিদপ্তরের সর্বশেষ তথ্য অনুযায়ী, আগামী চব্বিশ ঘণ্টায় আপনার এলাকায় আকাশ আংশিক মেঘলা থেকে মেঘাচ্ছন্ন থাকতে পারে এবং হালকা থেকে মাঝারি ধরনের বৃষ্টির সম্ভাবনা রয়েছে। দিনের সর্বোচ্চ তাপমাত্রা একত্রিশ ডিগ্রি সেলসিয়াস এবং রাতের সর্বনিম্ন তাপমাত্রা বাইশ ডিগ্রি সেলসিয়াসের কাছাকাছি থাকতে পারে। বাতাসে আর্দ্রতার পরিমাণ থাকবে প্রায় পঁচাশি শতাংশ এবং ঘণ্টায় দশ থেকে পনেরো কিলোমিটার বেগে দমকা হাওয়া বয়ে যেতে পারে।

বন্যা পূর্বাভাস ও সতর্কীকরণ কেন্দ্রের তথ্যমতে, আপনার এলাকার প্রধান নদ-নদীর পানি সমতল বর্তমানে বিপদসীমার নিচ দিয়ে প্রবাহিত হচ্ছে। তবে মাঝারি বৃষ্টির কারণে নিচু জমিতে সাময়িক জলাবদ্ধতা তৈরি হতে পারে।

এমতাবস্থায় আমন ধান ও শীতকালীন সবজি রক্ষায় জমির চারপাশের নালাগুলো এখনই পরিষ্কার করে দিন, যাতে বৃষ্টির অতিরিক্ত পানি দ্রুত নিষ্কাশন হতে পারে। বৃষ্টির পূর্বাভাস থাকায় আজ ও আগামীকাল জমিতে ইউরিয়া সার কিংবা কোনো ধরনের কীটনাশক ও ছত্রাকনাশক স্প্রে করা থেকে বিরত থাকুন। বীজতলায় যেন পানি জমে না থাকে সেদিকে বিশেষ নজর রাখুন এবং গবাদি পশু ও হাঁস-মুরগিকে শুকনো ও নিরাপদ স্থানে রাখুন।

বিস্তারিত তথ্যের জন্য আপনার নিকটস্থ উপসহকারী কৃষি কর্মকর্তার সাথে যোগাযোগ করুন। আপনাদের সবার সুস্বাস্থ্য ও নিরাপদ ফসল কামনা করে আজকের মতো এখানেই শেষ করছি। ধন্যবাদ।`;

(async () => {
  console.log(`Generating ~1-minute Bangla OBD voice using ${MODEL_ID}...`);
  const startTime = Date.now();

  const res = await ai.models.generateContent({
    model: MODEL_ID,
    contents: [
      {
        role: "user",
        parts: [{ text: oneMinuteBanglaScript }],
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Charon" }, // "Charon" (Male) or "Kore" (Female)
        },
      },
    },
  });

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const base64Audio = res.candidates[0].content.parts[0].inlineData.data;
  const rawBuffer = Buffer.from(base64Audio, "base64");
  const wavBuffer = ensureWavHeader(rawBuffer, SAMPLE_RATE);

  // Calculate exact audio duration from 16-bit (2 bytes per sample) mono PCM data
  const pcmDataBytes = wavBuffer.length - 44;
  const audioDurationSec = pcmDataBytes / (SAMPLE_RATE * 2);

  // Extract token counts from usageMetadata (with fallback estimation if omitted)
  const usage = res.usageMetadata || {};
  const inputTokens =
    usage.promptTokenCount ?? Math.ceil(oneMinuteBanglaScript.length / 2.5);
  const outputTokens =
    usage.candidatesTokenCount ?? Math.ceil(audioDurationSec * 25);
  const totalTokens = usage.totalTokenCount ?? inputTokens + outputTokens;

  // Calculate cost
  const rates = MODEL_PRICING[MODEL_ID] || MODEL_PRICING["gemini-3.8-flash-lite-tts"];
  const inputCostUsd = (inputTokens / 1_000_000) * rates.inputPer1M;
  const outputCostUsd = (outputTokens / 1_000_000) * rates.audioOutputPer1M;
  const totalCostUsd = inputCostUsd + outputCostUsd;
  const totalCostBdt = totalCostUsd * USD_TO_BDT;

  // Print Telemetry & Cost Report
  console.log("\n====================================================");
  console.log("         OBD VOICE GENERATION & COST REPORT         ");
  console.log("====================================================");
  console.log(`Model Used           : ${MODEL_ID}`);
  console.log(`API Latency          : ${elapsedSec} sec`);
  console.log(`Audio Duration       : ${audioDurationSec.toFixed(2)} sec (~${(audioDurationSec / 60).toFixed(2)} min)`);
  console.log(`WAV File Size        : ${(wavBuffer.length / 1024).toFixed(1)} KB`);
  console.log("----------------------------------------------------");
  console.log(`Input Tokens (Text)  : ${inputTokens.toLocaleString()} tokens`);
  console.log(`Output Tokens (Audio): ${outputTokens.toLocaleString()} tokens`);
  console.log(`Total Tokens         : ${totalTokens.toLocaleString()} tokens`);
  console.log("----------------------------------------------------");
  console.log(`Input Cost           : $${inputCostUsd.toFixed(6)} USD`);
  console.log(`Audio Output Cost    : $${outputCostUsd.toFixed(6)} USD`);
  console.log(`Total Cost (1 Audio) : $${totalCostUsd.toFixed(5)} USD (~৳${totalCostBdt.toFixed(2)} BDT)`);
  console.log("----------------------------------------------------");
  console.log(`64 Districts / Day   : $${(totalCostUsd * 64).toFixed(2)} USD (~৳${(totalCostBdt * 64).toFixed(0)} BDT)`);
  console.log(`495 Upazilas / Day   : $${(totalCostUsd * 495).toFixed(2)} USD (~৳${(totalCostBdt * 495).toFixed(0)} BDT)`);
  console.log(`495 Upazilas (Batch) : $${((totalCostUsd * 495) / 2).toFixed(2)} USD (~৳${((totalCostBdt * 495) / 2).toFixed(0)} BDT) [50% Batch Discount]`);
  console.log("====================================================\n");

  fs.writeFileSync("demo-obd-1min.wav", wavBuffer);
  console.log("Saved demo-obd-1min.wav! Opening in default audio player...");
  exec("start demo-obd-1min.wav");
})();