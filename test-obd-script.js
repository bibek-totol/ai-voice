
require("dotenv").config();

const { GoogleGenAI, Type } = require("@google/genai");
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_KEY = process.env.GEMINI_API_KEY;

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

// Add current official Gemini pricing here if you want
// automatic cost calculation. Rates are USD per 1M tokens.
//
// Example:
// const PRICING = {
//   "gemini-3.8-flash": {
//     inputPer1M: 0,
//     outputPer1M: 0
//   }
// };

const PRICING = {};

const ai = new GoogleGenAI({
  apiKey: API_KEY,
  httpOptions: {
    apiVersion: "v1beta",
  },
});

// ============================================================================
// SAMPLE SIX-WEBSITE AGGREGATED DATA
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
      "মাঝারি থেকে ভারী মেঘাচ্ছন্ন ও বৃষ্টির সম্ভাবনা",
  },

  bmdLiveWarnings: {
    hasActiveWarning: true,
    warningType:
      "দমকা হাওয়াসহ মাঝারি বৃষ্টির সতর্কবার্তা",
    outlookSummary:
      "আগামী ২৪ থেকে ৪৮ ঘণ্টায় রাজশাহী অঞ্চলে বৃষ্টিপাত অব্যাহত থাকতে পারে।",
  },

  nlasAdvisory: {
    soilMoistureStatus: "অতিরিক্ত আর্দ্র (৮৫%)",
    regionalAdvisoryBn:
      "নিচু জমির রোপা আমন ও শীতকালীন সবজি ক্ষেতে বৃষ্টির পানি জমতে দেবেন না।",
  },

  bamisBulletin: {
    cropsCovered: [
      "রোপা আমন ধান",
      "শীতকালীন সবজি (ফুলকপি, বাঁধাকপি, টমেটো)",
      "সরিষা",
    ],

    pestRisk:
      "মেঘলা ও আর্দ্র আবহাওয়ায় ধানে বাদামী গাছফড়িং ও পাতা মোড়ানো পোকার আক্রমণ বাড়তে পারে।",

    livestockAdvice:
      "গবাদি পশু ও হাঁস-মুরগিকে বৃষ্টির ছাঁট থেকে দূরে শুকনো ঘরে রাখুন।",
  },

  ffwcFloodStatus: {
    nearestRiverBn: "পদ্মা নদী (রাজশাহী পয়েন্ট)",
    currentLevelM: 14.25,
    dangerLevelM: 18.05,
    waterTrend24hCm: "+15",

    floodStatusBn:
      "নদীর পানি বিপদসীমার নিচে থাকলেও বৃষ্টির কারণে গত ২৪ ঘণ্টায় ১৫ সেন্টিমিটার বৃদ্ধি পেয়েছে ও নিচু চরাঞ্চলে জলাবদ্ধতার ঝুঁকি রয়েছে।",
  },

  aisMonthlyAdvisory: {
    routineMonthlyTipBn:
      "খরা প্রবণ এলাকায় নিয়মিত সেচ দিন এবং চারা গজানোর পর ইউরিয়া সার উপরি প্রয়োগ ও কীটনাশক স্প্রে করুন।",

    seedbedTipBn:
      "বীজতলায় পানি জমতে দেবেন না এবং নালা পরিষ্কার রাখুন।",
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
        "Opening greeting in Bangla mentioning district and upazila.",
    },

    weatherSummary: {
      type: Type.STRING,
      description:
        "Spoken Bangla weather forecast. All numbers must be Bangla words.",
    },

    alertAndFloodStatus: {
      type: Type.STRING,
      description:
        "Spoken Bangla weather alert and river status.",
    },

    cropAndLivestockAdvisory: {
      type: Type.STRING,
      description:
        "Actionable Bangla farmer instructions adapted to the forecast.",
    },

    closing: {
      type: Type.STRING,
      description:
        "Polite Bangla closing statement.",
    },

    fullSpokenScript: {
      type: Type.STRING,
      description:
        "Complete 130 to 145 word Bangla OBD broadcast script. Start with আসসালামু আলাইকুম। All numbers and units must be written in Bangla words.",
    },

    wordCount: {
      type: Type.NUMBER,
      description:
        "Approximate whitespace-separated word count.",
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

        // Authentication, permission, and invalid-request errors
        // should not be hidden by trying other models.
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

  const outputTokens =
    usage?.[outputTokenField] ?? 0;

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
  // STEP 1: GENERATE BANGLA OBD SCRIPT
  // --------------------------------------------------------------------------

  console.log("====================================================");
  console.log(" STEP 1: GENERATING BANGLA OBD SCRIPT");
  console.log("====================================================");

  const systemInstruction = `
You are the Lead Agro-Meteorological Broadcast Editor for Bangladesh.

Analyze the supplied JSON from BMD, BMD-Live, NLAS, BAMIS, FFWC, and AIS.

IMPORTANT RULES:

1. WEATHER SAFETY HAS PRIORITY:
   If rain probability is above 50%, rainfall is significant,
   soil is very wet, or an active weather warning exists,
   do not repeat routine advice to irrigate, apply urea,
   or spray pesticides.

   Instead, advise farmers to clear drainage channels,
   prevent waterlogging, and postpone fertilizer or pesticide
   spraying until weather conditions improve.

2. Use only facts present in the supplied data.
   Do not invent warnings, measurements, river conditions,
   or crop problems.

3. Write natural, clear, spoken Bangla suitable for
   a telephone OBD broadcast.

4. Write every number, decimal, percentage, and unit
   in Bangla words.

   Do not leave Arabic numerals, English numerals,
   or symbols such as %, mm, cm, °C, or km/h
   in the spoken script.

5. The fullSpokenScript must contain approximately
   130 to 145 whitespace-separated words.

6. Start fullSpokenScript exactly with:
   "আসসালামু আলাইকুম।"

7. Mention the target district and upazila.

8. Mention relevant weather, active warning,
   river status, crop advice, and livestock advice
   when those data are present.

9. Routine AIS monthly advice must not override
   current weather warnings.

10. Return only JSON matching the provided schema.
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

      temperature: 0.2,
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
    scriptUsage.candidatesTokenCount ?? 0;

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

  console.log("\n--- GENERATED BANGLA OBD SCRIPT ---");

  console.log(
    generatedData.fullSpokenScript
  );

  console.log("-----------------------------------");

  console.log("\nSCRIPT GENERATION REPORT");

  console.log(
    `Model used      : ${activeScriptModel}`
  );

  console.log(
    `API latency     : ${scriptLatencySeconds} seconds`
  );

  console.log(
    `Word count      : ${generatedData.wordCount}`
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
    generatedData.wordCount < 130 ||
    generatedData.wordCount > 145
  ) {
    console.warn(
      `Warning: Script has ${generatedData.wordCount} words. Target: 130–145.`
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
      ).toFixed(3)} BDT)`
    );
  }

  console.log(`\nSaved: ${JSON_OUTPUT}`);
  console.log(`Saved: ${TEXT_OUTPUT}`);

  // --------------------------------------------------------------------------
  // STEP 2: GENERATE VOICE WAV
  // --------------------------------------------------------------------------

  if (!GENERATE_VOICE_WAV) {
    return;
  }

  console.log("\n====================================================");
  console.log(" STEP 2: CONVERTING SCRIPT TO AUDIO");
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

  // Mono, 16-bit PCM = 2 bytes per sample.

  // --------------------------------------------------------------------------
  // TTS TOKEN REPORT
  // --------------------------------------------------------------------------

  const ttsUsage =
    ttsResponse.usageMetadata ?? {};

  const ttsInputTokens =
    ttsUsage.promptTokenCount ?? 0;

  const ttsOutputTokens =
    ttsUsage.candidatesTokenCount ?? 0;

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
    `Audio duration  : ${audioDurationSeconds.toFixed(2)} seconds`
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
      ).toFixed(3)} BDT)`
    );
  }

  console.log(`\nAudio saved     : ${AUDIO_OUTPUT}`);

  // Open WAV automatically on Windows.
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
