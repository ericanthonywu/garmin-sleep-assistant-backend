import { AiService } from '../services/ai.service.js';
import { HealthService } from '../services/health.service.js';
import { ChatRepo } from '../repositories/chat.repo.js';
import { buildMomSystemPrompt, buildHealthContext } from '../utils/mom-persona.js';
import { analyzeWeekPattern } from '../utils/sleep-analyzer.js';
import { todayStr } from '../utils/date.js';

export class ChatController {
  static async chat(req, res, next) {
    try {
      const { message, date } = req.body;
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ success: false, error: { message: 'Message is required' } });
      }

      const targetDate = date || todayStr();

      // Gather current health context
      const dashData = await HealthService.getDashboardData(targetDate);
      const weeklyData = await HealthService.getWeeklySleep(targetDate);
      const weekPattern = analyzeWeekPattern(weeklyData);
      const healthContext = buildHealthContext({
        ...dashData,
        weekSummary: weekPattern.summary,
      });

      // Fetch recent conversation history
      const history = await ChatRepo.getRecentMessages(14);

      // Save user message to database
      await ChatRepo.saveMessage({
        role: 'user',
        content: message,
        contextDate: targetDate,
      });

      // Setup Server-Sent Events headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      let fullResponse = '';

      try {
        const stream = AiService.streamMomResponse(
          buildMomSystemPrompt(),
          healthContext,
          history,
          message
        );

        for await (const chunk of stream) {
          fullResponse += chunk;
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
      } catch (streamErr) {
        console.error('[ChatController] Streaming error:', streamErr);
        const diagnosis = AiService.diagnoseError(streamErr);
        res.write(`data: ${JSON.stringify({ error: diagnosis })}\n\n`);
      }

      // Persist complete Mom reply
      if (fullResponse) {
        await ChatRepo.saveMessage({
          role: 'mom',
          content: fullResponse,
          contextDate: targetDate,
        });
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      next(err);
    }
  }

  static async getHistory(req, res, next) {
    try {
      const limit = parseInt(req.query.limit || '50', 10);
      const messages = await ChatRepo.getRecentMessages(limit);
      res.json({
        success: true,
        data: messages,
      });
    } catch (err) {
      next(err);
    }
  }
}
