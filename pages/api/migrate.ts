import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

function resolveClient() {
  const url = process.env.LIBURL_URL;
  const authToken = process.env.LIBURL_AUTH_TOKEN;
  if (!url) {
    throw new Error('LIBURL_URL environment variable is not set.');
  }
  return createClient({ url, authToken });
}

// Run a statement, ignoring errors that indicate the object already exists
// or the column already exists (libsql/SQLite safe-alter pattern).
async function exec(db: ReturnType<typeof createClient>, sql: string) {
  await db.execute(sql);
}

// ALTER TABLE ADD COLUMN IF NOT EXISTS is supported in SQLite 3.35+ / libsql,
// but we wrap it anyway so a duplicate-column error doesn't abort the whole run.
async function addColumnIfMissing(
  db: ReturnType<typeof createClient>,
  table: string,
  column: string,
  definition: string,
) {
  try {
    await db.execute(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  } catch {
    // Column already exists – ignore.
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let db: ReturnType<typeof createClient>;
  try {
    db = resolveClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: message });
  }

  const wantsHtml =
    String(req.query.format || '').toLowerCase() !== 'json' &&
    String(req.headers.accept || '').includes('text/html');

  try {
    // ─── User ───────────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "User" (
        "id"                          TEXT PRIMARY KEY,
        "email"                       TEXT UNIQUE NOT NULL,
        "password"                    TEXT NOT NULL,
        "name"                        TEXT,
        "profileImageUrl"             TEXT,
        "createdAt"                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "themeMode"                   TEXT NOT NULL DEFAULT 'dark',
        "themeCustomEnabled"          INTEGER NOT NULL DEFAULT 0,
        "themeAccent"                 TEXT,
        "themeAccentSecondary"        TEXT,
        "themeSuccess"                TEXT,
        "themeError"                  TEXT,
        "themeWarning"                TEXT,
        "themeUnattempted"            TEXT,
        "themeNavBgColor"             TEXT,
        "themeNavGifUrl"              TEXT,
        "themeHomeBgGifUrl"           TEXT,
        "themeHomeBgPositionX"        INTEGER,
        "themeHomeBgPositionY"        INTEGER,
        "themeAiChatsBgGifUrl"        TEXT,
        "themeAiChatsBgPositionX"     INTEGER,
        "themeAiChatsBgPositionY"     INTEGER,
        "themePyqBgGifUrl"            TEXT,
        "themePyqBgPositionX"         INTEGER,
        "themePyqBgPositionY"         INTEGER,
        "themeForumBgGifUrl"          TEXT,
        "themeForumBgPositionX"       INTEGER,
        "themeForumBgPositionY"       INTEGER,
        "themeTestCardBgGifUrl"       TEXT,
        "themeTestCardBgPositionX"    INTEGER,
        "themeTestCardBgPositionY"    INTEGER,
        "twoFactorEnabled"            INTEGER NOT NULL DEFAULT 0,
        "twoFactorCodeHash"           TEXT,
        "twoFactorCodeExpiresAt"      TEXT,
        "twoFactorCodeRequestedAt"    TEXT,
        "passwordResetCodeHash"       TEXT,
        "passwordResetCodeExpiresAt"  TEXT,
        "passwordResetCodeRequestedAt" TEXT,
        "lastIpAddress"               TEXT,
        "canUseAiSolutions"           INTEGER NOT NULL DEFAULT 0,
        "canAccessAiChatRoom"         INTEGER NOT NULL DEFAULT 0,
        "canUseGuestSync"             INTEGER NOT NULL DEFAULT 0,
        "isOwner"                     INTEGER NOT NULL DEFAULT 0,
        "zoneWorkspace"               TEXT,
        "dashboardBrandName"          TEXT,
        "dashboardBrandColor"         TEXT,
        "chatFavoriteGifs"            TEXT,
        "leagueUnranked"              INTEGER NOT NULL DEFAULT 0,
        "leagueUnrankedUpdatedAt"     TEXT,
        "chatPrivacy"                 TEXT NOT NULL DEFAULT 'everyone'
      )
    `);

    // Additive columns for User (safe on existing DBs)
    await addColumnIfMissing(db, 'User', 'lastIpAddress', 'TEXT');
    await addColumnIfMissing(db, 'User', 'canUseAiSolutions', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'User', 'canAccessAiChatRoom', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'User', 'canUseGuestSync', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'User', 'themeMode', "TEXT NOT NULL DEFAULT 'dark'");
    await addColumnIfMissing(db, 'User', 'themeCustomEnabled', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'User', 'themeAccent', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeAccentSecondary', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeSuccess', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeError', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeWarning', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeUnattempted', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeNavBgColor', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeNavGifUrl', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeHomeBgGifUrl', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeHomeBgPositionX', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themeHomeBgPositionY', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themeAiChatsBgGifUrl', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeAiChatsBgPositionX', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themeAiChatsBgPositionY', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themePyqBgGifUrl', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themePyqBgPositionX', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themePyqBgPositionY', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themeForumBgGifUrl', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeForumBgPositionX', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themeForumBgPositionY', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themeTestCardBgGifUrl', 'TEXT');
    await addColumnIfMissing(db, 'User', 'themeTestCardBgPositionX', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'themeTestCardBgPositionY', 'INTEGER');
    await addColumnIfMissing(db, 'User', 'twoFactorEnabled', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'User', 'twoFactorCodeHash', 'TEXT');
    await addColumnIfMissing(db, 'User', 'twoFactorCodeExpiresAt', 'TEXT');
    await addColumnIfMissing(db, 'User', 'twoFactorCodeRequestedAt', 'TEXT');
    await addColumnIfMissing(db, 'User', 'passwordResetCodeHash', 'TEXT');
    await addColumnIfMissing(db, 'User', 'passwordResetCodeExpiresAt', 'TEXT');
    await addColumnIfMissing(db, 'User', 'passwordResetCodeRequestedAt', 'TEXT');
    await addColumnIfMissing(db, 'User', 'isOwner', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'User', 'zoneWorkspace', 'TEXT');
    await addColumnIfMissing(db, 'User', 'profileImageUrl', 'TEXT');
    await addColumnIfMissing(db, 'User', 'dashboardBrandName', 'TEXT');
    await addColumnIfMissing(db, 'User', 'dashboardBrandColor', 'TEXT');
    await addColumnIfMissing(db, 'User', 'chatFavoriteGifs', 'TEXT');
    await addColumnIfMissing(db, 'User', 'leagueUnranked', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'User', 'leagueUnrankedUpdatedAt', 'TEXT');
    await addColumnIfMissing(db, 'User', 'chatPrivacy', "TEXT NOT NULL DEFAULT 'everyone'");

    // ─── UserActionHistory ───────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "UserActionHistory" (
        "id"          TEXT PRIMARY KEY,
        "userId"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "actionType"  TEXT NOT NULL,
        "title"       TEXT NOT NULL,
        "description" TEXT,
        "metadata"    TEXT,
        "createdAt"   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "UserActionHistory_userId_createdAt_idx" ON "UserActionHistory"("userId", "createdAt")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "UserActionHistory_actionType_idx" ON "UserActionHistory"("actionType")`);

    // ─── Session ─────────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "Session" (
        "id"        TEXT PRIMARY KEY,
        "token"     TEXT UNIQUE NOT NULL,
        "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "expiresAt" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId")`);

    // ─── AiChatPersonalityConfig ─────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "AiChatPersonalityConfig" (
        "id"              TEXT PRIMARY KEY,
        "key"             TEXT UNIQUE NOT NULL,
        "label"           TEXT NOT NULL,
        "description"     TEXT NOT NULL,
        "promptHint"      TEXT NOT NULL,
        "systemPrompt"    TEXT,
        "avatarUrl"       TEXT,
        "isGated"         INTEGER NOT NULL DEFAULT 0,
        "isDefault"       INTEGER NOT NULL DEFAULT 0,
        "createdByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "createdAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await addColumnIfMissing(db, 'AiChatPersonalityConfig', 'systemPrompt', 'TEXT');
    await addColumnIfMissing(db, 'AiChatPersonalityConfig', 'avatarUrl', 'TEXT');
    await addColumnIfMissing(db, 'AiChatPersonalityConfig', 'isGated', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'AiChatPersonalityConfig', 'isDefault', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'AiChatPersonalityConfig', 'createdByUserId', 'TEXT');
    await exec(db, `CREATE UNIQUE INDEX IF NOT EXISTS "AiChatPersonalityConfig_key_idx" ON "AiChatPersonalityConfig"("key")`);

    // ─── AiChatSession ───────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "AiChatSession" (
        "id"            TEXT PRIMARY KEY,
        "userId"        TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "title"         TEXT NOT NULL,
        "modelId"       TEXT NOT NULL,
        "personalityId" TEXT NOT NULL,
        "createdAt"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await addColumnIfMissing(db, 'AiChatSession', 'title', 'TEXT');
    await addColumnIfMissing(db, 'AiChatSession', 'modelId', 'TEXT');
    await addColumnIfMissing(db, 'AiChatSession', 'personalityId', 'TEXT');
    await exec(db, `CREATE INDEX IF NOT EXISTS "AiChatSession_userId_idx" ON "AiChatSession"("userId")`);

    // ─── AiChatMessage ───────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "AiChatMessage" (
        "id"        TEXT PRIMARY KEY,
        "sessionId" TEXT NOT NULL REFERENCES "AiChatSession"("id") ON DELETE CASCADE,
        "role"      TEXT NOT NULL,
        "content"   TEXT NOT NULL,
        "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await addColumnIfMissing(db, 'AiChatMessage', 'role', 'TEXT');
    await addColumnIfMissing(db, 'AiChatMessage', 'content', 'TEXT');
    await exec(db, `CREATE INDEX IF NOT EXISTS "AiChatMessage_sessionId_idx" ON "AiChatMessage"("sessionId")`);

    // ─── ChatMessage ─────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ChatMessage" (
        "id"                  TEXT PRIMARY KEY,
        "userId"              TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "userName"            TEXT NOT NULL,
        "userProfileImage"    TEXT,
        "content"             TEXT NOT NULL,
        "attachmentUrl"       TEXT,
        "attachmentType"      TEXT,
        "attachmentSize"      INTEGER,
        "forwardedQuestionId" TEXT,
        "replyToMessageId"    TEXT REFERENCES "ChatMessage"("id") ON DELETE SET NULL,
        "chatType"            TEXT NOT NULL DEFAULT 'global',
        "recipientId"         TEXT REFERENCES "User"("id") ON DELETE CASCADE,
        "groupId"             TEXT,
        "isPinned"            INTEGER NOT NULL DEFAULT 0,
        "editedAt"            TEXT,
        "isDeleted"           INTEGER NOT NULL DEFAULT 0,
        "createdAt"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await addColumnIfMissing(db, 'ChatMessage', 'chatType', "TEXT NOT NULL DEFAULT 'global'");
    await addColumnIfMissing(db, 'ChatMessage', 'editedAt', 'TEXT');
    await addColumnIfMissing(db, 'ChatMessage', 'recipientId', 'TEXT');
    await addColumnIfMissing(db, 'ChatMessage', 'groupId', 'TEXT');
    await addColumnIfMissing(db, 'ChatMessage', 'replyToMessageId', 'TEXT');
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatMessage_userId_idx" ON "ChatMessage"("userId")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatMessage_recipientId_createdAt_idx" ON "ChatMessage"("recipientId", "createdAt")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatMessage_groupId_createdAt_idx" ON "ChatMessage"("groupId", "createdAt")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatMessage_chatType_createdAt_idx" ON "ChatMessage"("chatType", "createdAt")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatMessage_replyToMessageId_idx" ON "ChatMessage"("replyToMessageId")`);

    // ─── ChatGroup ───────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ChatGroup" (
        "id"              TEXT PRIMARY KEY,
        "name"            TEXT NOT NULL,
        "profileImageUrl" TEXT,
        "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "createdAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatGroup_createdByUserId_idx" ON "ChatGroup"("createdByUserId")`);

    // ─── ChatGroupMember ─────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ChatGroupMember" (
        "id"        TEXT PRIMARY KEY,
        "groupId"   TEXT NOT NULL REFERENCES "ChatGroup"("id") ON DELETE CASCADE,
        "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("groupId", "userId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatGroupMember_userId_idx" ON "ChatGroupMember"("userId")`);

    // ─── ChatMention ─────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ChatMention" (
        "id"              TEXT PRIMARY KEY,
        "messageId"       TEXT NOT NULL REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
        "mentionedUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "createdAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("messageId", "mentionedUserId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatMention_mentionedUserId_idx" ON "ChatMention"("mentionedUserId")`);

    // ─── ChatReaction ────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ChatReaction" (
        "id"        TEXT PRIMARY KEY,
        "messageId" TEXT NOT NULL REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
        "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "emoji"     TEXT NOT NULL,
        "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("messageId", "userId", "emoji")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatReaction_messageId_idx" ON "ChatReaction"("messageId")`);

    // ─── ChatMessageRead ─────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ChatMessageRead" (
        "id"        TEXT PRIMARY KEY,
        "messageId" TEXT NOT NULL REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
        "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "readAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("messageId", "userId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ChatMessageRead_userId_idx" ON "ChatMessageRead"("userId")`);

    // ─── Announcement ────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "Announcement" (
        "id"              TEXT PRIMARY KEY,
        "title"           TEXT NOT NULL,
        "content"         TEXT NOT NULL,
        "createdByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "createdAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);

    // ─── AnnouncementRead ────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "AnnouncementRead" (
        "id"             TEXT PRIMARY KEY,
        "announcementId" TEXT NOT NULL REFERENCES "Announcement"("id") ON DELETE CASCADE,
        "userId"         TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "readAt"         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("announcementId", "userId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "AnnouncementRead_userId_idx" ON "AnnouncementRead"("userId")`);

    // ─── FriendRequest ───────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "FriendRequest" (
        "id"         TEXT PRIMARY KEY,
        "senderId"   TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "receiverId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "status"     TEXT NOT NULL DEFAULT 'pending',
        "createdAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("senderId", "receiverId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "FriendRequest_receiverId_status_idx" ON "FriendRequest"("receiverId", "status")`);

    // ─── UserBlock ───────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "UserBlock" (
        "id"        TEXT PRIMARY KEY,
        "blockerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "blockedId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("blockerId", "blockedId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "UserBlock_blockerId_idx" ON "UserBlock"("blockerId")`);

    // ─── UserLeagueProfile ───────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "UserLeagueProfile" (
        "id"                 TEXT PRIMARY KEY,
        "userId"             TEXT UNIQUE NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "totalExp"           INTEGER NOT NULL DEFAULT 0,
        "league"             TEXT,
        "stage"              INTEGER,
        "streakCount"        INTEGER NOT NULL DEFAULT 0,
        "streakBonus"        INTEGER NOT NULL DEFAULT 0,
        "lastPyqQualifiedAt" TEXT,
        "createdAt"          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await addColumnIfMissing(db, 'UserLeagueProfile', 'totalExp', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'UserLeagueProfile', 'league', 'TEXT');
    await addColumnIfMissing(db, 'UserLeagueProfile', 'stage', 'INTEGER');
    await addColumnIfMissing(db, 'UserLeagueProfile', 'streakCount', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'UserLeagueProfile', 'streakBonus', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'UserLeagueProfile', 'lastPyqQualifiedAt', 'TEXT');

    // ─── UserExpEvent ────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "UserExpEvent" (
        "id"        TEXT PRIMARY KEY,
        "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "type"      TEXT NOT NULL,
        "sourceId"  TEXT NOT NULL,
        "exp"       INTEGER NOT NULL,
        "metadata"  TEXT,
        "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("userId", "type", "sourceId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "UserExpEvent_userId_idx" ON "UserExpEvent"("userId")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "UserExpEvent_userId_type_idx" ON "UserExpEvent"("userId", "type")`);

    // ─── UserIpLog ───────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "UserIpLog" (
        "id"          TEXT PRIMARY KEY,
        "userId"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "ip"          TEXT NOT NULL,
        "firstSeenAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "lastSeenAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("userId", "ip")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "UserIpLog_userId_idx" ON "UserIpLog"("userId")`);

    // ─── DeletedAccount ──────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "DeletedAccount" (
        "id"           TEXT PRIMARY KEY,
        "email"        TEXT NOT NULL,
        "name"         TEXT,
        "enrollmentNo" TEXT,
        "ips"          TEXT,
        "deletedAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);

    // ─── Z7iAccount ──────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "Z7iAccount" (
        "id"                TEXT PRIMARY KEY,
        "userId"            TEXT UNIQUE NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "enrollmentNo"      TEXT NOT NULL,
        "encryptedPassword" TEXT NOT NULL,
        "firstName"         TEXT,
        "isGuest"           INTEGER NOT NULL DEFAULT 0,
        "lastSyncAt"        TEXT,
        "syncStatus"        TEXT NOT NULL DEFAULT 'pending',
        "createdAt"         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await addColumnIfMissing(db, 'Z7iAccount', 'firstName', 'TEXT');
    await addColumnIfMissing(db, 'Z7iAccount', 'isGuest', 'INTEGER NOT NULL DEFAULT 0');

    // ─── Package ─────────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "Package" (
        "id"           TEXT PRIMARY KEY,
        "z7iId"        TEXT NOT NULL,
        "z7iAccountId" TEXT NOT NULL REFERENCES "Z7iAccount"("id") ON DELETE CASCADE,
        "name"         TEXT NOT NULL,
        "description"  TEXT,
        "expiryDate"   TEXT,
        "createdAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("z7iId", "z7iAccountId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "Package_z7iAccountId_idx" ON "Package"("z7iAccountId")`);

    // ─── Test ────────────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "Test" (
        "id"             TEXT PRIMARY KEY,
        "z7iId"          TEXT NOT NULL,
        "packageId"      TEXT NOT NULL REFERENCES "Package"("id") ON DELETE CASCADE,
        "name"           TEXT NOT NULL,
        "description"    TEXT,
        "testType"       TEXT,
        "timeLimit"      INTEGER,
        "maxScore"       INTEGER,
        "totalQuestions" INTEGER,
        "startDate"      TEXT,
        "endDate"        TEXT,
        "subjects"       TEXT,
        "createdAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("z7iId", "packageId")
      )
    `);
    await addColumnIfMissing(db, 'Test', 'z7iTestId', 'TEXT');
    await exec(db, `CREATE INDEX IF NOT EXISTS "Test_packageId_idx" ON "Test"("packageId")`);

    // ─── TestAttempt ─────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "TestAttempt" (
        "id"           TEXT PRIMARY KEY,
        "z7iId"        TEXT NOT NULL,
        "z7iAccountId" TEXT NOT NULL REFERENCES "Z7iAccount"("id") ON DELETE CASCADE,
        "testId"       TEXT NOT NULL REFERENCES "Test"("id") ON DELETE CASCADE,
        "timeTaken"    REAL,
        "submitDate"   TEXT,
        "correct"      INTEGER NOT NULL DEFAULT 0,
        "incorrect"    INTEGER NOT NULL DEFAULT 0,
        "unattempted"  INTEGER NOT NULL DEFAULT 0,
        "totalScore"   REAL NOT NULL DEFAULT 0,
        "maxScore"     INTEGER,
        "rank"         INTEGER,
        "percentile"   REAL,
        "bonusMarks"   REAL,
        "createdAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("z7iId", "z7iAccountId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "TestAttempt_z7iAccountId_idx" ON "TestAttempt"("z7iAccountId")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "TestAttempt_testId_idx" ON "TestAttempt"("testId")`);

    // ─── QuestionResponse ────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "QuestionResponse" (
        "id"              TEXT PRIMARY KEY,
        "z7iQuestionId"   TEXT NOT NULL,
        "attemptId"       TEXT NOT NULL REFERENCES "TestAttempt"("id") ON DELETE CASCADE,
        "questionOrder"   INTEGER NOT NULL,
        "subjectId"       TEXT,
        "subjectName"     TEXT,
        "questionType"    TEXT NOT NULL,
        "questionHtml"    TEXT NOT NULL,
        "option1"         TEXT,
        "option2"         TEXT,
        "option3"         TEXT,
        "option4"         TEXT,
        "correctAnswer"   TEXT NOT NULL,
        "studentAnswer"   TEXT,
        "answerStatus"    TEXT NOT NULL,
        "marksPositive"   REAL NOT NULL DEFAULT 4,
        "marksNegative"   REAL NOT NULL DEFAULT 1,
        "scoreObtained"   REAL NOT NULL DEFAULT 0,
        "timeTaken"       INTEGER,
        "avgTimeTaken"    INTEGER,
        "percentCorrect"  REAL,
        "solutionHtml"    TEXT,
        "aiSolutionHtml"  TEXT,
        "aiGeneratedAt"   TEXT,
        "createdAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("z7iQuestionId", "attemptId")
      )
    `);
    await addColumnIfMissing(db, 'QuestionResponse', 'avgTimeTaken', 'INTEGER');
    await addColumnIfMissing(db, 'QuestionResponse', 'percentCorrect', 'REAL');
    await addColumnIfMissing(db, 'QuestionResponse', 'aiSolutionHtml', 'TEXT');
    await addColumnIfMissing(db, 'QuestionResponse', 'aiGeneratedAt', 'TEXT');
    await exec(db, `CREATE INDEX IF NOT EXISTS "QuestionResponse_attemptId_idx" ON "QuestionResponse"("attemptId")`);

    // ─── QuestionBookmark ────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "QuestionBookmark" (
        "id"         TEXT PRIMARY KEY,
        "userId"     TEXT NOT NULL,
        "questionId" TEXT NOT NULL REFERENCES "QuestionResponse"("id") ON DELETE CASCADE,
        "createdAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("userId", "questionId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "QuestionBookmark_userId_idx" ON "QuestionBookmark"("userId")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "QuestionBookmark_questionId_idx" ON "QuestionBookmark"("questionId")`);

    // ─── QuestionNote ────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "QuestionNote" (
        "id"         TEXT PRIMARY KEY,
        "userId"     TEXT NOT NULL,
        "questionId" TEXT NOT NULL REFERENCES "QuestionResponse"("id") ON DELETE CASCADE,
        "content"    TEXT NOT NULL,
        "createdAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("userId", "questionId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "QuestionNote_userId_idx" ON "QuestionNote"("userId")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "QuestionNote_questionId_idx" ON "QuestionNote"("questionId")`);

    // ─── QuestionComment ─────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "QuestionComment" (
        "id"         TEXT PRIMARY KEY,
        "userId"     TEXT NOT NULL,
        "userName"   TEXT,
        "questionId" TEXT NOT NULL REFERENCES "QuestionResponse"("id") ON DELETE CASCADE,
        "content"    TEXT NOT NULL,
        "createdAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "QuestionComment_questionId_idx" ON "QuestionComment"("questionId")`);

    // ─── BonusQuestion ───────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "BonusQuestion" (
        "id"            TEXT PRIMARY KEY,
        "z7iQuestionId" TEXT UNIQUE NOT NULL,
        "testZ7iId"     TEXT NOT NULL,
        "reason"        TEXT,
        "markedBy"      TEXT NOT NULL,
        "markedByName"  TEXT,
        "createdAt"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "BonusQuestion_testZ7iId_idx" ON "BonusQuestion"("testZ7iId")`);

    // ─── AnswerKeyChange ─────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "AnswerKeyChange" (
        "id"             TEXT PRIMARY KEY,
        "z7iQuestionId"  TEXT UNIQUE NOT NULL,
        "testZ7iId"      TEXT NOT NULL,
        "originalAnswer" TEXT NOT NULL,
        "newAnswer"      TEXT NOT NULL,
        "reason"         TEXT,
        "changedBy"      TEXT NOT NULL,
        "changedByName"  TEXT,
        "createdAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "AnswerKeyChange_testZ7iId_idx" ON "AnswerKeyChange"("testZ7iId")`);

    // ─── TestRevision ────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "TestRevision" (
        "id"            TEXT PRIMARY KEY,
        "userId"        TEXT NOT NULL,
        "attemptId"     TEXT NOT NULL,
        "correct"       INTEGER NOT NULL DEFAULT 0,
        "incorrect"     INTEGER NOT NULL DEFAULT 0,
        "unattempted"   INTEGER NOT NULL DEFAULT 0,
        "totalScore"    REAL NOT NULL DEFAULT 0,
        "maxScore"      INTEGER NOT NULL DEFAULT 0,
        "timeTaken"     INTEGER NOT NULL DEFAULT 0,
        "originalScore" REAL NOT NULL DEFAULT 0,
        "improvement"   REAL NOT NULL DEFAULT 0,
        "accuracy"      REAL NOT NULL DEFAULT 0,
        "createdAt"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "TestRevision_userId_idx" ON "TestRevision"("userId")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "TestRevision_attemptId_idx" ON "TestRevision"("attemptId")`);

    // ─── RevisionResponse ────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "RevisionResponse" (
        "id"            TEXT PRIMARY KEY,
        "revisionId"    TEXT NOT NULL REFERENCES "TestRevision"("id") ON DELETE CASCADE,
        "z7iQuestionId" TEXT NOT NULL,
        "questionOrder" INTEGER NOT NULL,
        "userAnswer"    TEXT,
        "correctAnswer" TEXT NOT NULL,
        "status"        TEXT NOT NULL,
        "marksObtained" REAL NOT NULL DEFAULT 0,
        "marksPositive" REAL NOT NULL DEFAULT 4,
        "marksNegative" REAL NOT NULL DEFAULT 1,
        "timeSpent"     INTEGER NOT NULL DEFAULT 0,
        "wasFlagged"    INTEGER NOT NULL DEFAULT 0,
        "createdAt"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "RevisionResponse_revisionId_idx" ON "RevisionResponse"("revisionId")`);

    // ─── ScoreAdjustment ─────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ScoreAdjustment" (
        "id"           TEXT PRIMARY KEY,
        "testZ7iId"    TEXT NOT NULL,
        "z7iAccountId" TEXT NOT NULL,
        "adjustment"   REAL NOT NULL,
        "reason"       TEXT,
        "changedBy"    TEXT NOT NULL,
        "changedByName" TEXT,
        "createdAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("testZ7iId", "z7iAccountId")
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ScoreAdjustment_testZ7iId_idx" ON "ScoreAdjustment"("testZ7iId")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ScoreAdjustment_z7iAccountId_idx" ON "ScoreAdjustment"("z7iAccountId")`);

    // ─── ForumPost ───────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ForumPost" (
        "id"             TEXT PRIMARY KEY,
        "userId"         TEXT NOT NULL,
        "userName"       TEXT NOT NULL,
        "title"          TEXT NOT NULL,
        "content"        TEXT NOT NULL,
        "attachmentName" TEXT,
        "attachmentData" TEXT,
        "questionId"     TEXT REFERENCES "QuestionResponse"("id") ON DELETE SET NULL,
        "likes"          INTEGER NOT NULL DEFAULT 0,
        "viewCount"      INTEGER NOT NULL DEFAULT 0,
        "isPinned"       INTEGER NOT NULL DEFAULT 0,
        "isResolved"     INTEGER NOT NULL DEFAULT 0,
        "createdAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await addColumnIfMissing(db, 'ForumPost', 'attachmentName', 'TEXT');
    await addColumnIfMissing(db, 'ForumPost', 'attachmentData', 'TEXT');

    // ─── ForumReply ──────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ForumReply" (
        "id"         TEXT PRIMARY KEY,
        "postId"     TEXT NOT NULL REFERENCES "ForumPost"("id") ON DELETE CASCADE,
        "userId"     TEXT NOT NULL,
        "userName"   TEXT NOT NULL,
        "content"    TEXT NOT NULL,
        "isAccepted" INTEGER NOT NULL DEFAULT 0,
        "likes"      INTEGER NOT NULL DEFAULT 0,
        "createdAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);

    // ─── ForumPostLike ───────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ForumPostLike" (
        "id"        TEXT PRIMARY KEY,
        "postId"    TEXT NOT NULL REFERENCES "ForumPost"("id") ON DELETE CASCADE,
        "userId"    TEXT NOT NULL,
        "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("postId", "userId")
      )
    `);

    // ─── ForumReplyLike ──────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ForumReplyLike" (
        "id"        TEXT PRIMARY KEY,
        "replyId"   TEXT NOT NULL REFERENCES "ForumReply"("id") ON DELETE CASCADE,
        "userId"    TEXT NOT NULL,
        "createdAt" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("replyId", "userId")
      )
    `);

    // ─── ForumMention ────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "ForumMention" (
        "id"              TEXT PRIMARY KEY,
        "postId"          TEXT NOT NULL REFERENCES "ForumPost"("id") ON DELETE CASCADE,
        "replyId"         TEXT REFERENCES "ForumReply"("id") ON DELETE CASCADE,
        "mentionedUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "mentionerUserId" TEXT NOT NULL,
        "isRead"          INTEGER NOT NULL DEFAULT 0,
        "createdAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await exec(db, `CREATE INDEX IF NOT EXISTS "ForumMention_mentionedUserId_isRead_idx" ON "ForumMention"("mentionedUserId", "isRead")`);

    // ─── PastYearPaper ───────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "PastYearPaper" (
        "id"             TEXT PRIMARY KEY,
        "examName"       TEXT NOT NULL,
        "year"           INTEGER NOT NULL,
        "session"        TEXT,
        "shift"          TEXT,
        "date"           TEXT,
        "title"          TEXT NOT NULL,
        "description"    TEXT,
        "timeLimit"      INTEGER NOT NULL,
        "maxScore"       INTEGER NOT NULL,
        "totalQuestions" INTEGER NOT NULL,
        "structure"      TEXT,
        "source"         TEXT,
        "sourceUrl"      TEXT,
        "isActive"       INTEGER NOT NULL DEFAULT 1,
        "createdAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("examName", "year", "session", "shift")
      )
    `);

    // ─── PYPQuestion ─────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "PYPQuestion" (
        "id"             TEXT PRIMARY KEY,
        "paperId"        TEXT NOT NULL REFERENCES "PastYearPaper"("id") ON DELETE CASCADE,
        "questionNumber" INTEGER NOT NULL,
        "subject"        TEXT NOT NULL,
        "type"           TEXT NOT NULL,
        "questionHtml"   TEXT NOT NULL,
        "option1"        TEXT,
        "option2"        TEXT,
        "option3"        TEXT,
        "option4"        TEXT,
        "correctAnswer"  TEXT NOT NULL,
        "solutionHtml"   TEXT,
        "marksPositive"  REAL NOT NULL DEFAULT 4,
        "marksNegative"  REAL NOT NULL DEFAULT 1,
        "difficulty"     TEXT,
        "avgTimeTaken"   INTEGER,
        "percentCorrect" REAL,
        "topics"         TEXT NOT NULL DEFAULT '[]',
        "createdAt"      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("paperId", "questionNumber")
      )
    `);

    // ─── PYPAttempt ──────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "PYPAttempt" (
        "id"                      TEXT PRIMARY KEY,
        "userId"                  TEXT NOT NULL,
        "paperId"                 TEXT NOT NULL REFERENCES "PastYearPaper"("id") ON DELETE CASCADE,
        "startedAt"               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "submittedAt"             TEXT,
        "timeTaken"               REAL,
        "correct"                 INTEGER NOT NULL DEFAULT 0,
        "incorrect"               INTEGER NOT NULL DEFAULT 0,
        "unattempted"             INTEGER NOT NULL DEFAULT 0,
        "totalScore"              REAL NOT NULL DEFAULT 0,
        "physicsScore"            REAL,
        "chemistryScore"          REAL,
        "mathsScore"              REAL,
        "answers"                 TEXT NOT NULL DEFAULT '{}',
        "topicStats"              TEXT,
        "revisionRecommendations" TEXT,
        "isCompleted"             INTEGER NOT NULL DEFAULT 0,
        "createdAt"               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("userId", "paperId", "startedAt")
      )
    `);

    // ─── PYPBookmark ─────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "PYPBookmark" (
        "id"         TEXT PRIMARY KEY,
        "userId"     TEXT NOT NULL,
        "questionId" TEXT NOT NULL REFERENCES "PYPQuestion"("id") ON DELETE CASCADE,
        "createdAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("userId", "questionId")
      )
    `);

    // ─── PYPNote ─────────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "PYPNote" (
        "id"         TEXT PRIMARY KEY,
        "userId"     TEXT NOT NULL,
        "questionId" TEXT NOT NULL REFERENCES "PYPQuestion"("id") ON DELETE CASCADE,
        "content"    TEXT NOT NULL,
        "createdAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("userId", "questionId")
      )
    `);

    // ─── PyqQuestionAttempt ──────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "PyqQuestionAttempt" (
        "id"                  TEXT PRIMARY KEY,
        "userId"              TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "questionId"          TEXT NOT NULL,
        "examId"              TEXT,
        "subjectId"           TEXT,
        "chapterId"           TEXT,
        "questionNumber"      INTEGER,
        "selectedOptionIndex" INTEGER,
        "answerLabel"         TEXT,
        "correctAnswer"       TEXT,
        "isCorrect"           INTEGER,
        "timeTaken"           INTEGER,
        "createdAt"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);
    await addColumnIfMissing(db, 'PyqQuestionAttempt', 'timeTaken', 'INTEGER');
    await exec(db, `CREATE INDEX IF NOT EXISTS "PyqQuestionAttempt_userId_questionId_idx" ON "PyqQuestionAttempt"("userId", "questionId")`);
    await exec(db, `CREATE INDEX IF NOT EXISTS "PyqQuestionAttempt_userId_createdAt_idx" ON "PyqQuestionAttempt"("userId", "createdAt")`);

    // ─── PyqQuestionState ────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "PyqQuestionState" (
        "id"           TEXT PRIMARY KEY,
        "userId"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "questionId"   TEXT NOT NULL,
        "examId"       TEXT,
        "subjectId"    TEXT,
        "chapterId"    TEXT,
        "isBookmarked" INTEGER NOT NULL DEFAULT 0,
        "note"         TEXT,
        "createdAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("userId", "questionId")
      )
    `);
    await addColumnIfMissing(db, 'PyqQuestionState', 'examId', 'TEXT');
    await addColumnIfMissing(db, 'PyqQuestionState', 'subjectId', 'TEXT');
    await addColumnIfMissing(db, 'PyqQuestionState', 'chapterId', 'TEXT');
    await addColumnIfMissing(db, 'PyqQuestionState', 'isBookmarked', 'INTEGER NOT NULL DEFAULT 0');
    await addColumnIfMissing(db, 'PyqQuestionState', 'note', 'TEXT');
    await exec(db, `CREATE INDEX IF NOT EXISTS "PyqQuestionState_userId_chapterId_idx" ON "PyqQuestionState"("userId", "chapterId")`);

    // ─── CustomTest ──────────────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "CustomTest" (
        "id"              TEXT PRIMARY KEY,
        "name"            TEXT NOT NULL,
        "prompt"          TEXT NOT NULL,
        "modelId"         TEXT NOT NULL,
        "timeLimit"       INTEGER NOT NULL,
        "totalQuestions"  INTEGER NOT NULL,
        "status"          TEXT NOT NULL DEFAULT 'ready',
        "createdByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
        "createdAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `);

    // ─── CustomTestQuestion ──────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "CustomTestQuestion" (
        "id"                  TEXT PRIMARY KEY,
        "testId"              TEXT NOT NULL REFERENCES "CustomTest"("id") ON DELETE CASCADE,
        "questionOrder"       INTEGER NOT NULL,
        "subject"             TEXT,
        "chapter"             TEXT,
        "difficulty"          TEXT,
        "questionType"        TEXT NOT NULL,
        "questionHtml"        TEXT NOT NULL,
        "option1"             TEXT,
        "option2"             TEXT,
        "option3"             TEXT,
        "option4"             TEXT,
        "correctAnswer"       TEXT NOT NULL,
        "marksPositive"       REAL NOT NULL DEFAULT 4,
        "marksNegative"       REAL NOT NULL DEFAULT 1,
        "diagramImageDataUrl" TEXT,
        "createdAt"           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("testId", "questionOrder")
      )
    `);
    await addColumnIfMissing(db, 'CustomTestQuestion', 'diagramImageDataUrl', 'TEXT');

    // ─── CustomTestAttempt ───────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "CustomTestAttempt" (
        "id"                   TEXT PRIMARY KEY,
        "testId"               TEXT NOT NULL REFERENCES "CustomTest"("id") ON DELETE CASCADE,
        "userId"               TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "status"               TEXT NOT NULL DEFAULT 'in_progress',
        "startedAt"            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "submittedAt"          TEXT,
        "timeTaken"            INTEGER,
        "currentQuestionIndex" INTEGER NOT NULL DEFAULT 0,
        "correct"              INTEGER NOT NULL DEFAULT 0,
        "incorrect"            INTEGER NOT NULL DEFAULT 0,
        "unattempted"          INTEGER NOT NULL DEFAULT 0,
        "totalScore"           REAL NOT NULL DEFAULT 0,
        "maxScore"             INTEGER,
        "accuracy"             INTEGER,
        "createdAt"            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("testId", "userId")
      )
    `);

    // ─── CustomTestResponse ──────────────────────────────────────────────────
    await exec(db, `
      CREATE TABLE IF NOT EXISTS "CustomTestResponse" (
        "id"            TEXT PRIMARY KEY,
        "attemptId"     TEXT NOT NULL REFERENCES "CustomTestAttempt"("id") ON DELETE CASCADE,
        "questionId"    TEXT NOT NULL REFERENCES "CustomTestQuestion"("id") ON DELETE CASCADE,
        "answer"        TEXT,
        "flagged"       INTEGER NOT NULL DEFAULT 0,
        "timeSpent"     INTEGER NOT NULL DEFAULT 0,
        "visited"       INTEGER NOT NULL DEFAULT 0,
        "answerStatus"  TEXT,
        "marksObtained" REAL,
        "createdAt"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        "updatedAt"     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        UNIQUE("attemptId", "questionId")
      )
    `);

    // ─── Dev seed: default admin user ────────────────────────────────────────
    if (process.env.NODE_ENV !== 'production') {
      const defaultAdminEmail = 'logeshms.cbe@gmail.com';
      const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
      const existing = await db.execute({
        sql: `SELECT "id" FROM "User" WHERE "email" = ? LIMIT 1`,
        args: [defaultAdminEmail],
      });
      if (existing.rows.length === 0) {
        const passwordHash = await bcrypt.hash(defaultAdminPassword, 12);
        const adminId = randomUUID();
        await db.execute({
          sql: `
            INSERT INTO "User" (
              "id", "email", "password", "name",
              "createdAt", "updatedAt",
              "canUseAiSolutions", "canAccessAiChatRoom", "isOwner"
            ) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1)
          `,
          args: [
            adminId,
            defaultAdminEmail,
            passwordHash,
            'Owner',
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        });
      }
    }

    // ─── Collect table list for response ────────────────────────────────────
    const tableResult = await db.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const tables = tableResult.rows.map((r) => String(r.name));

    const payload = {
      message: 'All tables created / verified successfully.',
      tables,
    };

    if (wantsHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(
        `<!doctype html><html><head><meta charset="utf-8"/><title>Z7i Migrate</title>
        <style>body{font-family:Inter,system-ui;background:#0a0a0a;color:#e5e5e5;padding:24px}
        .card{max-width:840px;margin:0 auto;background:#111;border:1px solid #262626;border-radius:12px;padding:18px}
        .ok{color:#49d17d} ul{columns:2;gap:18px} li{margin:4px 0;color:#bbb}</style>
        </head><body><div class="card">
        <h1>✅ Migration Complete</h1>
        <p class="ok">${payload.message}</p>
        <p>Total tables: <strong>${tables.length}</strong></p>
        <ul>${tables.map((t) => `<li>${t}</li>`).join('')}</ul>
        <p style="color:#888">Tip: add <code>?format=json</code> for API output.</p>
        </div></body></html>`,
      );
    }

    return res.status(200).json(payload);
  } catch (error) {
    console.error('Migration error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (wantsHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(
        `<!doctype html><html><head><meta charset="utf-8"/><title>Z7i Migrate Failed</title>
        <style>body{font-family:Inter,system-ui;background:#0b0505;color:#ffd7d7;padding:24px}
        .card{max-width:840px;margin:0 auto;background:#1a0e0e;border:1px solid #5f2b2b;border-radius:12px;padding:18px}</style>
        </head><body><div class="card">
        <h1>❌ Migration Failed</h1>
        <p>${message}</p>
        <p>Use <code>?format=json</code> for machine-readable details.</p>
        </div></body></html>`,
      );
    }
    return res.status(500).json({ error: 'Migration failed', details: message });
  }
}
