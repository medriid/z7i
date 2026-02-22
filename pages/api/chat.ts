import type { VercelRequest, VercelResponse } from '@vercel/node';
import { prisma } from '../../lib/api/prisma.js';
import { verifyToken } from '../../lib/api/auth.js';
import { GiphyFetch } from '@giphy/js-fetch-api';
import { Prisma } from '@prisma/client';
import { enforceRateLimitAsync } from '../../lib/api/rate-limit.js';
import { redisDel, redisGetJson, redisSAdd, redisSMembers, redisSRem, redisSetJson } from '../../lib/api/redis-cache.js';
import Pusher from 'pusher';

export const config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

const pusherAppId = process.env.CHAT_APP_ID;
const pusherKey = process.env.CHAT_KEY;
const pusherSecret = process.env.CHAT_SECRET;
const pusherCluster = process.env.CHAT_CLUSTER;

const isPusherConfigured = Boolean(pusherAppId && pusherKey && pusherSecret && pusherCluster);

const chatPusher = isPusherConfigured
  ? new Pusher({
      appId: pusherAppId as string,
      key: pusherKey as string,
      secret: pusherSecret as string,
      cluster: pusherCluster as string,
      useTLS: true,
    })
  : null;

function getPusherClientConfig() {
  return {
    enabled: isPusherConfigured,
    key: pusherKey ?? '',
    cluster: pusherCluster ?? '',
  };
}

async function triggerChatEvent(channels: string | string[], event: string, payload: unknown) {
  if (!chatPusher) return;
  try {
    await chatPusher.trigger(channels, event, payload);
  } catch (error) {
    console.error('Pusher trigger failed', error);
  }
}

function setCorsHeaders(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getAuth(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return verifyToken(authHeader.substring(7));
}

async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isOwner: true } });
  return Boolean(user?.isOwner);
}


type LeagueTier = { name: string; stages: number[] };
const LEAGUE_TIERS: LeagueTier[] = [
  { name: 'Bronze', stages: [100, 100, 100, 100, 100] },
  { name: 'Silver', stages: [250, 250, 250, 250] },
  { name: 'Gold', stages: [300, 300, 400] },
  { name: 'Diamond', stages: [500, 500] },
  { name: 'Platinum', stages: [1000] },
];
const MYTHIC_LEAGUE = '???';

function computeLeague(totalExp: number): string {
  let cumulative = 0;
  for (const tier of LEAGUE_TIERS) {
    for (const stageExp of tier.stages) {
      cumulative += stageExp;
      if (totalExp < cumulative) return tier.name;
    }
  }
  return MYTHIC_LEAGUE;
}

async function getUserLeague(userId: string): Promise<string> {
  const profile = await prisma.userLeagueProfile.findUnique({ where: { userId }, select: { totalExp: true } });
  if (!profile) return 'Bronze';
  return computeLeague(profile.totalExp);
}

const DEFAULT_MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MYTHIC_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_STORAGE_BYTES = 50 * 1024 * 1024;

function getMaxAttachmentSize(league: string): number {
  return league === MYTHIC_LEAGUE ? MYTHIC_MAX_ATTACHMENT_BYTES : DEFAULT_MAX_ATTACHMENT_BYTES;
}

function estimateBase64Bytes(dataUri: string): number {
  const commaIndex = dataUri.indexOf(',');
  if (commaIndex === -1) return dataUri.length;
  const base64Part = dataUri.substring(commaIndex + 1);
  const padding = (base64Part.match(/=+$/) || [''])[0].length;
  return Math.floor((base64Part.length * 3) / 4) - padding;
}

const VALID_IMAGE_REGEX = /^data:image\/(png|jpe?g|gif|webp);base64,/i;
const VALID_VIDEO_REGEX = /^data:video\/(mp4|webm);base64,/i;
const VALID_IMAGE_URL_REGEX = /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i;
const VALID_VIDEO_URL_REGEX = /^https?:\/\/.+\.(mp4|webm)(\?.*)?$/i;

function classifyAttachment(url: string): 'image' | 'video' | null {
  if (VALID_IMAGE_REGEX.test(url)) return 'image';
  if (VALID_VIDEO_REGEX.test(url)) return 'video';
  if (VALID_IMAGE_URL_REGEX.test(url)) return 'image';
  if (VALID_VIDEO_URL_REGEX.test(url)) return 'video';
  return null;
}

async function enforceStorageCap(userId: string) {
  const result = await prisma.chatMessage.aggregate({
    where: { userId, isDeleted: false, attachmentSize: { not: null } },
    _sum: { attachmentSize: true },
  });
  let totalBytes = result._sum.attachmentSize ?? 0;
  if (totalBytes <= MAX_TOTAL_STORAGE_BYTES) return;
  const oldMessages = await prisma.chatMessage.findMany({
    where: { userId, isDeleted: false, attachmentUrl: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, attachmentSize: true },
  });
  for (const msg of oldMessages) {
    if (totalBytes <= MAX_TOTAL_STORAGE_BYTES) break;
    await prisma.chatMessage.update({
      where: { id: msg.id },
      data: { attachmentUrl: null, attachmentType: null, attachmentSize: null },
    });
    totalBytes -= msg.attachmentSize ?? 0;
  }
}

async function areFriends(userA: string, userB: string): Promise<boolean> {
  const req = await prisma.friendRequest.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { senderId: userA, receiverId: userB },
        { senderId: userB, receiverId: userA },
      ],
    },
  });
  return Boolean(req);
}

async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const block = await prisma.userBlock.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  });
  return Boolean(block);
}


const MAX_MESSAGE_LENGTH = 2000;
const MESSAGES_PER_PAGE = 120;

const giphyKey = process.env.GIF_KEY ?? process.env.NEXT_PUBLIC_GIF_KEY ?? '';
const giphy = giphyKey ? new GiphyFetch(giphyKey) : null;

interface FavoriteGifPayload { id: string; url: string; previewUrl: string; }

function normalizeFavoriteGifs(value: unknown): FavoriteGifPayload[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is FavoriteGifPayload => Boolean(item && typeof item === 'object'))
    .map((item: any) => ({
      id: String(item.id ?? '').trim(),
      url: String(item.url ?? '').trim(),
      previewUrl: String(item.previewUrl ?? '').trim(),
    }))
    .filter((item) => item.id && item.url && item.previewUrl)
    .slice(0, 24);
}

interface RawMessage {
  _count?: { reads: number };
  id: string;
  userId: string;
  userName: string;
  userProfileImage: string | null;
  content: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  forwardedQuestionId: string | null;
  replyToMessageId: string | null;
  replyToMessage?: { id: string; userName: string; content: string; attachmentType: string | null } | null;
  chatType: string;
  recipientId: string | null;
  groupId?: string | null;
  recipient?: { id: string; name: string | null; email: string; profileImageUrl: string | null } | null;
  isPinned: boolean;
  editedAt?: Date | null;
  createdAt: Date;
  reactions?: { emoji: string; userId: string }[];
  reads?: { userId: string }[];
}

function serializeMessage(m: RawMessage, currentUserId?: string) {
  const reactionMap: Record<string, { count: number; reacted: boolean }> = {};
  if (m.reactions) {
    for (const r of m.reactions) {
      if (!reactionMap[r.emoji]) reactionMap[r.emoji] = { count: 0, reacted: false };
      reactionMap[r.emoji].count++;
      if (currentUserId && r.userId === currentUserId) reactionMap[r.emoji].reacted = true;
    }
  }
  const reactions = Object.entries(reactionMap).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    reacted: data.reacted,
  }));

  const readBy = m.reads ? m.reads.map((r) => r.userId) : [];
  const isReadByCurrent = currentUserId ? readBy.includes(currentUserId) : false;
  const rawReadCount = typeof m._count?.reads === 'number' ? m._count.reads : readBy.length;
  const readCount = Math.max(0, rawReadCount - (m.userId === currentUserId ? 1 : 0));

  return {
    id: m.id,
    userId: m.userId,
    userName: m.userName,
    userProfileImage: m.userProfileImage,
    content: m.content,
    attachmentUrl: m.attachmentUrl,
    attachmentType: m.attachmentType,
    forwardedQuestionId: m.forwardedQuestionId,
    replyToMessageId: m.replyToMessageId ?? null,
    replyToMessage: m.replyToMessage
      ? {
          id: m.replyToMessage.id,
          userName: m.replyToMessage.userName,
          content: m.replyToMessage.content,
          attachmentType: m.replyToMessage.attachmentType,
        }
      : null,
    chatType: m.chatType,
    recipientId: m.recipientId,
    groupId: m.groupId ?? null,
    recipientName: m.recipient ? (m.recipient.name || m.recipient.email.split('@')[0]) : null,
    recipientProfileImage: m.recipient?.profileImageUrl || null,
    isPinned: m.isPinned,
    editedAt: m.editedAt ? m.editedAt.toISOString() : null,
    reactions,
    readBy,
    readCount,
    isReadByCurrent,
    createdAt: m.createdAt.toISOString(),
  };
}

const messageInclude = {
  reactions: { select: { emoji: true, userId: true } },
  recipient: { select: { id: true, name: true, email: true, profileImageUrl: true } },
  replyToMessage: { select: { id: true, userName: true, content: true, attachmentType: true } },
  _count: { select: { reads: true } },
};

function buildMessageWhere(userId: string, chatType: 'global' | 'direct' | 'group', targetUserId?: string, groupId?: string) {
  if (chatType === 'direct' && targetUserId) {
    return {
      isDeleted: false,
      chatType: 'direct',
      OR: [
        { userId, recipientId: targetUserId },
        { userId: targetUserId, recipientId: userId },
      ],
    };
  }
  if (chatType === 'group' && groupId) {
    return { isDeleted: false, chatType: 'group', groupId };
  }
  return { isDeleted: false, chatType: 'global' };
}



function parseChatType(value: unknown): 'global' | 'direct' | 'group' {
  if (value === 'direct') return 'direct';
  if (value === 'group') return 'group';
  return 'global';
}

function getDirectChannel(userA: string, userB: string) {
  const [left, right] = [userA, userB].sort();
  return `private-chat-direct-${left}-${right}`;
}

function getMessageChannels(message: { chatType: string; userId: string; recipientId?: string | null; groupId?: string | null }) {
  const channels = new Set<string>();
  channels.add(`private-user-${message.userId}`);
  if (message.chatType === 'global') {
    channels.add('private-chat-global');
    return Array.from(channels);
  }
  if (message.chatType === 'direct' && message.recipientId) {
    channels.add(`private-user-${message.recipientId}`);
    channels.add(getDirectChannel(message.userId, message.recipientId));
    return Array.from(channels);
  }
  if (message.chatType === 'group' && message.groupId) {
    channels.add(`private-chat-group-${message.groupId}`);
  }
  return Array.from(channels);
}

function getChatListCacheKey(userId: string) {
  return `chat:list:${userId}`;
}

function getActiveChatsKey(userId: string) {
  return `chat:active:${userId}`;
}

async function invalidateChatListCache(userIds: string[]) {
  await Promise.all([...new Set(userIds)].map((userId) => redisDel(getChatListCacheKey(userId))));
}

async function getGroupForUser(groupId: string, userId: string) {
  return prisma.chatGroup.findFirst({
    where: {
      id: groupId,
      members: { some: { userId } },
    },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, profileImageUrl: true } } },
      },
    },
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = getAuth(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  const action = req.query.action as string;
  const chatRateLimit = action === 'send-message' ? { limit: 30, windowMs: 60_000 } : { limit: 120, windowMs: 60_000 };
  const chatRateLimitResult = await enforceRateLimitAsync(req, `chat:${action || 'unknown'}:${payload.userId}:${req.method || 'UNKNOWN'}`, chatRateLimit.limit, chatRateLimit.windowMs);
  if (!chatRateLimitResult.allowed) {
    res.setHeader('Retry-After', String(chatRateLimitResult.retryAfterSeconds));
    return res.status(429).json({ error: 'Too many requests', retryAfterSeconds: chatRateLimitResult.retryAfterSeconds });
  }

  try {

    if (action === 'realtime-config' && req.method === 'GET') {
      return res.json({ success: true, ...getPusherClientConfig() });
    }

    if (action === 'pusher-auth' && req.method === 'POST') {
      if (!chatPusher) return res.status(503).json({ error: 'Realtime is not configured' });
      const { socket_id, channel_name } = req.body || {};
      if (!socket_id || !channel_name) return res.status(400).json({ error: 'socket_id and channel_name required' });
      if (typeof socket_id !== 'string' || typeof channel_name !== 'string') return res.status(400).json({ error: 'Invalid auth payload' });

      let allowed = false;
      if (channel_name === 'private-chat-global') {
        allowed = true;
      } else if (channel_name === `private-user-${payload.userId}`) {
        allowed = true;
      } else if (channel_name.startsWith('private-chat-group-')) {
        const groupId = channel_name.replace('private-chat-group-', '');
        const member = await prisma.chatGroupMember.findFirst({ where: { groupId, userId: payload.userId }, select: { id: true } });
        allowed = Boolean(member);
      } else if (channel_name.startsWith('private-chat-direct-')) {
        const ids = channel_name.replace('private-chat-direct-', '').split('-');
        if (ids.length === 2 && ids.includes(payload.userId)) {
          const otherId = ids[0] === payload.userId ? ids[1] : ids[0];
          allowed = await areFriends(payload.userId, otherId);
        }
      }

      if (!allowed) return res.status(403).json({ error: 'Not authorized for this channel' });
      const authResponse = chatPusher.authorizeChannel(socket_id, channel_name);
      return res.json(authResponse);
    }

    if (action === 'set-active-chat' && req.method === 'POST') {
      const { chatKey, active } = req.body || {};
      if (typeof chatKey !== 'string' || !chatKey) return res.status(400).json({ error: 'chatKey required' });
      const cacheKey = getActiveChatsKey(payload.userId);
      if (active === false) {
        await redisSRem(cacheKey, chatKey);
      } else {
        await redisSAdd(cacheKey, chatKey);
      }
      return res.json({ success: true });
    }

    if (action === 'get-messages' && req.method === 'GET') {
      const cursor = req.query.cursor as string | undefined;
      const chatType = parseChatType(req.query.chatType as string);
      const targetUserId = req.query.targetUserId as string | undefined;
      const groupId = req.query.groupId as string | undefined;
      const limit = Math.min(Number(req.query.limit) || MESSAGES_PER_PAGE, 100);
      if (chatType === 'group') {
        if (!groupId) return res.status(400).json({ error: 'groupId required for group chat' });
        const member = await prisma.chatGroupMember.findFirst({ where: { groupId, userId: payload.userId }, select: { id: true } });
        if (!member) return res.status(403).json({ error: 'Not a member of this group' });
      }
      const where: Record<string, unknown> = buildMessageWhere(payload.userId, chatType, targetUserId, groupId);
      if (cursor) where.createdAt = { lt: new Date(cursor) };

      const messages = await prisma.chatMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        include: {
          ...messageInclude,
          reads: { where: { userId: payload.userId }, select: { userId: true } },
        },
      });
      const hasMore = messages.length > limit;
      if (hasMore) messages.pop();
      messages.reverse();

      return res.json({
        success: true,
        messages: messages.map((m) => serializeMessage(m as unknown as RawMessage, payload.userId)),
        hasMore,
      });
    }

    if (action === 'get-chat-list' && req.method === 'GET') {
      const cacheKey = getChatListCacheKey(payload.userId);
      const cached = await redisGetJson<Array<{ id: string; type: 'global' | 'direct' | 'group'; title: string; userId?: string; groupId?: string; profileImageUrl?: string | null; lastMessageAt?: string }>>(cacheKey);
      if (cached) {
        return res.json({ success: true, chats: cached, cached: true });
      }

      const directMessages = await prisma.chatMessage.findMany({
        where: {
          isDeleted: false,
          chatType: 'direct',
          OR: [
            { userId: payload.userId },
            { recipientId: payload.userId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        include: { recipient: { select: { id: true, name: true, email: true, profileImageUrl: true } } },
        take: 300,
      });

      const seen = new Set<string>();
      const chats: Array<{ id: string; type: 'global' | 'direct' | 'group'; title: string; userId?: string; groupId?: string; profileImageUrl?: string | null; lastMessageAt?: string }> = [
        { id: 'global', type: 'global', title: 'Global Chat' },
      ];

      const unresolvedOtherIds = new Set<string>();
      for (const m of directMessages) {
        const otherId = m.userId === payload.userId ? m.recipientId : m.userId;
        if (!otherId || seen.has(otherId)) continue;
        seen.add(otherId);
        if (!(m.userId === payload.userId ? m.recipient : null)) unresolvedOtherIds.add(otherId);
      }

      const unresolvedUsers = unresolvedOtherIds.size > 0
        ? await prisma.user.findMany({
            where: { id: { in: Array.from(unresolvedOtherIds) } },
            select: { id: true, name: true, email: true, profileImageUrl: true },
          })
        : [];
      const unresolvedUserMap = new Map(unresolvedUsers.map((u) => [u.id, u]));
      seen.clear();

      for (const m of directMessages) {
        const otherId = m.userId === payload.userId ? m.recipientId : m.userId;
        if (!otherId || seen.has(otherId)) continue;
        seen.add(otherId);
        const other = m.userId === payload.userId ? m.recipient : unresolvedUserMap.get(otherId);
        if (!other) continue;
        chats.push({
          id: `direct-${other.id}`,
          type: 'direct',
          userId: other.id,
          title: other.name || other.email.split('@')[0],
          profileImageUrl: other.profileImageUrl,
          lastMessageAt: m.createdAt.toISOString(),
        });
      }

      const groups = await prisma.chatGroup.findMany({
        where: { members: { some: { userId: payload.userId } } },
        include: {
          messages: { where: { isDeleted: false }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        },
        orderBy: { updatedAt: 'desc' },
      });
      for (const group of groups) {
        chats.push({
          id: `group-${group.id}`,
          type: 'group',
          groupId: group.id,
          title: group.name,
          profileImageUrl: group.profileImageUrl,
          lastMessageAt: group.messages[0]?.createdAt.toISOString(),
        });
      }

      await redisSetJson(cacheKey, chats, 60);
      return res.json({ success: true, chats, cached: false });
    }


    if (action === 'create-group' && req.method === 'POST') {
      const { name, profileImageUrl, memberIds } = req.body || {};
      if (typeof name !== 'string' || name.trim().length < 2) return res.status(400).json({ error: 'Group name too short' });
      const cleanedName = name.trim().slice(0, 80);
      const cleanedMembers = Array.isArray(memberIds) ? [...new Set(memberIds.filter((id: unknown): id is string => typeof id === 'string' && id !== payload.userId))] : [];
      if (cleanedMembers.length > 49) return res.status(400).json({ error: 'Max 50 members per group' });

      const allowedFriendLinks = await prisma.friendRequest.findMany({
        where: {
          status: 'accepted',
          OR: [
            { senderId: payload.userId, receiverId: { in: cleanedMembers } },
            { senderId: { in: cleanedMembers }, receiverId: payload.userId },
          ],
        },
        select: { senderId: true, receiverId: true },
      });
      const allowed = new Set<string>();
      for (const rel of allowedFriendLinks) {
        allowed.add(rel.senderId === payload.userId ? rel.receiverId : rel.senderId);
      }
      const finalMembers = cleanedMembers.filter((id) => allowed.has(id));

      const group = await prisma.chatGroup.create({
        data: {
          name: cleanedName,
          profileImageUrl: typeof profileImageUrl === 'string' && profileImageUrl.trim() ? profileImageUrl.trim() : null,
          createdByUserId: payload.userId,
          members: {
            create: [
              { userId: payload.userId },
              ...finalMembers.map((id) => ({ userId: id })),
            ],
          },
        },
      });

      const memberUserIds = [payload.userId, ...finalMembers];
      await invalidateChatListCache(memberUserIds);
      await triggerChatEvent(memberUserIds.map((uid) => `private-user-${uid}`), 'chat.group.updated', { groupId: group.id });

      return res.json({ success: true, group });
    }

    if (action === 'update-group' && req.method === 'POST') {
      const { groupId, name, profileImageUrl, addMemberIds, removeMemberIds } = req.body || {};
      if (!groupId || typeof groupId !== 'string') return res.status(400).json({ error: 'groupId required' });
      const group = await prisma.chatGroup.findUnique({ where: { id: groupId }, include: { members: true } });
      if (!group) return res.status(404).json({ error: 'Group not found' });
      if (group.createdByUserId !== payload.userId) return res.status(403).json({ error: 'Only group creator can manage this group' });

      const toRemove = Array.isArray(removeMemberIds) ? removeMemberIds.filter((id: unknown): id is string => typeof id === 'string' && id !== payload.userId) : [];
      if (toRemove.length > 0) {
        await prisma.chatGroupMember.deleteMany({ where: { groupId, userId: { in: toRemove } } });
      }

      const toAdd = Array.isArray(addMemberIds) ? [...new Set(addMemberIds.filter((id: unknown): id is string => typeof id === 'string' && id !== payload.userId))] : [];
      if (toAdd.length > 0) {
        const existing = await prisma.chatGroupMember.count({ where: { groupId } });
        const currentIds = new Set((await prisma.chatGroupMember.findMany({ where: { groupId }, select: { userId: true } })).map((m) => m.userId));
        const candidates = toAdd.filter((id) => !currentIds.has(id));
        const allowedFriendLinks = await prisma.friendRequest.findMany({
          where: {
            status: 'accepted',
            OR: [
              { senderId: payload.userId, receiverId: { in: candidates } },
              { senderId: { in: candidates }, receiverId: payload.userId },
            ],
          },
          select: { senderId: true, receiverId: true },
        });
        const allowed = new Set<string>();
        for (const rel of allowedFriendLinks) {
          allowed.add(rel.senderId === payload.userId ? rel.receiverId : rel.senderId);
        }
        const finalAdds = candidates.filter((id) => allowed.has(id));
        if (existing + finalAdds.length > 50) return res.status(400).json({ error: 'Max 50 members per group' });
        if (finalAdds.length > 0) {
          await prisma.chatGroupMember.createMany({
            data: finalAdds.map((id) => ({ groupId, userId: id })),
            skipDuplicates: true,
          });
        }
      }

      const data: Record<string, unknown> = {};
      if (typeof name === 'string' && name.trim()) data.name = name.trim().slice(0, 80);
      if (typeof profileImageUrl === 'string') data.profileImageUrl = profileImageUrl.trim() || null;
      const updated = Object.keys(data).length > 0
        ? await prisma.chatGroup.update({ where: { id: groupId }, data })
        : await prisma.chatGroup.findUnique({ where: { id: groupId } });

      const membersAfterUpdate = await prisma.chatGroupMember.findMany({ where: { groupId }, select: { userId: true } });
      const memberUserIds: string[] = [...new Set([...membersAfterUpdate.map((item) => item.userId), String(payload.userId)])];
      await invalidateChatListCache(memberUserIds);
      await triggerChatEvent(memberUserIds.map((uid) => `private-user-${uid}`), 'chat.group.updated', { groupId });

      return res.json({ success: true, group: updated });
    }


    if (action === 'get-group-details' && req.method === 'GET') {
      const groupId = req.query.groupId as string | undefined;
      if (!groupId) return res.status(400).json({ error: 'groupId required' });
      const group = await getGroupForUser(groupId, payload.userId);
      if (!group) return res.status(404).json({ error: 'Group not found' });
      return res.json({
        success: true,
        group: {
          id: group.id,
          name: group.name,
          profileImageUrl: group.profileImageUrl,
          createdByUserId: group.createdByUserId,
          isCreator: group.createdByUserId === payload.userId,
          members: group.members.map((m) => ({
            id: m.user.id,
            name: m.user.name || m.user.email.split('@')[0],
            profileImageUrl: m.user.profileImageUrl,
          })),
        },
      });
    }


    if (action === 'send-message' && req.method === 'POST') {
      const { content, attachment, forwardedQuestionId, replyToMessageId, chatType: rawChatType, targetUserId, groupId } = req.body || {};
      const chatType = parseChatType(rawChatType);
      const hasContent = content && typeof content === 'string' && content.trim().length > 0;
      const hasAttachment = attachment && typeof attachment === 'string' && attachment.length > 0;
      const hasForward = forwardedQuestionId && typeof forwardedQuestionId === 'string';

      if (!hasContent && !hasAttachment && !hasForward) {
        return res.status(400).json({ error: 'Message content, attachment, or forwarded question required' });
      }
      if (hasContent && content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, name: true, email: true, profileImageUrl: true },
      });
      if (!user) return res.status(404).json({ error: 'User not found' });

      let recipientId: string | null = null;
      let messageGroupId: string | null = null;
      if (chatType === 'direct') {
        if (!targetUserId || typeof targetUserId !== 'string') return res.status(400).json({ error: 'targetUserId required for direct chat' });
        if (targetUserId === payload.userId) return res.status(400).json({ error: 'Cannot message yourself' });
        const friends = await areFriends(payload.userId, targetUserId);
        if (!friends) return res.status(403).json({ error: 'Direct messages are only available between friends' });
        const eitherBlocked = await prisma.userBlock.findFirst({
          where: {
            OR: [
              { blockerId: payload.userId, blockedId: targetUserId },
              { blockerId: targetUserId, blockedId: payload.userId },
            ],
          },
        });
        if (eitherBlocked) return res.status(403).json({ error: 'Cannot message this user' });
        recipientId = targetUserId;
      }

      if (chatType === 'group') {
        if (!groupId || typeof groupId !== 'string') return res.status(400).json({ error: 'groupId required for group chat' });
        const membership = await prisma.chatGroupMember.findFirst({ where: { groupId, userId: payload.userId }, select: { id: true } });
        if (!membership) return res.status(403).json({ error: 'Not a member of this group' });
        messageGroupId = groupId;
      }

      let attachmentUrl: string | null = null;
      let attachmentType: string | null = null;
      let attachmentSize: number | null = null;

      if (hasAttachment) {
        const type = classifyAttachment(attachment);
        if (!type) return res.status(400).json({ error: 'Invalid attachment type.' });
        const bytes = attachment.startsWith('data:') ? estimateBase64Bytes(attachment) : 0;
        if (bytes > 0) {
          const league = await getUserLeague(payload.userId);
          const maxSize = getMaxAttachmentSize(league);
          if (bytes > maxSize) {
            const maxMb = Math.round(maxSize / (1024 * 1024));
            return res.status(400).json({
              error: `Attachment too large (max ${maxMb} MB).${league !== MYTHIC_LEAGUE ? ' Reach ??? league for 10 MB limit.' : ''}`,
            });
          }
        }
        attachmentUrl = attachment;
        attachmentType = type;
        attachmentSize = bytes > 0 ? bytes : null;
      }

      let fwdId: string | null = null;
      let replyTargetId: string | null = null;
      if (hasForward) {
        const bookmark = await prisma.questionBookmark.findFirst({
          where: { userId: payload.userId, questionId: forwardedQuestionId },
        });
        if (bookmark) fwdId = forwardedQuestionId;
      }

      if (replyToMessageId && typeof replyToMessageId === 'string') {
        const replyTarget = await prisma.chatMessage.findFirst({
          where: { id: replyToMessageId, ...(buildMessageWhere(payload.userId, chatType, targetUserId, groupId) as any) },
          select: { id: true },
        });
        if (replyTarget) {
          replyTargetId = replyTarget.id;
        }
      }

      const mentionMatches = hasContent && chatType === 'global'
        ? [...new Set((content.match(/@([a-zA-Z0-9._-]{2,32})/g) || []).map((m: string) => m.slice(1).toLowerCase()))]
        : [];
      const mentionUsers = mentionMatches.length > 0
        ? (await prisma.user.findMany({
            where: { id: { not: payload.userId } },
            select: { id: true, name: true, email: true },
          })).filter((u) => {
            const handle = (u.name || u.email.split('@')[0]).toLowerCase();
            return mentionMatches.includes(handle);
          })
        : [];

      if (chatType === 'global' && mentionUsers.length > 0) {
        const blockedMention = await prisma.userBlock.findFirst({
          where: {
            blockerId: { in: mentionUsers.map((u) => u.id) },
            blockedId: payload.userId,
          },
        });
        if (blockedMention) return res.status(403).json({ error: 'You cannot mention users who blocked you' });
      }

      const message = await prisma.chatMessage.create({
        data: {
          userId: user.id,
          userName: user.name || user.email.split('@')[0],
          userProfileImage: user.profileImageUrl,
          content: hasContent ? content.trim() : '',
          attachmentUrl,
          attachmentType,
          attachmentSize,
          forwardedQuestionId: fwdId,
          replyToMessageId: replyTargetId,
          chatType,
          recipientId,
          groupId: messageGroupId,
        },
        include: {
          ...messageInclude,
          reads: { where: { userId: payload.userId }, select: { userId: true } },
        },
      });

      if (mentionUsers.length > 0) {
        await prisma.chatMention.createMany({
          data: mentionUsers.map((u) => ({ messageId: message.id, mentionedUserId: u.id })),
          skipDuplicates: true,
        });
      }

      if (attachmentSize && attachmentSize > 0) {
        enforceStorageCap(payload.userId).catch(console.error);
      }

      const serializedMessage = serializeMessage(message as unknown as RawMessage, payload.userId);
      const affectedUsers = [payload.userId, recipientId].filter((item): item is string => Boolean(item));
      await invalidateChatListCache(affectedUsers);
      await triggerChatEvent(getMessageChannels(message), 'chat.message.created', {
        message: serializedMessage,
      });
      await Promise.all(affectedUsers.map(async (uid) => {
        const activeChats = await redisSMembers(getActiveChatsKey(uid));
        await triggerChatEvent(`private-user-${uid}`, 'chat.active.updated', { activeChats });
      }));

      return res.json({ success: true, message: serializedMessage });
    }

    if (action === 'delete-message' && req.method === 'POST') {
      const { messageId } = req.body || {};
      if (!messageId) return res.status(400).json({ error: 'messageId is required' });
      const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      if (!message) return res.status(404).json({ error: 'Message not found' });
      const admin = await isAdmin(payload.userId);
      if (message.userId !== payload.userId && !admin) {
        return res.status(403).json({ error: 'Not authorized' });
      }
      await prisma.chatMessage.update({ where: { id: messageId }, data: { isDeleted: true } });
      await invalidateChatListCache([payload.userId, message.recipientId].filter((item): item is string => Boolean(item)));
      await triggerChatEvent(getMessageChannels(message), 'chat.message.deleted', { messageId });
      return res.json({ success: true });
    }

    if (action === 'pin-message' && req.method === 'POST') {
      const { messageId, pinned } = req.body || {};
      if (!messageId) return res.status(400).json({ error: 'messageId is required' });
      const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { chatType: true, groupId: true } });
      if (!message) return res.status(404).json({ error: 'Message not found' });
      if (message.chatType === 'group') {
        const group = message.groupId ? await prisma.chatGroup.findUnique({ where: { id: message.groupId }, select: { createdByUserId: true } }) : null;
        if (!group || group.createdByUserId !== payload.userId) return res.status(403).json({ error: 'Only group creator can pin messages' });
      } else {
        const admin = await isAdmin(payload.userId);
        if (!admin) return res.status(403).json({ error: 'Only the owner can pin messages' });
      }
      const updatedMessage = await prisma.chatMessage.update({
        where: { id: messageId },
        data: { isPinned: pinned !== false },
        include: {
          ...messageInclude,
          reads: { where: { userId: payload.userId }, select: { userId: true } },
        },
      });
      await triggerChatEvent(getMessageChannels(updatedMessage), 'chat.message.updated', {
        message: serializeMessage(updatedMessage as unknown as RawMessage, payload.userId),
      });
      return res.json({ success: true });
    }

    if (action === 'react' && req.method === 'POST') {
      const { messageId, emoji } = req.body || {};
      if (!messageId || !emoji) return res.status(400).json({ error: 'messageId and emoji required' });
      if (typeof emoji !== 'string' || emoji.length > 16 || !/\p{Extended_Pictographic}/u.test(emoji)) {
        return res.status(400).json({ error: 'Invalid reaction' });
      }

      const existing = await prisma.chatReaction.findUnique({
        where: { messageId_userId_emoji: { messageId, userId: payload.userId, emoji } },
      });
      if (existing) {
        await prisma.chatReaction.delete({ where: { id: existing.id } });
      } else {
        await prisma.chatReaction.create({ data: { messageId, userId: payload.userId, emoji } });
      }

      const updatedMessage = await prisma.chatMessage.findUnique({
        where: { id: messageId },
        include: {
          ...messageInclude,
          reads: { where: { userId: payload.userId }, select: { userId: true } },
        },
      });
      if (updatedMessage) {
        await triggerChatEvent(getMessageChannels(updatedMessage), 'chat.message.updated', {
          message: serializeMessage(updatedMessage as unknown as RawMessage, payload.userId),
        });
      }
      return res.json({ success: true, action: existing ? 'removed' : 'added' });
    }


    if (action === 'edit-message' && req.method === 'POST') {
      const { messageId, content } = req.body || {};
      if (!messageId || typeof messageId !== 'string') return res.status(400).json({ error: 'messageId is required' });
      if (typeof content !== 'string') return res.status(400).json({ error: 'content is required' });
      const trimmed = content.trim();
      if (!trimmed) return res.status(400).json({ error: 'Message content cannot be empty' });
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      }

      const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { userId: true } });
      if (!message) return res.status(404).json({ error: 'Message not found' });
      const admin = await isAdmin(payload.userId);
      if (message.userId !== payload.userId && !admin) {
        return res.status(403).json({ error: 'Not authorized' });
      }

      const updated = await prisma.chatMessage.update({
        where: { id: messageId },
        data: { content: trimmed, editedAt: new Date() },
        include: {
          ...messageInclude,
          reads: { where: { userId: payload.userId }, select: { userId: true } },
        },
      });

      const serialized = serializeMessage(updated as unknown as RawMessage, payload.userId);
      await triggerChatEvent(getMessageChannels(updated), 'chat.message.updated', { message: serialized });
      return res.json({ success: true, message: serialized });
    }

    if (action === 'mark-messages-read' && req.method === 'POST') {
      const { messageIds } = req.body || {};
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return res.status(400).json({ error: 'messageIds array required' });
      }
      const limited = messageIds.slice(0, 100);
      await prisma.chatMessageRead.createMany({
        data: limited.map((mid: string) => ({ messageId: mid, userId: payload.userId })),
        skipDuplicates: true,
      });
      const touchedMessages = await prisma.chatMessage.findMany({
        where: { id: { in: limited }, isDeleted: false },
        select: { id: true, chatType: true, userId: true, recipientId: true, groupId: true },
      });
      for (const msg of touchedMessages) {
        await triggerChatEvent(getMessageChannels(msg), 'chat.message.read', {
          messageId: msg.id,
          readByUserId: payload.userId,
        });
      }
      return res.json({ success: true });
    }

    if (action === 'poll' && req.method === 'GET') {
      const after = req.query.after as string | undefined;
      const chatType = parseChatType(req.query.chatType as string);
      const targetUserId = req.query.targetUserId as string | undefined;
      const groupId = req.query.groupId as string | undefined;
      if (!after) return res.status(400).json({ error: 'after timestamp required' });
      if (chatType === 'group') {
        if (!groupId) return res.status(400).json({ error: 'groupId required for group chat' });
        const member = await prisma.chatGroupMember.findFirst({ where: { groupId, userId: payload.userId }, select: { id: true } });
        if (!member) return res.status(403).json({ error: 'Not a member of this group' });
      }
      const messages = await prisma.chatMessage.findMany({
        where: { ...buildMessageWhere(payload.userId, chatType, targetUserId, groupId), createdAt: { gt: new Date(after) } },
        orderBy: { createdAt: 'asc' },
        take: 100,
        include: {
          ...messageInclude,
          reads: { where: { userId: payload.userId }, select: { userId: true } },
        },
      });
      return res.json({
        success: true,
        messages: messages.map((m) => serializeMessage(m as unknown as RawMessage, payload.userId)),
      });
    }

    if (action === 'get-announcements' && req.method === 'GET') {
      const announcements = await prisma.announcement.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          createdByUser: { select: { name: true, email: true, profileImageUrl: true } },
          reads: { where: { userId: payload.userId }, select: { readAt: true } },
        },
      });
      return res.json({
        success: true,
        announcements: announcements.map((a) => ({
          id: a.id,
          title: a.title,
          content: a.content,
          createdBy: {
            name: a.createdByUser.name || a.createdByUser.email.split('@')[0],
            profileImageUrl: a.createdByUser.profileImageUrl,
          },
          isRead: a.reads.length > 0,
          createdAt: a.createdAt.toISOString(),
        })),
      });
    }

    if (action === 'create-announcement' && req.method === 'POST') {
      const admin = await isAdmin(payload.userId);
      if (!admin) return res.status(403).json({ error: 'Only the owner can create announcements' });
      const { title, content } = req.body || {};
      if (!title || !content || typeof title !== 'string' || typeof content !== 'string') {
        return res.status(400).json({ error: 'Title and content required' });
      }
      if (title.length > 200) return res.status(400).json({ error: 'Title too long' });
      if (content.length > 5000) return res.status(400).json({ error: 'Content too long' });
      const announcement = await prisma.announcement.create({
        data: { title: title.trim(), content: content.trim(), createdByUserId: payload.userId },
      });
      return res.json({ success: true, announcement: { id: announcement.id, title: announcement.title, content: announcement.content, createdAt: announcement.createdAt.toISOString() } });
    }

    if (action === 'delete-announcement' && req.method === 'POST') {
      const admin = await isAdmin(payload.userId);
      if (!admin) return res.status(403).json({ error: 'Only the owner can delete announcements' });
      const { announcementId } = req.body || {};
      if (!announcementId) return res.status(400).json({ error: 'announcementId required' });
      await prisma.announcement.delete({ where: { id: announcementId } });
      return res.json({ success: true });
    }

    if (action === 'mark-announcement-read' && req.method === 'POST') {
      const { announcementId } = req.body || {};
      if (!announcementId) return res.status(400).json({ error: 'announcementId required' });
      await prisma.announcementRead.upsert({
        where: { announcementId_userId: { announcementId, userId: payload.userId } },
        update: { readAt: new Date() },
        create: { announcementId, userId: payload.userId },
      });
      return res.json({ success: true });
    }

    if (action === 'mark-all-read' && req.method === 'POST') {
      const unread = await prisma.announcement.findMany({
        where: { reads: { none: { userId: payload.userId } } },
        select: { id: true },
      });
      if (unread.length > 0) {
        await prisma.announcementRead.createMany({
          data: unread.map((a) => ({ announcementId: a.id, userId: payload.userId })),
          skipDuplicates: true,
        });
      }
      return res.json({ success: true });
    }

    if (action === 'unread-count' && req.method === 'GET') {
      const annCount = await prisma.announcement.count({
        where: { reads: { none: { userId: payload.userId } } },
      });
      const directCount = await prisma.chatMessage.count({
        where: {
          isDeleted: false,
          chatType: 'direct',
          recipientId: payload.userId,
          reads: { none: { userId: payload.userId } },
        },
      });
      const mentionCount = await prisma.chatMessage.count({
        where: {
          isDeleted: false,
          chatType: 'global',
          userId: { not: payload.userId },
          reads: { none: { userId: payload.userId } },
          mentions: { some: { mentionedUserId: payload.userId } },
        },
      });
      const msgCount = directCount + mentionCount;
      const pendingFriendRequestCount = await prisma.friendRequest.count({
        where: { receiverId: payload.userId, status: 'pending' },
      });
      return res.json({
        success: true,
        count: annCount + msgCount + pendingFriendRequestCount,
        announcementCount: annCount,
        messageCount: msgCount,
        friendRequestCount: pendingFriendRequestCount,
      });
    }

    if (action === 'notification-feed' && req.method === 'GET') {
      const announcements = await prisma.announcement.findMany({
        where: { reads: { none: { userId: payload.userId } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          createdByUser: { select: { name: true, email: true, profileImageUrl: true } },
        },
      });

      const unreadMessages = await prisma.chatMessage.findMany({
        where: {
          isDeleted: false,
          userId: { not: payload.userId },
          reads: { none: { userId: payload.userId } },
          OR: [
            { chatType: 'direct', recipientId: payload.userId },
            { chatType: 'global', mentions: { some: { mentionedUserId: payload.userId } } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const pendingFriendRequests = await prisma.friendRequest.findMany({
        where: { receiverId: payload.userId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          sender: { select: { id: true, name: true, email: true, profileImageUrl: true } },
        },
      });

      type NotifItem = {
        id: string;
        type: 'announcement' | 'message' | 'friend_request';
        title: string;
        preview: string;
        from: string;
        fromImage: string | null;
        isRead: boolean;
        createdAt: string;
        messageId?: string;
        requestId?: string;
      };

      const items: NotifItem[] = [];

      for (const a of announcements) {
        items.push({
          id: `ann-${a.id}`,
          type: 'announcement',
          title: a.title,
          preview: a.content.substring(0, 80),
          from: a.createdByUser.name || a.createdByUser.email.split('@')[0],
          fromImage: a.createdByUser.profileImageUrl,
          isRead: false,
          createdAt: a.createdAt.toISOString(),
        });
      }

      for (const m of unreadMessages) {
        items.push({
          id: `msg-${m.id}`,
          type: 'message',
          title: m.userName,
          preview: m.content.substring(0, 80) || (m.attachmentType ? `[${m.attachmentType}]` : ''),
          from: m.userName,
          fromImage: m.userProfileImage,
          isRead: false,
          createdAt: m.createdAt.toISOString(),
          messageId: m.id,
        });
      }

      for (const req of pendingFriendRequests) {
        const senderName = req.sender.name || req.sender.email.split('@')[0];
        items.push({
          id: `fr-${req.id}`,
          type: 'friend_request',
          title: `${senderName} sent you a friend request`,
          preview: 'Accept to add them to your friends list or decline to dismiss this request.',
          from: senderName,
          fromImage: req.sender.profileImageUrl,
          isRead: false,
          createdAt: req.createdAt.toISOString(),
          requestId: req.id,
        });
      }

      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return res.json({ success: true, items: items.slice(0, 10) });
    }

    if (action === 'mark-notification-read' && req.method === 'POST') {
      const { notificationId } = req.body || {};
      if (!notificationId) return res.status(400).json({ error: 'notificationId required' });
      if (notificationId.startsWith('ann-')) {
        const announcementId = notificationId.substring(4);
        await prisma.announcementRead.upsert({
          where: { announcementId_userId: { announcementId, userId: payload.userId } },
          update: { readAt: new Date() },
          create: { announcementId, userId: payload.userId },
        });
      } else if (notificationId.startsWith('msg-')) {
        const messageId = notificationId.substring(4);
        await prisma.chatMessageRead.upsert({
          where: { messageId_userId: { messageId, userId: payload.userId } },
          update: { readAt: new Date() },
          create: { messageId, userId: payload.userId },
        });
      }
      return res.json({ success: true });
    }

    if (action === 'mark-all-notifications-read' && req.method === 'POST') {
      const unreadAnn = await prisma.announcement.findMany({
        where: { reads: { none: { userId: payload.userId } } },
        select: { id: true },
      });
      if (unreadAnn.length > 0) {
        await prisma.announcementRead.createMany({
          data: unreadAnn.map((a) => ({ announcementId: a.id, userId: payload.userId })),
          skipDuplicates: true,
        });
      }

      const unreadMsgs = await prisma.chatMessage.findMany({
        where: {
          isDeleted: false,
          userId: { not: payload.userId },
          reads: { none: { userId: payload.userId } },
          OR: [
            { chatType: 'direct', recipientId: payload.userId },
            { chatType: 'global', mentions: { some: { mentionedUserId: payload.userId } } },
          ],
        },
        select: { id: true },
        take: 100,
      });
      if (unreadMsgs.length > 0) {
        await prisma.chatMessageRead.createMany({
          data: unreadMsgs.map((m) => ({ messageId: m.id, userId: payload.userId })),
          skipDuplicates: true,
        });
      }
      return res.json({ success: true });
    }

    if (action === 'search-gifs' && req.method === 'GET') {
      if (!giphy) return res.status(500).json({ error: 'GIF provider is not configured' });
      const query = String(req.query.q || '').trim();
      const offset = Number(req.query.offset || 0);
      try {
        const result = query
          ? await giphy.search(query, { limit: 18, offset: Number.isFinite(offset) ? offset : 0, rating: 'pg-13' })
          : await giphy.trending({ limit: 18, offset: Number.isFinite(offset) ? offset : 0, rating: 'pg-13' });
        return res.status(200).json({ success: true, gifs: result.data, pagination: result.pagination });
      } catch (error) {
        console.error('Search gifs error:', error);
        return res.status(500).json({ error: 'Failed to load GIFs' });
      }
    }

    if (action === 'get-favorite-gifs' && req.method === 'GET') {
      const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { chatFavoriteGifs: true } });
      return res.status(200).json({ success: true, gifs: normalizeFavoriteGifs(user?.chatFavoriteGifs) });
    }

    if (action === 'set-favorite-gifs' && req.method === 'POST') {
      const gifs = normalizeFavoriteGifs(req.body?.gifs);
      await prisma.user.update({
        where: { id: payload.userId },
        data: { chatFavoriteGifs: gifs as Prisma.JsonArray },
      });
      return res.status(200).json({ success: true, gifs });
    }

    if (action === 'get-forwarded-question' && req.method === 'GET') {
      const questionId = req.query.questionId as string;
      if (!questionId) return res.status(400).json({ error: 'questionId required' });
      const question = await prisma.questionResponse.findUnique({
        where: { id: questionId },
        select: {
          id: true,
          questionHtml: true,
          option1: true,
          option2: true,
          option3: true,
          option4: true,
          correctAnswer: true,
          questionType: true,
          subjectName: true,
          solutionHtml: true,
        },
      });
      if (!question) return res.status(404).json({ error: 'Question not found' });
      return res.json({ success: true, question });
    }

    if (action === 'get-bookmarks' && req.method === 'GET') {
      const bookmarks = await prisma.questionBookmark.findMany({
        where: { userId: payload.userId },
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: {
          question: {
            select: {
              id: true,
              questionHtml: true,
              subjectName: true,
              questionType: true,
              correctAnswer: true,
              option1: true,
              option2: true,
              option3: true,
              option4: true,
            },
          },
        },
      });
      return res.json({
        success: true,
        bookmarks: bookmarks.map((b) => ({
          id: b.id,
          questionId: b.question.id,
          subjectName: b.question.subjectName,
          questionType: b.question.questionType,
          questionHtml: b.question.questionHtml.substring(0, 200),
          correctAnswer: b.question.correctAnswer,
        })),
      });
    }


    if (action === 'send-friend-request' && req.method === 'POST') {
      const { targetUserId } = req.body || {};
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      if (targetUserId === payload.userId) return res.status(400).json({ error: 'Cannot send request to yourself' });

      const blocked = await isBlocked(targetUserId, payload.userId);
      if (blocked) return res.status(403).json({ error: 'Cannot send request' });

      const existing = await prisma.friendRequest.findFirst({
        where: {
          OR: [
            { senderId: payload.userId, receiverId: targetUserId },
            { senderId: targetUserId, receiverId: payload.userId },
          ],
        },
      });
      if (existing) {
        if (existing.status === 'accepted') return res.json({ success: true, status: 'already_friends' });
        if (existing.status === 'pending') return res.json({ success: true, status: 'pending' });
      }

      await prisma.friendRequest.upsert({
        where: { senderId_receiverId: { senderId: payload.userId, receiverId: targetUserId } },
        update: { status: 'pending', updatedAt: new Date() },
        create: { senderId: payload.userId, receiverId: targetUserId },
      });
      return res.json({ success: true, status: 'sent' });
    }

    if (action === 'respond-friend-request' && req.method === 'POST') {
      const { requestId, response } = req.body || {};
      if (!requestId || !['accept', 'reject'].includes(response)) {
        return res.status(400).json({ error: 'requestId and response (accept/reject) required' });
      }
      const request = await prisma.friendRequest.findUnique({ where: { id: requestId } });
      if (!request || request.receiverId !== payload.userId) {
        return res.status(404).json({ error: 'Request not found' });
      }
      await prisma.friendRequest.update({
        where: { id: requestId },
        data: { status: response === 'accept' ? 'accepted' : 'rejected' },
      });
      return res.json({ success: true });
    }

    if (action === 'get-friends' && req.method === 'GET') {
      const requests = await prisma.friendRequest.findMany({
        where: {
          status: 'accepted',
          OR: [{ senderId: payload.userId }, { receiverId: payload.userId }],
        },
        include: {
          sender: { select: { id: true, name: true, email: true, profileImageUrl: true } },
          receiver: { select: { id: true, name: true, email: true, profileImageUrl: true } },
        },
      });
      const friends = requests.map((r) => {
        const friend = r.senderId === payload.userId ? r.receiver : r.sender;
        return {
          id: friend.id,
          name: friend.name || friend.email.split('@')[0],
          profileImageUrl: friend.profileImageUrl,
        };
      });
      return res.json({ success: true, friends });
    }

    if (action === 'get-friend-requests' && req.method === 'GET') {
      const requests = await prisma.friendRequest.findMany({
        where: { receiverId: payload.userId, status: 'pending' },
        include: {
          sender: { select: { id: true, name: true, email: true, profileImageUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({
        success: true,
        requests: requests.map((r) => ({
          id: r.id,
          senderId: r.sender.id,
          senderName: r.sender.name || r.sender.email.split('@')[0],
          senderImage: r.sender.profileImageUrl,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    }

    if (action === 'remove-friend' && req.method === 'POST') {
      const { friendId } = req.body || {};
      if (!friendId) return res.status(400).json({ error: 'friendId required' });
      await prisma.friendRequest.deleteMany({
        where: {
          status: 'accepted',
          OR: [
            { senderId: payload.userId, receiverId: friendId },
            { senderId: friendId, receiverId: payload.userId },
          ],
        },
      });
      return res.json({ success: true });
    }

    if (action === 'block-user' && req.method === 'POST') {
      const { targetUserId } = req.body || {};
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      if (targetUserId === payload.userId) return res.status(400).json({ error: 'Cannot block yourself' });

      await prisma.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId: payload.userId, blockedId: targetUserId } },
        update: {},
        create: { blockerId: payload.userId, blockedId: targetUserId },
      });
      await prisma.friendRequest.deleteMany({
        where: {
          OR: [
            { senderId: payload.userId, receiverId: targetUserId },
            { senderId: targetUserId, receiverId: payload.userId },
          ],
        },
      });
      return res.json({ success: true });
    }

    if (action === 'unblock-user' && req.method === 'POST') {
      const { targetUserId } = req.body || {};
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      await prisma.userBlock.deleteMany({
        where: { blockerId: payload.userId, blockedId: targetUserId },
      });
      return res.json({ success: true });
    }

    if (action === 'get-blocked' && req.method === 'GET') {
      const blocks = await prisma.userBlock.findMany({
        where: { blockerId: payload.userId },
        include: {
          blocked: { select: { id: true, name: true, email: true, profileImageUrl: true } },
        },
      });
      return res.json({
        success: true,
        blocked: blocks.map((b) => ({
          id: b.blocked.id,
          name: b.blocked.name || b.blocked.email.split('@')[0],
          profileImageUrl: b.blocked.profileImageUrl,
        })),
      });
    }

    if (action === 'get-privacy' && req.method === 'GET') {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { chatPrivacy: true },
      });
      return res.json({ success: true, chatPrivacy: user?.chatPrivacy || 'everyone' });
    }

    if (action === 'set-privacy' && req.method === 'POST') {
      const { chatPrivacy } = req.body || {};
      if (!['everyone', 'friends'].includes(chatPrivacy)) {
        return res.status(400).json({ error: 'Invalid privacy setting' });
      }
      await prisma.user.update({
        where: { id: payload.userId },
        data: { chatPrivacy },
      });
      return res.json({ success: true });
    }

    if (action === 'search-users' && req.method === 'GET') {
      const q = (req.query.q as string || '').trim();
      if (q.length < 2) return res.json({ success: true, users: [] });
      const users = await prisma.user.findMany({
        where: {
          id: { not: payload.userId },
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { z7iAccount: { is: { enrollmentNo: { contains: q, mode: 'insensitive' } } } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          profileImageUrl: true,
          z7iAccount: { select: { enrollmentNo: true } },
        },
        take: 10,
      });
      return res.json({
        success: true,
        users: users.map((u) => ({
          id: u.id,
          name: u.name || u.email.split('@')[0],
          profileImageUrl: u.profileImageUrl,
          enrollmentNo: u.z7iAccount?.enrollmentNo || null,
        })),
      });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error) {
    console.error('Chat API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
