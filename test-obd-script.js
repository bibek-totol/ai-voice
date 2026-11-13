require("dotenv").config();

const { GoogleGenAI, Type } = require("@google/genai");
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

// ============================================================================
// CONFIGURATION
// ============================================================================

let API_KEY = process.env.GEMINI_API_KEY;

if (API_KEY) {
  API_KEY = API_KEY.trim().replace(/^["']|["'];?$/g, "").replace(/;$/, "").trim();
}

if (!API_KEY) {
  throw new Error(
    "GEMINI_API_KEY is missing. Add your NEW API key to the .env file."
  );
}

const SCRIPT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
];

const TTS_MODELS = [
  "gemini-3.8-flash-lite-tts",
  "gemini-3.8-flash-tts",
  "gemini-2.5-flash-preview-tts",
];

const GENERATE_VOICE_WAV = true;
const OPEN_AUDIO_AFTER_GENERATION = true;

// Target word count for a ~1.5 minute (90-second) Bangla voice broadcast
const MIN_TARGET_WORDS = 200;
const MAX_TARGET_WORDS = 230;

const DEFAULT_SAMPLE_RATE = 24000;
const USD_TO_BDT = 122;

const OUTPUT_DIR = __dirname;

const JSON_OUTPUT = path.join(
  OUTPUT_DIR,
  "generated-obd-script.json"
);

const TEXT_OUTPUT = path.join(
  OUTPUT_DIR,
  "generated-obd-script.txt"
);

const AUDIO_OUTPUT = path.join(
  OUTPUT_DIR,
  "demo-dynamic-obd.wav"
);

// Official Gemini API rates (USD per 1M tokens, valid through Dec 31, 2026)
const PRICING = {
  // Script Generation Models
  "gemini-3.8-flash": {
    inputPer1M: 0.75,
    outputPer1M: 3.75,
  },
  "gemini-3.5-flash-lite": {
    inputPer1M: 0.30,
    outputPer1M: 2.50,
  },

  // Text-to-Speech (TTS) Models (Audio output = ~25 tokens/sec)
  "gemini-3.8-flash-lite-tts": {
    inputPer1M: 0.50,
    audioOutputPer1M: 6.00,
  },
  "gemini-3.8-flash-tts": {
    inputPer1M: 0.50,
    audioOutputPer1M: 9.00,
  },
  "gemini-2.5-flash-preview-tts": {
    inputPer1M: 0.50,
    audioOutputPer1M: 10.00,
  },
};

const ai = new GoogleGenAI({
  apiKey: API_KEY,
  httpOptions: {
    apiVersion: "v1beta",
  },
});

// ============================================================================
// SAMPLE SIX-WEBSITE AGGREGATED DATA (ENRICHED FOR 1.5-MINUTE BROADCAST)
// Replace this object with your real API data.
// ============================================================================

const sixWebsitesSampleData = {
  targetLocation: {
    divisionBn: "রাজশাহী",
    districtId: "rajshahi",
    districtNameBn: "রাজশাহী",
    upazilaCode: "godagari",
    upazilaNameBn: "গোদাগাড়ী",
    forecastDate: "২০২৬-১১-১৩",
  },

  bmdUpazilaForecast: {
    tempMaxC: 31,
    tempMinC: 22,
    humidityPercent: 86,
    rainfallMmNext24h: 42,
    rainProbabilityPercent: 78,
    windSpeedKmh: 18,
    skyCondition:
      "মাঝারি থেকে ভারী মেঘাচ্ছন্ন ও দমকা হাওয়াসহ বৃষ্টির সম্ভাবনা",
  },

  bmdLiveWarnings: {
    hasActiveWarning: true,
    warningType:
      "দমকা হাওয়াসহ মাঝারি থেকে ভারী বৃষ্টির সতর্কবার্তা",
    outlookSummary:
      "আগামী ২৪ থেকে ৪৮ ঘণ্টায় রাজশাহী ও আশেপাশের অঞ্চলে থেমে থেমে বৃষ্টিপাত এবং দমকা বাতাস অব্যাহত থাকতে পারে।",
  },

  nlasAdvisory: {
    soilMoistureStatus: "অতিরিক্ত আর্দ্র (৮৫%)",
    regionalAdvisoryBn:
      "নিচু জমির রোপা আমন ও শীতকালীন সবজি ক্ষেতে বৃষ্টির পানি জমতে দেবেন না। জমির আইল ও নিষ্কাশন নালা দ্রুত পরিষ্কার করে অতিরিক্ত পানি বের করে দেওয়ার ব্যবস্থা করুন।",
  },

  bamisBulletin: {
    cropsCovered: [
      "রোপা আমন ধান (পাকা ও আধাপাকা পর্যায়)",
      "শীতকালীন সবজি (ফুলকপি, বাঁধাকপি, টমেটো, বেগুন)",
      "সরিষা ও ডাল জাতীয় ফসল",
    ],

    cropStageAdviceBn:
      "আশি শতাংশ পেকে গেলে রোপা আমন ধান দ্রুত কেটে নিরাপদ ও শুকনো স্থানে তুলে রাখুন। সবজি ও সরিষা ক্ষেতে জলাবদ্ধতা রোধে নালা কেটে দিন এবং বৃষ্টির মধ্যে কোনো ধরনের ইউরিয়া সার বা কীটনাশক স্প্রে করা থেকে বিরত থাকুন।",

    pestRisk:
      "মেঘলা ও অতিরিক্ত আর্দ্র আবহাওয়ায় রোপা আমন ধানে বাদামী গাছফড়িং ও পাতা মোড়ানো পোকার আক্রমণ এবং সবজি ক্ষেতে গোড়া পচা রোগের ঝুঁকি বাড়তে পারে। আবহাওয়া পরিষ্কার হলে কৃষি কর্মকর্তার পরামর্শে ব্যবস্থা নিন।",

    livestockAdvice:
      "গবাদি পশু এবং হাঁস-মুরগিকে বৃষ্টির ছাঁট ও ঠান্ডা বাতাস থেকে দূরে শুকনো ও উঁচু ঘরে রাখুন। দানাদার খাদ্য ও খড় যেন বৃষ্টির পানিতে ভিজে ছত্রাক না ধরে সেদিকে বিশেষ খেয়াল রাখুন এবং পশুকে পরিষ্কার বিশুদ্ধ পানি পান করান।",
  },

  ffwcFloodStatus: {
    nearestRiverBn: "পদ্মা নদী (রাজশাহী পয়েন্ট)",
    currentLevelM: 14.25,
    dangerLevelM: 18.05,
    waterTrend24hCm: "+15",

    floodStatusBn:
      "নদীর পানি বর্তমানে বিপদসীমার নিচে থাকলেও উজানের ঢল ও বৃষ্টির কারণে গত ২৪ ঘণ্টায় ১৫ সেন্টিমিটার বৃদ্ধি পেয়েছে। ফলে নদী তীরবর্তী নিচু চরাঞ্চল ও নিম্নাঞ্চলে সাময়িক জলাবদ্ধতার ঝুঁকি রয়েছে।",
  },

  aisMonthlyAdvisory: {
    routineMonthlyTipBn:
      "খরা প্রবণ এলাকায় নিয়মিত সেচ দিন এবং চারা গজানোর পর ইউরিয়া সার উপরি প্রয়োগ ও কীটনাশক স্প্রে করুন।",

    seedbedTipBn:
      "বোরো ধানের বীজতলা ও শীতকালীন সবজির চারার বেডে পানি জমতে দেবেন না এবং চারপাশের নিষ্কাশন নালা সর্বদা পরিষ্কার রাখুন।",
  },
};

// ============================================================================
// JSON RESPONSE SCHEMA
// ============================================================================

const obdScriptSchema = {
  type: Type.OBJECT,

  properties: {
    conflictResolutionNote: {
      type: Type.STRING,
      description:
        "Brief English note explaining how weather and flood data were prioritized over routine crop advice.",
    },

    greeting: {
      type: Type.STRING,
      description:
        "Warm opening greeting in Bangla mentioning district, upazila, and date.",
    },

    weatherSummary: {
      type: Type.STRING,
      description:
        "Detailed spoken Bangla weather forecast covering sky condition, rainfall amount, probability, temperature range, humidity, and wind speed. All numbers must be Bangla words.",
    },

    alertAndFloodStatus: {
      type: Type.STRING,
      description:
        "Detailed spoken Bangla weather alert (24-48h outlook) and Padma river water level, danger mark comparison, 24h rise, and char-land waterlogging warning.",
    },

    cropAndLivestockAdvisory: {
      type: Type.STRING,
      description:
        "Comprehensive, actionable Bangla farmer instructions covering Aman paddy harvesting, winter vegetables, mustard drainage, postponing fertilizer/pesticide sprays, brown planthopper/root-rot vigilance, seedbed care, and livestock/poultry shelter and dry feed protection.",
    },

    closing: {
      type: Type.STRING,
      description:
        "Polite Bangla closing statement wishing farmers safety and good harvest.",
    },

    fullSpokenScript: {
      type: Type.STRING,
      description:
        "Complete 200 to 230 word Bangla OBD voice broadcast script designed for a 1.5-minute (90-second) audio bulletin. Start with আসসালামু আলাইকুম। All numbers, decimals, and units must be written in Bangla words.",
    },

    wordCount: {
      type: Type.NUMBER,
      description:
        "Approximate whitespace-separated word count (target: 200 to 230).",
    },
  },

  required: [
    "conflictResolutionNote",
    "greeting",
    "weatherSummary",
    "alertAndFloodStatus",
    "cropAndLivestockAdvisory",
    "closing",
    "fullSpokenScript",
    "wordCount",
  ],
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getHttpStatus(error) {
  const raw = error?.status ?? error?.code;
  const parsed = Number(raw);

  if (
    Number.isFinite(parsed) &&
    parsed >= 100 &&
    parsed <= 599
  ) {
    return parsed;
  }

  const message = String(error?.message ?? "");

  const match = message.match(
    /\b(400|401|403|404|429|500|502|503|504)\b/
  );

  return match ? Number(match[1]) : null;
}

function isModelUnavailable(error, status) {
  const message = String(
    error?.message ?? ""
  ).toLowerCase();

  return (
    status === 404 ||
    message.includes("model not found") ||
    message.includes("not_found") ||
    message.includes("is not supported")
  );
}

function isTemporaryError(status, error) {
  const message = String(
    error?.message ?? ""
  ).toLowerCase();

  return (
    [429, 500, 502, 503, 504].includes(status) ||
    message.includes("high demand") ||
    message.includes("temporarily unavailable") ||
    message.includes("unavailable")
  );
}

// ============================================================================
// GEMINI RETRY + MODEL FALLBACK
// ============================================================================

async function callGeminiWithFallback(
  modelList,
  contents,
  config,
  maxRetriesPerModel = 2
) {
  let lastError = null;

  for (const model of modelList) {
    for (
      let attempt = 1;
      attempt <= maxRetriesPerModel;
      attempt++
    ) {
      try {
        console.log(
          `-> Trying "${model}" (attempt ${attempt}/${maxRetriesPerModel})`
        );

        const response = await ai.models.generateContent({
          model,
          contents,
          config,
        });

        console.log(`[Success] ${model}`);

        return {
          response,
          activeModel: model,
        };
      } catch (error) {
        lastError = error;

        const status = getHttpStatus(error);

        // Model unavailable: skip immediately.
        if (isModelUnavailable(error, status)) {
          console.warn(
            `[Skip] ${model} is unavailable. Trying next model.`
          );

          break;
        }

        // Temporary errors: retry and then move to fallback.
        if (isTemporaryError(status, error)) {
          if (attempt < maxRetriesPerModel) {
            const waitMs = attempt * 3000;

            console.warn(
              `[Temporary error ${status ?? "unknown"}] Retrying in ${waitMs / 1000}s.`
            );

            await sleep(waitMs);
            continue;
          }

          console.warn(
            `[Fallback] ${model} failed after retries.`
          );

          break;
        }

        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("No Gemini model was configured.");
}

// ============================================================================
// AUDIO FUNCTIONS
// ============================================================================

function extractAudioPart(response) {
  const parts =
    response?.candidates?.[0]?.content?.parts ?? [];

  const audioPart = parts.find(
    (part) =>
      part?.inlineData?.data &&
      part?.inlineData?.mimeType
  );

  if (!audioPart) {
    throw new Error(
      "Gemini returned no audio data. Check the TTS response."
    );
  }

  return audioPart.inlineData;
}

function getSampleRateFromMimeType(mimeType) {
  const match = String(mimeType).match(
    /rate=(\d+)/i
  );

  return match
    ? Number(match[1])
    : DEFAULT_SAMPLE_RATE;
}

function pcmToWav(
  pcmBuffer,
  sampleRate = DEFAULT_SAMPLE_RATE
) {
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;

  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);

  header.write("WAVE", 8);
  header.write("fmt ", 12);

  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);

  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);

  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([
    header,
    pcmBuffer,
  ]);
}

// ============================================================================
// WORD COUNT AND COST
// ============================================================================

function getWordCount(text) {
  return String(text)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function formatCost(
  model,
  usage,
  outputTokenField,
  outputRateField
) {
  const rates = PRICING[model];

  if (
    !rates ||
    typeof rates.inputPer1M !== "number" ||
    typeof rates[outputRateField] !== "number"
  ) {
    return null;
  }

  const inputTokens =
    usage?.promptTokenCount ?? 0;

  const candidateTokens =
    usage?.[outputTokenField] ?? 0;
  const thinkingTokens =
    usage?.thoughtsTokenCount ?? 0;
  const outputTokens =
    candidateTokens + thinkingTokens;

  return (
    (inputTokens / 1_000_000) *
    rates.inputPer1M +
    (outputTokens / 1_000_000) *
    rates[outputRateField]
  );
}

// ============================================================================
// OPEN GENERATED AUDIO
// ============================================================================

function openAudioFile(filePath) {
  if (process.platform === "win32") {
    exec(`start "" "${filePath}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${filePath}"`);
  } else {
    exec(`xdg-open "${filePath}"`);
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  // --------------------------------------------------------------------------
  // STEP 1: GENERATE 1.5-MINUTE BANGLA OBD SCRIPT
  // --------------------------------------------------------------------------

  console.log("====================================================");
  console.log(" STEP 1: GENERATING 1.5-MINUTE BANGLA OBD SCRIPT");
  console.log("====================================================");

  const systemInstruction = `
You are the Lead Agro-Meteorological Broadcast Editor for Bangladesh.

Analyze the supplied JSON from BMD, BMD-Live, NLAS, BAMIS, FFWC, and AIS.

IMPORTANT RULES FOR 1.5-MINUTE (90-SECOND) VOICE BROADCAST:

1. WEATHER SAFETY HAS PRIORITY:
   If rain probability is above 50%, rainfall is significant,
   soil is very wet, or an active weather warning exists,
   do not repeat routine advice to irrigate, apply urea,
   or spray pesticides.

   Instead, advise farmers to clear drainage channels,
   prevent waterlogging, harvest mature Aman paddy safely,
   and postpone fertilizer or pesticide spraying until skies clear.

2. Use only facts present in the supplied data.
   Do not invent warnings, measurements, river conditions,
   or crop problems.

3. Write natural, clear, well-paced spoken Bangla suitable for
   a 1.5-minute (90-second) telephone OBD voice broadcast.

4. Write every number, decimal, percentage, and unit
   in Bangla words.

   Do not leave Arabic numerals, English numerals,
   or symbols such as %, mm, cm, m, °C, or km/h
   in the spoken script.

5. LENGTH REQUIREMENT FOR 1.5 MINUTES:
   The fullSpokenScript MUST contain between ${MIN_TARGET_WORDS} and ${MAX_TARGET_WORDS}
   whitespace-separated Bangla words.
   To achieve this naturally without repetition, thoroughly cover:
   - Greeting with district, upazila, and forecast date in Bangla words.
   - Complete weather breakdown (sky condition, max/min temperature, humidity, wind speed, rain probability, expected rainfall in mm).
   - Active 24-48 hour weather warning and Padma river status (current level, danger level, 24-hour water rise, and low-lying char area risk).
   - Detailed crop-by-crop guidance (ripening Aman paddy harvest & storage, cauliflower/cabbage/tomato/eggplant drainage, mustard care, seedbed drainage, and postponing urea/pesticide application).
   - Pest & disease vigilance (brown planthopper, leaf folder, root rot) after rain subsides.
   - Detailed livestock and poultry care (dry shelter from wind/rain, protecting straw and feed from dampness/mold, clean drinking water).
   - Warm, encouraging closing statement.

6. Start fullSpokenScript exactly with:
   "আসসালামু আলাইকুম।"

7. Routine AIS monthly advice to irrigate or spray must not override
   current wet-weather warnings.

8. Return only JSON matching the provided schema.
`;

  const scriptStart = Date.now();

  const {
    response: scriptResponse,
    activeModel: activeScriptModel,
  } = await callGeminiWithFallback(
    SCRIPT_MODELS,

    [
      {
        role: "user",
        parts: [
          {
            text: JSON.stringify(
              sixWebsitesSampleData
            ),
          },
        ],
      },
    ],

    {
      systemInstruction,

      responseMimeType: "application/json",
      responseSchema: obdScriptSchema,

      temperature: 0.25,
    }
  );

  const scriptLatencySeconds = (
    (Date.now() - scriptStart) /
    1000
  ).toFixed(2);

  if (!scriptResponse.text) {
    throw new Error(
      "Gemini returned an empty script response."
    );
  }

  let generatedData;

  try {
    generatedData = JSON.parse(
      scriptResponse.text
    );
  } catch (error) {
    console.error(
      "Gemini returned invalid JSON:"
    );

    console.error(scriptResponse.text);

    throw new Error(
      `Could not parse generated JSON: ${error.message}`
    );
  }

  if (
    typeof generatedData.fullSpokenScript !== "string" ||
    !generatedData.fullSpokenScript.trim()
  ) {
    throw new Error(
      "Generated JSON does not contain fullSpokenScript."
    );
  }

  // Calculate actual word count locally.
  generatedData.wordCount = getWordCount(
    generatedData.fullSpokenScript
  );

  // Save structured JSON.
  fs.writeFileSync(
    JSON_OUTPUT,
    JSON.stringify(
      generatedData,
      null,
      2
    ),
    "utf8"
  );

  // Save clean Bangla script.
  fs.writeFileSync(
    TEXT_OUTPUT,
    generatedData.fullSpokenScript,
    "utf8"
  );

  // --------------------------------------------------------------------------
  // SCRIPT TOKEN REPORT
  // --------------------------------------------------------------------------

  const scriptUsage =
    scriptResponse.usageMetadata ?? {};

  const scriptInputTokens =
    scriptUsage.promptTokenCount ?? 0;

  const scriptOutputTokens =
    (scriptUsage.candidatesTokenCount ?? 0) +
    (scriptUsage.thoughtsTokenCount ?? 0);

  const scriptTotalTokens =
    scriptUsage.totalTokenCount ??
    scriptInputTokens + scriptOutputTokens;

  const scriptCost = formatCost(
    activeScriptModel,
    scriptUsage,
    "candidatesTokenCount",
    "outputPer1M"
  );

  console.log("\n[Conflict Resolution]");
  console.log(
    generatedData.conflictResolutionNote
  );

  console.log("\n--- GENERATED 1.5-MINUTE BANGLA OBD SCRIPT ---");

  console.log(
    generatedData.fullSpokenScript
  );

  console.log("----------------------------------------------");

  console.log("\nSCRIPT GENERATION REPORT");

  console.log(
    `Model used      : ${activeScriptModel}`
  );

  console.log(
    `API latency     : ${scriptLatencySeconds} seconds`
  );

  console.log(
    `Word count      : ${generatedData.wordCount} (Target: ${MIN_TARGET_WORDS}–${MAX_TARGET_WORDS} words for ~90s)`
  );

  console.log(
    `Input tokens    : ${scriptInputTokens}`
  );

  console.log(
    `Output tokens   : ${scriptOutputTokens}`
  );

  console.log(
    `Total tokens    : ${scriptTotalTokens}`
  );

  if (
    generatedData.wordCount < MIN_TARGET_WORDS ||
    generatedData.wordCount > MAX_TARGET_WORDS
  ) {
    console.warn(
      `Warning: Script has ${generatedData.wordCount} words. Target: ${MIN_TARGET_WORDS}–${MAX_TARGET_WORDS}.`
    );
  }

  if (scriptCost === null) {
    console.log(
      "Script cost     : Not calculated. Configure current official rates in PRICING."
    );
  } else {
    console.log(
      `Script cost     : $${scriptCost.toFixed(6)} USD (~৳${(
        scriptCost * USD_TO_BDT
      ).toFixed(4)} BDT)`
    );
  }

  console.log(`\nSaved: ${JSON_OUTPUT}`);
  console.log(`Saved: ${TEXT_OUTPUT}`);

  // --------------------------------------------------------------------------
  // STEP 2: GENERATE VOICE WAV (~1.5 MINUTES)
  // --------------------------------------------------------------------------

  if (!GENERATE_VOICE_WAV) {
    return;
  }

  console.log("\n====================================================");
  console.log(" STEP 2: CONVERTING SCRIPT TO 1.5-MIN VOICE WAV");
  console.log("====================================================");

  const ttsStart = Date.now();

  const {
    response: ttsResponse,
    activeModel: activeTtsModel,
  } = await callGeminiWithFallback(
    TTS_MODELS,

    [
      {
        role: "user",
        parts: [
          {
            text: generatedData.fullSpokenScript,
          },
        ],
      },
    ],

    {
      responseModalities: ["AUDIO"],

      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: "Charon",
          },
        },
      },
    }
  );

  const ttsLatencySeconds = (
    (Date.now() - ttsStart) /
    1000
  ).toFixed(2);

  // Extract inline audio from Gemini response.
  const audioData = extractAudioPart(
    ttsResponse
  );

  const pcmBuffer = Buffer.from(
    audioData.data,
    "base64"
  );

  const sampleRate = getSampleRateFromMimeType(
    audioData.mimeType
  );

  // Convert PCM data to WAV.
  const wavBuffer = pcmToWav(
    pcmBuffer,
    sampleRate
  );

  fs.writeFileSync(
    AUDIO_OUTPUT,
    wavBuffer
  );

  const audioDurationSeconds =
    pcmBuffer.length / (sampleRate * 2);

  // --------------------------------------------------------------------------
  // TTS TOKEN REPORT
  // --------------------------------------------------------------------------

  const ttsUsage =
    ttsResponse.usageMetadata ?? {};

  const ttsInputTokens =
    ttsUsage.promptTokenCount ?? 0;

  let ttsOutputTokens =
    ttsUsage.candidatesTokenCount ?? 0;

  if (!ttsOutputTokens && audioDurationSeconds > 0) {
    ttsOutputTokens = Math.ceil(audioDurationSeconds * 25);
    ttsUsage.candidatesTokenCount = ttsOutputTokens;
  }

  const ttsCost = formatCost(
    activeTtsModel,
    ttsUsage,
    "candidatesTokenCount",
    "audioOutputPer1M"
  );

  console.log("\nTTS REPORT");

  console.log(
    `TTS model       : ${activeTtsModel}`
  );

  console.log(
    `TTS latency     : ${ttsLatencySeconds} seconds`
  );

  console.log(
    `Audio MIME type : ${audioData.mimeType}`
  );

  console.log(
    `Sample rate     : ${sampleRate} Hz`
  );

  console.log(
    `Audio duration  : ${audioDurationSeconds.toFixed(2)} seconds (~${(
      audioDurationSeconds / 60
    ).toFixed(2)} minutes)`
  );

  console.log(
    `Input tokens    : ${ttsInputTokens}`
  );

  console.log(
    `Output tokens   : ${ttsOutputTokens}`
  );

  if (ttsCost === null) {
    console.log(
      "TTS cost        : Not calculated. Configure current official rates in PRICING."
    );
  } else {
    console.log(
      `TTS cost        : $${ttsCost.toFixed(6)} USD (~৳${(
        ttsCost * USD_TO_BDT
      ).toFixed(4)} BDT)`
    );
  }

  console.log(`\nAudio saved     : ${AUDIO_OUTPUT}`);

  // --------------------------------------------------------------------------
  // TOTAL COMBINED COST REPORT
  // --------------------------------------------------------------------------

  if (scriptCost !== null || ttsCost !== null) {
    const totalUsd = (scriptCost ?? 0) + (ttsCost ?? 0);
    const totalBdt = totalUsd * USD_TO_BDT;

    console.log("\n====================================================");
    console.log(" TOTAL COMBINED COST REPORT (1.5-MIN VOICE OBD)");
    console.log("====================================================");
    console.log(
      `Single 90s run  : $${totalUsd.toFixed(6)} USD (~৳${totalBdt.toFixed(4)} BDT)`
    );
    console.log(
      `Per 1,000 runs  : $${(totalUsd * 1000).toFixed(2)} USD (~৳${(totalBdt * 1000).toFixed(2)} BDT)`
    );
  }

  // Open WAV automatically.
  if (OPEN_AUDIO_AFTER_GENERATION) {
    openAudioFile(AUDIO_OUTPUT);
  }

  console.log("\nAll tasks completed successfully.");
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

main().catch((error) => {
  console.error(
    "\n========== OBD GENERATION FAILED =========="
  );

  console.error(
    error?.message ?? error
  );

  if (error?.status) {
    console.error(
      `HTTP status: ${error.status}`
    );
  }

  console.error(
    "==========================================="
  );

  process.exitCode = 1;
});