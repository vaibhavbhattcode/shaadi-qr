import { db, getStorageUsage, mediaCounts } from '../db.js';
import { NotFoundError } from '../lib/errors.js';

export class EventService {
  /**
   * Fetch event details by ID.
   */
  static async getEventById(eventId) {
    const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) throw new NotFoundError('Event not found.');
    return event;
  }

  /**
   * Fetch event with usage/file type stats.
   */
  static async getEventStats(eventId) {
    const event = await this.getEventById(eventId);
    const used = await getStorageUsage(eventId);
    const counts = await mediaCounts(eventId);
    return {
      used,
      counts,
      storageLimitBytes: event.storage_limit_bytes
    };
  }
}
