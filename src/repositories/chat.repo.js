import { db } from '../db/knex.js';

export class ChatRepo {
  static async saveMessage({ role, content, contextDate }) {
    return db('chat_messages').insert({
      role,
      content,
      context_date: contextDate || null,
      created_at: db.fn.now(),
    });
  }

  static async getRecentMessages(limit = 20) {
    const rows = await db('chat_messages')
      .orderBy('created_at', 'desc')
      .limit(limit);
    return rows.reverse();
  }
}
