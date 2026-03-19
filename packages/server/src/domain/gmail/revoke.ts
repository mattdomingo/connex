import { eq } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import {
  gmailAccounts,
  emailMetadata,
  identityRecords,
  relationshipEdges,
} from "../../db/schema.js";
import { deleteGmailConnections } from "./bridge.js";

/**
 * Delete ALL Gmail-derived state for a user:
 *   - gmail_accounts row
 *   - email_metadata rows
 *   - relationship_edges rows
 *   - identity_records rows
 *   - connections rows with source='gmail' created by this user
 *
 * Order matters (FK cascade is not configured): children first.
 */
export function revokeAndPurgeGmail(db: DB, userId: number): void {
  db.transaction((tx) => {
    tx.delete(relationshipEdges)
      .where(eq(relationshipEdges.userId, userId))
      .run();
    tx.delete(identityRecords)
      .where(eq(identityRecords.userId, userId))
      .run();
    tx.delete(emailMetadata)
      .where(eq(emailMetadata.userId, userId))
      .run();
    tx.delete(gmailAccounts)
      .where(eq(gmailAccounts.userId, userId))
      .run();
    deleteGmailConnections(tx as unknown as DB, userId);
  });
}
