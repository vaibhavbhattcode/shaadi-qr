import { db, nowIso } from '../db.js';
import { deleteMediaFileAndRow } from '../lib/storage.js';
import { NotFoundError } from '../lib/errors.js';

export class MediaService {
  /**
   * Get media row by ID and event ID.
   */
  static async getMediaById(mediaId, eventId) {
    const media = await db.prepare('SELECT * FROM media WHERE id = ? AND event_id = ?').get(mediaId, eventId);
    if (!media) throw new NotFoundError('Media not found.');
    return media;
  }

  /**
   * Approve a media item.
   */
  static async approveMedia(mediaId, eventId) {
    const media = await this.getMediaById(mediaId, eventId);
    await db.prepare("UPDATE media SET status = 'approved', approved_at = ?, rejected_at = NULL WHERE id = ? AND event_id = ?")
      .run(nowIso(), media.id, eventId);
    return media;
  }

  /**
   * Reject a media item.
   */
  static async rejectMedia(mediaId, eventId) {
    const media = await this.getMediaById(mediaId, eventId);
    await db.prepare("UPDATE media SET status = 'rejected', rejected_at = ?, approved_at = NULL WHERE id = ? AND event_id = ?")
      .run(nowIso(), media.id, eventId);
    return media;
  }

  /**
   * Delete a media item (removes file from storage and row from database).
   */
  static async deleteMedia(mediaId, eventId, actorUserId = null, req = null) {
    const media = await this.getMediaById(mediaId, eventId);
    await deleteMediaFileAndRow(media, actorUserId, req);
    return media;
  }

  /**
   * Bulk action (approve, reject, or delete) on multiple media IDs.
   */
  static async bulkAction(mediaIds, action, eventId, actorUserId = null, req = null) {
    if (!['approve', 'reject', 'delete'].includes(action)) {
      throw new Error('Invalid bulk action.');
    }

    const ids = Array.isArray(mediaIds) ? mediaIds : mediaIds ? [mediaIds] : [];
    if (ids.length === 0) return 0;

    let processedCount = 0;
    // Process up to 300 items at a time
    for (const id of ids.slice(0, 300)) {
      try {
        const media = await db.prepare('SELECT * FROM media WHERE id = ? AND event_id = ?').get(id, eventId);
        if (!media) continue;

        if (action === 'delete') {
          await deleteMediaFileAndRow(media, actorUserId, req);
        } else if (action === 'approve') {
          await db.prepare("UPDATE media SET status = 'approved', approved_at = ?, rejected_at = NULL WHERE id = ? AND event_id = ?")
            .run(nowIso(), id, eventId);
        } else if (action === 'reject') {
          await db.prepare("UPDATE media SET status = 'rejected', rejected_at = ?, approved_at = NULL WHERE id = ? AND event_id = ?")
            .run(nowIso(), id, eventId);
        }
        processedCount++;
      } catch (err) {
        console.error(`Failed to process bulk action ${action} for media ID ${id}:`, err);
      }
    }
    return processedCount;
  }
}
