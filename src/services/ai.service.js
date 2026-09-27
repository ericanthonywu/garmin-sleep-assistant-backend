import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

let genAI = null;

function getClient() {
  if (!genAI && env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }
  return genAI;
}

export class AiService {
  /**
   * Stream a response from Mom AI using Gemini Flash.
   * Yields text chunks as they arrive for Server-Sent Events (SSE).
   *
   * @param {string} systemPrompt
   * @param {string} healthContext
   * @param {Array<{ role: 'user'|'mom', content: string }>} chatHistory
   * @param {string} userMessage
   * @returns {AsyncGenerator<string>}
   */
  static async *streamMomResponse(systemPrompt, healthContext, chatHistory, userMessage) {
    const client = getClient();
    if (!client) {
      yield "I don't have an active connection right now. Please check your API key in settings.";
      return;
    }

    // gemini-1.5-flash / gemini-2.0-flash
    const model = client.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature: 0.85,
        topP: 0.92,
        maxOutputTokens: 1024,
      },
    });

    const history = [
      {
        role: 'user',
        parts: [{ text: `Here is my current health background context for reference:\n${healthContext}` }],
      },
      {
        role: 'model',
        parts: [{ text: 'Understood, I have your health context. I will act as your Personal Health & Sleep Assistant, helping you optimize recovery, sleep, and performance.' }],
      },
      ...(chatHistory || []).slice(-14).map((m) => ({
        role: m.role === 'mom' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ];

    const chat = model.startChat({ history });
    const result = await chat.sendMessageStream(userMessage);

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        yield chunkText;
      }
    }
  }

  /**
   * Non-streaming generation for morning report cron.
   *
   * @param {string} systemPrompt
   * @param {string} healthContext
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  static async generateMomReport(systemPrompt, healthContext, prompt) {
    const client = getClient();
    if (!client) {
      return "Good morning! Don't forget to sync your Garmin device so we can analyze your sleep and recovery metrics.";
    }

    const model = client.getGenerativeModel({
      model: 'gemini-1.5-flash',
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
  }
}
