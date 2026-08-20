/**
 * LLM Service — Google Gemini API with structured JSON output
 *
 * Uses Gemini 2.0 Flash (free tier) with responseMimeType: "application/json"
 * and responseSchema to force guaranteed structured output.
 *
 * Graceful degradation: on ANY failure (timeout, API error, malformed response),
 * returns fallback data with llmFailed: true. Booking never breaks.
 */

const { GoogleGenerativeAI, SchemaType } = require("@google/generative-ai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let genAI = null;
let model = null;

function getModel() {
  if (!model && GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }
  return model;
}

/**
 * Check if LLM failure should be simulated (for testing graceful degradation).
 * Enabled via SIMULATE_LLM_FAILURE env var or ?simulateFailure=true query param.
 */
function shouldSimulateFailure(req) {
  if (process.env.SIMULATE_LLM_FAILURE === "true") return true;
  if (process.env.NODE_ENV !== "production" && req?.query?.simulateFailure === "true") return true;
  return false;
}

/**
 * Pre-visit symptom analysis.
 * Returns structured JSON: { urgency, chiefComplaint, suggestedQuestions, llmFailed }
 */
async function analyzeSymptoms(symptoms, req) {
  // Simulate failure for testing
  if (shouldSimulateFailure(req)) {
    console.log("[LLM] Simulating failure for testing");
    return {
      urgency: null,
      chiefComplaint: symptoms,
      suggestedQuestions: [],
      llmFailed: true,
    };
  }

  try {
    const ai = getModel();
    if (!ai) {
      console.warn("[LLM] No GEMINI_API_KEY configured, using fallback");
      return {
        urgency: null,
        chiefComplaint: symptoms,
        suggestedQuestions: [],
        llmFailed: true,
      };
    }

    const result = await ai.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptoms}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            urgency: {
              type: SchemaType.STRING,
              enum: ["Low", "Medium", "High"],
              description: "Urgency level based on symptom severity",
            },
            chiefComplaint: {
              type: SchemaType.STRING,
              description: "Brief summary of the chief complaint",
            },
            suggestedQuestions: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
              description: "Three suggested questions for the doctor",
            },
          },
          required: ["urgency", "chiefComplaint", "suggestedQuestions"],
        },
      },
    });

    const text = result.response.text();
    const parsed = JSON.parse(text);

    return {
      urgency: parsed.urgency || null,
      chiefComplaint: parsed.chiefComplaint || symptoms,
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions)
        ? parsed.suggestedQuestions.slice(0, 3)
        : [],
      llmFailed: false,
    };
  } catch (err) {
    console.error("[LLM] Symptom analysis failed:", err.message);
    return {
      urgency: null,
      chiefComplaint: symptoms,
      suggestedQuestions: [],
      llmFailed: true,
    };
  }
}

/**
 * Post-visit clinical notes → patient-friendly summary.
 * Returns structured JSON: { patientSummary, medications, followUpSteps, llmFailed }
 */
async function generatePostVisitSummary(clinicalNotes, req) {
  if (shouldSimulateFailure(req)) {
    console.log("[LLM] Simulating failure for post-visit summary");
    return {
      patientSummary: clinicalNotes,
      medications: [],
      followUpSteps: [],
      llmFailed: true,
    };
  }

  try {
    const ai = getModel();
    if (!ai) {
      console.warn("[LLM] No GEMINI_API_KEY configured, using fallback");
      return {
        patientSummary: clinicalNotes,
        medications: [],
        followUpSteps: [],
        llmFailed: true,
      };
    }

    const result = await ai.generateContent({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${clinicalNotes}`,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            patientSummary: {
              type: SchemaType.STRING,
              description: "Patient-friendly summary of the visit",
            },
            medications: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  drug: { type: SchemaType.STRING },
                  dosage: { type: SchemaType.STRING },
                  frequency: { type: SchemaType.STRING },
                  durationDays: { type: SchemaType.INTEGER },
                },
                required: ["drug", "dosage", "frequency", "durationDays"],
              },
            },
            followUpSteps: {
              type: SchemaType.ARRAY,
              items: { type: SchemaType.STRING },
            },
          },
          required: ["patientSummary", "medications", "followUpSteps"],
        },
      },
    });

    const text = result.response.text();
    const parsed = JSON.parse(text);

    return {
      patientSummary: parsed.patientSummary || clinicalNotes,
      medications: Array.isArray(parsed.medications) ? parsed.medications : [],
      followUpSteps: Array.isArray(parsed.followUpSteps) ? parsed.followUpSteps : [],
      llmFailed: false,
    };
  } catch (err) {
    console.error("[LLM] Post-visit summary failed:", err.message);
    return {
      patientSummary: clinicalNotes,
      medications: [],
      followUpSteps: [],
      llmFailed: true,
    };
  }
}

module.exports = { analyzeSymptoms, generatePostVisitSummary };
