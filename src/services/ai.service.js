import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

let genAI = null;

function getClient() {
  if (!genAI && env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }
  return genAI;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AiService {
  /**
   * Diagnostic helper to determine if an error requires user action (e.g. rotating API key)
   * or is a transient network issue.
   */
  static diagnoseError(err) {
    const msg = (err?.message || '').toLowerCase();
    const status = err?.status || err?.code;

    if (
      status === 400 ||
      status === 403 ||
      msg.includes('api_key_invalid') ||
      msg.includes('api key not valid') ||
      msg.includes('permission_denied')
    ) {
      return '⚠️ Action Required: Your GEMINI_API_KEY appears invalid or unauthorized. Please verify or rotate your GEMINI_API_KEY in the backend .env configuration.';
    }

    if (
      status === 429 ||
      msg.includes('resource_exhausted') ||
      msg.includes('quota')
    ) {
      return '⚠️ Quota Reached: Daily free tier quota exhausted for this Gemini API key. Please rotate to a new GEMINI_API_KEY from Google AI Studio or try again later.';
    }

    if (status === 404 || msg.includes('not found')) {
      return `⚠️ Model Configuration: The selected model is not available. System is falling back to standard models. (${err?.message})`;
    }

    return `⚠️ AI Service Interruption: ${err?.message || 'Unable to connect to Google Gemini service.'}`;
  }

  /**
   * Stream a response from Assistant AI using Gemini with automatic retries and model fallbacks.
   * Yields text chunks as they arrive for Server-Sent Events (SSE).
   */
  static async *streamMomResponse(systemPrompt, healthContext, chatHistory, userMessage) {
    const client = getClient();
    if (!client) {
      yield '⚠️ Action Required: GEMINI_API_KEY is not configured in backend .env. Please set a valid Gemini API key to activate AI health insights.';
      return;
    }

    const history = [
      {
        role: 'user',
        parts: [{ text: `Here is my current health background context for reference:\n${healthContext}` }],
      },
      {
        role: 'model',
        parts: [{ text: 'Understood, I have your health context. I will act as your Personal Health & Sleep Assistant, analyzing both your sleep timing and sleep quality with scientific precision.' }],
      },
      ...(chatHistory || []).slice(-14).map((m) => ({
        role: m.role === 'mom' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ];

    const candidateModels = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
    ];
    let lastError = null;

    // Retry loop with model fallback and exponential backoff
    for (const modelName of candidateModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const model = client.getGenerativeModel({
            model: modelName,
            systemInstruction: systemPrompt,
            generationConfig: {
              temperature: 0.85,
              topP: 0.92,
              maxOutputTokens: 1024,
            },
          });

          const chat = model.startChat({ history });
          const result = await chat.sendMessageStream(userMessage);

          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              yield chunkText;
            }
          }
          return; // Successful stream completion
        } catch (err) {
          lastError = err;
          console.warn(`[AiService] Attempt ${attempt} on ${modelName} failed:`, err.message);

          const isAuthOrQuota =
            err.status === 400 ||
            err.status === 403 ||
            (err.message && (err.message.includes('API_KEY_INVALID') || err.message.includes('RESOURCE_EXHAUSTED')));

          if (isAuthOrQuota) {
            yield AiService.diagnoseError(err);
            return;
          }

          if (attempt < 2) {
            await delay(1200 * attempt);
          }
        }
      }
    }

    // If all retries failed, yield diagnosed actionable error
    yield AiService.diagnoseError(lastError);
  }

  /**
   * Non-streaming generation for morning report cron.
   */
  static async generateMomReport(systemPrompt, healthContext, prompt) {
    const client = getClient();
    if (!client) {
      return "Good morning! Don't forget to sync your Garmin device so we can analyze your sleep and recovery metrics.";
    }

    const candidateModels = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-flash-latest',
    ];

    for (const modelName of candidateModels) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const model = client.getGenerativeModel({
            model: modelName,
            systemInstruction: systemPrompt,
            generationConfig: {
              temperature: 0.8,
              maxOutputTokens: 512,
            },
          });

          const contents = [
            {
              role: 'user',
              parts: [
                { text: `Here is the user's health context for today:\n${healthContext}\n\nTask: ${prompt}` },
              ],
            },
          ];

          const response = await model.generateContent({ contents });
          return response.response.text();
        } catch (err) {
          console.warn(`[AiService] generateMomReport attempt ${attempt} on ${modelName} failed:`, err.message);
          if (attempt < 2) await delay(1000 * attempt);
        }
      }
    }

    return "Good morning! Here is your daily summary: check your bedtime consistency, deep sleep percentage, and resting heart rate nadir on your dashboard.";
  }
}
