import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import {
  Send, ChevronLeft, Pin, Trash2, Bell, X, Megaphone, Check, CheckCheck, Clock3,
  Image as ImageIcon, Film, Paperclip, ChevronDown, Users, UserPlus,
  UserX, UserCheck, Shield, Search, Smile, BookOpen, MessageCircle, PanelRightOpen, PanelRightClose, Sticker, Star, Cog, Plus, Pencil, Reply,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { renderLatexInHtml } from './utils/latex';
import { API_BASE } from './lib/apiBase';
import { Gif } from '@giphy/react-components';
import Pusher, { type Channel } from 'pusher-js';

async function chatApi(action: string, opts: RequestInit = {}) {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const sep = action.includes('?') ? '&' : '?';
  const url = action.startsWith('/') ? `${API_BASE}${action}` : `${API_BASE}/chat?action=${action}`;
  const res = await fetch(url, { ...opts, headers });
  return res.json();
}

function chatPost(action: string, body: unknown) {
  return chatApi(action, { method: 'POST', body: JSON.stringify(body) });
}


interface ReactionData { emoji: string; count: number; reacted: boolean; }

interface ChatMsg {
  id: string;
  userId: string;
  userName: string;
  userProfileImage: string | null;
  content: string;
  attachmentUrl: string | null;
  attachmentType: string | null;
  forwardedQuestionId: string | null;
  replyToMessageId?: string | null;
  replyToMessage?: { id: string; userName: string; content: string; attachmentType: string | null } | null;
  chatType: 'global' | 'direct' | 'group';
  groupId?: string | null;
  recipientId?: string | null;
  recipientName?: string | null;
  recipientProfileImage?: string | null;
  isPinned: boolean;
  editedAt?: string | null;
  reactions: ReactionData[];
  readBy: string[];
  readCount?: number;
  isReadByCurrent?: boolean;
  createdAt: string;
  clientStatus?: 'sent' | 'delivered' | 'read';
}

interface Announcement {
  id: string;
  title: string;
  content: string;
  createdBy: { name: string; profileImageUrl: string | null };
  isRead: boolean;
  createdAt: string;
}

interface NotifItem {
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
}

interface FriendInfo { id: string; name: string; profileImageUrl: string | null; enrollmentNo?: string | null; }
interface ChatListItem { id: string; type: 'global' | 'direct' | 'group'; title: string; userId?: string; groupId?: string; profileImageUrl?: string | null; lastMessageAt?: string; }
interface GroupInfo { id: string; name: string; profileImageUrl: string | null; createdByUserId: string; isCreator: boolean; members: FriendInfo[]; }
interface FriendReq { id: string; senderId: string; senderName: string; senderImage: string | null; createdAt: string; }
interface BookmarkItem { id: string; questionId: string; subjectName: string; questionType: string; questionHtml: string; correctAnswer: string; }
interface ForwardedQuestion { id: string; questionHtml: string; subjectName: string; questionType: string; correctAnswer: string; option1: string; option2: string; option3: string; option4: string; solutionHtml?: string; }
interface GifItem { id: string; url: string; previewUrl: string; }
interface GiphyResultItem { id: string; images?: { original?: { url?: string }; fixed_width?: { url?: string }; fixed_width_still?: { url?: string } }; }


function rich(raw: string): string {
  if (!raw) return '';
  const withMentions = raw.replace(/(^|\s)@([a-zA-Z0-9._-]{2,32})/g, '$1<span class="cr-mention">@$2</span>');
  const html = marked.parse(withMentions, { async: false }) as string;
  return renderLatexInHtml(DOMPurify.sanitize(html));
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function fmtTime(iso: string) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function fmtDate(iso: string) {
  const d = new Date(iso), t = new Date(), y = new Date(t); y.setDate(y.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}

function showDateDivider(curr: string, prev: string | null) {
  if (!prev) return true;
  return new Date(curr).toDateString() !== new Date(prev).toDateString();
}

function sameCluster(a: ChatMsg | null, b: ChatMsg | null) {
  if (!a || !b) return false;
  if (a.userId !== b.userId) return false;
  if (new Date(a.createdAt).toDateString() !== new Date(b.createdAt).toDateString()) return false;
  return Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) <= 3 * 60 * 1000;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '💀', '😭', '🔥', '🎉', '🙏'];
const RECENT_EMOJI_KEY = 'chat_recent_emojis_v1';
const EMOJI_CATALOG = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😋','😛','😝','🫠','🤗','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','😵','🤯','🥴','😎','🤓','🧐','😕','🫤','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👻','👽','🤖','🎃','😺','😸','😹','😻','🙈','🙉','🙊','💋','💘','💝','💖','💗','💓','💞','💕','💟','❣️','💔','❤️','🩷','🧡','💛','💚','💙','🩵','💜','🤎','🖤','🩶','🤍','💯','💢','💥','💫','💦','💨','🕳️','💬','🗯️','👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🔥','✨','⭐','🌟','💤','🎉','🎊','✅','❌','❗','❓','💡','📌','📍','🚀'];

function getRecentEmojis() {
  if (typeof window === 'undefined') return QUICK_REACTIONS;
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) || '[]');
    if (!Array.isArray(parsed)) return QUICK_REACTIONS;
    return [...new Set(parsed.filter((item: unknown): item is string => typeof item === 'string'))].slice(0, 12);
  } catch {
    return QUICK_REACTIONS;
  }
}

function rememberEmoji(emoji: string) {
  if (typeof window === 'undefined') return;
  const next = [emoji, ...getRecentEmojis().filter((e) => e !== emoji)].slice(0, 16);
  localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
}
type SidebarTab = 'chats' | 'friends' | 'blocked';
const FRIEND_REQUEST_RESOLVED_EVENT = 'chat:friend-request-resolved';


function MediaLightbox({ src, type, onClose }: { src: string; type: string; onClose: () => void }) {
  return (
    <div className="cr-lightbox" onClick={onClose}>
      <button className="cr-lightbox-close" onClick={onClose}><X size={20} /></button>
      <div className="cr-lightbox-body" onClick={e => e.stopPropagation()}>
        {type === 'video' ? (
          <video src={src} controls autoPlay className="cr-lightbox-media" />
        ) : (
          <img src={src} alt="" className="cr-lightbox-media" />
        )}
      </div>
    </div>
  );
}


function ForwardedQuestionCard({ questionId, onImageClick }: { questionId: string; onImageClick: (src: string) => void }) {
  const [q, setQ] = useState<ForwardedQuestion | null>(null);
  const loaded = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    chatApi(`get-forwarded-question&questionId=${encodeURIComponent(questionId)}`).then(d => {
      if (d.success) setQ(d.question);
    });
  }, [questionId]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) return;
    const images = Array.from(container.querySelectorAll('img'));
    const handlers = images.map(image => {
      const onClick = () => onImageClick(image.src);
      image.classList.add('cr-fwd-card-image');
      image.addEventListener('click', onClick);
      return { image, onClick };
    });
    return () => {
      handlers.forEach(({ image, onClick }) => image.removeEventListener('click', onClick));
    };
  }, [onImageClick, q?.questionHtml]);

  if (!q) return <div className="cr-fwd-card cr-fwd-card--loading"><BookOpen size={13} /> Loading question…</div>;

  return (
    <div className="cr-fwd-card">
      <div className="cr-fwd-card-head">
        <BookOpen size={12} />
        <span className="cr-fwd-card-subject">{q.subjectName || 'Question'}</span>
        <span className="cr-fwd-card-type">{q.questionType}</span>
      </div>
      <div
        ref={bodyRef}
        className="cr-fwd-card-body question-html"
        dangerouslySetInnerHTML={{ __html: rich(q.questionHtml || '') }}
      />
      {q.correctAnswer && (
        <div className="cr-fwd-card-answer">Answer: <strong>{q.correctAnswer}</strong></div>
      )}
    </div>
  );
}


const ChatBubble = memo(function ChatBubble({
  msg, isOwn, canPinMessages, canEdit, userId, onDelete, onPin, onMedia, onReact, onEdit, onReply, showAvatar, showMeta,
}: {
  msg: ChatMsg;
  isOwn: boolean;
  canPinMessages: boolean;
  canEdit: boolean;
  userId: string;
  onDelete: (id: string) => void;
  onPin: (id: string, p: boolean) => void;
  onMedia: (src: string, type: string) => void;
  onReact: (id: string, emoji: string) => void;
  onEdit: (id: string, content: string) => void;
  onReply: (message: ChatMsg) => void;
  showAvatar: boolean;
  showMeta: boolean;
}) {
  const [showActions, setShowActions] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const time = fmtTime(msg.createdAt);
  const hasText = msg.content.length > 0;
  const hasAttach = Boolean(msg.attachmentUrl);
  const hasFwd = Boolean(msg.forwardedQuestionId);
  const isGifAttachment = Boolean(hasAttach && msg.attachmentType === 'image' && msg.attachmentUrl && (/^data:image\/gif;base64,/i.test(msg.attachmentUrl) || /\.gif(\?.*)?$/i.test(msg.attachmentUrl)));
  const isMediaOnly = hasAttach && !hasText && !hasFwd;
  const readCount = typeof msg.readCount === 'number' ? msg.readCount : msg.readBy.filter(id => id !== msg.userId).length;
  const deliveryState: 'sending' | 'sent' | 'delivered' | 'read' | null = isOwn
    ? (readCount > 0
      ? 'read'
      : (msg.clientStatus ?? (msg.chatType === 'direct' ? 'delivered' : 'sent')))
    : null;
  const messageHtml = useMemo(() => (hasText ? rich(msg.content) : ''), [hasText, msg.content]);
  const [reactionSearch, setReactionSearch] = useState('');
  const recentReactions = useMemo(() => getRecentEmojis(), [showReactions]);
  const filteredReactions = useMemo(
    () => EMOJI_CATALOG.filter((emoji) => emoji.includes(reactionSearch.trim())).slice(0, 220),
    [reactionSearch]
  );

  return (
    <div
      className={`cr-bubble-row ${isOwn ? 'cr-bubble-row--own' : 'cr-bubble-row--other'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowReactions(false); }}
    >
      {!isOwn && (
        <div className="cr-bubble-avatar-slot">
          {showAvatar ? (
            <div className="cr-bubble-avatar">
              {msg.userProfileImage
                ? <img src={msg.userProfileImage} alt="" loading="lazy" />
                : <span>{(msg.userName || '?')[0].toUpperCase()}</span>}
            </div>
          ) : <div className="cr-bubble-avatar-spacer" />}
        </div>
      )}

      <div className={`cr-bubble-stack ${isOwn ? 'cr-bubble-stack--own' : 'cr-bubble-stack--other'}`}>
        <div
          className={`cr-bubble ${isOwn ? 'cr-bubble--own' : 'cr-bubble--other'} ${msg.isPinned ? 'cr-bubble--pinned' : ''} ${isMediaOnly ? 'cr-bubble--media-only' : ''} ${isGifAttachment ? 'cr-bubble--gif' : ''}`}
          onClick={() => onReply(msg)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onReply(msg);
            }
          }}
        >
          {msg.isPinned && <div className="cr-bubble-pin-tag"><Pin size={9} /> Pinned</div>}
          {!isOwn && showAvatar && <div className="cr-bubble-name">{msg.userName}</div>}

          {msg.replyToMessage && (
            <div className="cr-reply-chip">
              <span className="cr-reply-chip-author">Replying to {msg.replyToMessage.userName}</span>
              <span className="cr-reply-chip-content">
                {msg.replyToMessage.content?.trim()
                  ? msg.replyToMessage.content.slice(0, 120)
                  : msg.replyToMessage.attachmentType
                    ? `[${msg.replyToMessage.attachmentType}]`
                    : 'Message'}
              </span>
            </div>
          )}

          {hasFwd && msg.forwardedQuestionId && <ForwardedQuestionCard questionId={msg.forwardedQuestionId} onImageClick={(src) => onMedia(src, 'image')} />}

          {hasAttach && msg.attachmentUrl && (
            <div className="cr-bubble-media" onClick={(event) => { event.stopPropagation(); onMedia(msg.attachmentUrl!, msg.attachmentType || 'image'); }}>
              {msg.attachmentType === 'video' ? (
                <video src={msg.attachmentUrl} className="cr-bubble-media-content" preload="metadata" />
              ) : (
                <img src={msg.attachmentUrl} alt="" className="cr-bubble-media-content" loading="lazy" />
              )}
              <div className="cr-bubble-media-overlay">
                {msg.attachmentType === 'video' ? <Film size={18} /> : <ImageIcon size={18} />}
              </div>
            </div>
          )}

          {hasText && <div className="cr-bubble-text" dangerouslySetInnerHTML={{ __html: messageHtml }} />}

          {msg.reactions.length > 0 && (
            <div className={`cr-bubble-reactions ${isOwn ? 'cr-bubble-reactions--own' : 'cr-bubble-reactions--other'}`} onClick={(event) => event.stopPropagation()}>
              {msg.reactions.map(r => (
                <button
                  key={r.emoji}
                  className={`cr-reaction-chip ${r.reacted ? 'cr-reaction-chip--active' : ''}`}
                  onClick={() => onReact(msg.id, r.emoji)}
                >
                  <span>{r.emoji}</span>
                  <span className="cr-reaction-count">{r.count}</span>
                </button>
              ))}
            </div>
          )}

          {showActions && (
            <div className={`cr-bubble-action-bar ${isOwn ? 'cr-bubble-action-bar--left' : 'cr-bubble-action-bar--right'}`} onClick={(event) => event.stopPropagation()}>
              <button className="cr-action-btn" onClick={() => setShowReactions(!showReactions)} title="React" aria-label="React to message">
                <Smile size={13} />
              </button>
              <button className="cr-action-btn" onClick={() => onReply(msg)} title="Reply" aria-label="Reply to message">
                <Reply size={13} />
              </button>
              {canPinMessages && (
                <button className="cr-action-btn" onClick={() => onPin(msg.id, !msg.isPinned)} title={msg.isPinned ? 'Unpin' : 'Pin'} aria-label={msg.isPinned ? 'Unpin message' : 'Pin message'}>
                  <Pin size={13} />
                </button>
              )}
              {canEdit && (
                <button className="cr-action-btn" onClick={() => onEdit(msg.id, msg.content)} title="Edit" aria-label="Edit message">
                  <Pencil size={13} />
                </button>
              )}
              {isOwn && (
                <button className="cr-action-btn cr-action-btn--danger" onClick={() => onDelete(msg.id)} title="Delete" aria-label="Delete message">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}

          {showReactions && (
            <div className={`cr-reaction-picker cr-reaction-picker--panel ${isOwn ? 'cr-reaction-picker--left' : 'cr-reaction-picker--right'}`} onClick={(event) => event.stopPropagation()}>
              <div className="cr-reaction-picker-head">
                <Search size={12} />
                <input value={reactionSearch} onChange={(e) => setReactionSearch(e.target.value)} placeholder="Search emojis" />
              </div>
              <div className="cr-reaction-frequent">
                {recentReactions.map((e) => (
                  <button key={`recent-${e}`} className="cr-reaction-picker-btn" aria-label={`React with ${e}`} onClick={() => { rememberEmoji(e); onReact(msg.id, e); setShowReactions(false); }}>
                    {e}
                  </button>
                ))}
              </div>
              <div className="cr-reaction-grid">
                {filteredReactions.map(e => (
                  <button key={e} className="cr-reaction-picker-btn" aria-label={`React with ${e}`} onClick={() => { rememberEmoji(e); onReact(msg.id, e); setShowReactions(false); }}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {showMeta && (
          <div className={`cr-bubble-footer ${isOwn ? 'cr-bubble-footer--own' : 'cr-bubble-footer--other'}`}>
            <span className="cr-bubble-time">{time}</span>
            {msg.editedAt && <span className="cr-bubble-edited">Edited</span>}
            {isOwn && (
              <span className="cr-bubble-read-status" title={deliveryState === 'read' ? `Read by ${readCount}` : `Status: ${deliveryState || 'sent'}`}>
                {deliveryState === 'read' && <><CheckCheck size={12} /><span className="cr-bubble-status-text">Read</span></>}
                {deliveryState === 'delivered' && <><CheckCheck size={12} /><span className="cr-bubble-status-text">Delivered</span></>}
                {deliveryState === 'sent' && <><Check size={12} /><span className="cr-bubble-status-text">Sent</span></>}
                {deliveryState === 'sending' && <><Clock3 size={12} /><span className="cr-bubble-status-text">Sending</span></>}
              </span>
            )}
          </div>
        )}
      </div>

      {isOwn && (
        <div className="cr-bubble-avatar-slot cr-bubble-avatar-slot--own">
          {showAvatar ? (
            <div className="cr-bubble-avatar">
              {msg.userProfileImage
                ? <img src={msg.userProfileImage} alt="" loading="lazy" />
                : <span>{(msg.userName || '?')[0].toUpperCase()}</span>}
            </div>
          ) : <div className="cr-bubble-avatar-spacer" />}
        </div>
      )}
    </div>
  );
});


function AnnouncementCard({ a, onMarkRead, isOwner, onDelete }: {
  a: Announcement; onMarkRead: (id: string) => void; isOwner: boolean; onDelete: (id: string) => void;
}) {
  return (
    <div className={`cr-ann-card ${a.isRead ? 'cr-ann-card--read' : ''}`}>
      <div className="cr-ann-card-head">
        <div className="cr-ann-card-icon"><Megaphone size={14} /></div>
        <div className="cr-ann-card-meta">
          <span className="cr-ann-card-title">{a.title}</span>
          <span className="cr-ann-card-date">{fmtDate(a.createdAt)} &middot; {a.createdBy.name}</span>
        </div>
        <div className="cr-ann-card-actions">
          {!a.isRead && <button className="cr-action-btn" onClick={() => onMarkRead(a.id)} title="Mark read"><Check size={13} /></button>}
          {a.isRead && <span className="cr-ann-read-icon"><CheckCheck size={13} /></span>}
          {isOwner && <button className="cr-action-btn cr-action-btn--danger" onClick={() => onDelete(a.id)} title="Delete"><Trash2 size={11} /></button>}
        </div>
      </div>
      <div className="cr-ann-card-body" dangerouslySetInnerHTML={{ __html: rich(a.content) }} />
    </div>
  );
}


function BookmarkPicker({ onSelect, onClose }: { onSelect: (qId: string) => void; onClose: () => void }) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chatApi('get-bookmarks').then(d => {
      if (d.success) setBookmarks(d.bookmarks);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal cr-bookmark-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title"><BookOpen size={16} /> Forward a Question</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><span className="spinner" /></div>
          ) : bookmarks.length === 0 ? (
            <div className="cr-empty" style={{ padding: '2rem 0' }}>
              <BookOpen size={28} />
              <span>No bookmarked questions</span>
            </div>
          ) : (
            <div className="cr-bookmark-list">
              {bookmarks.map(b => (
                <button key={b.id} className="cr-bookmark-item" onClick={() => { onSelect(b.questionId); onClose(); }}>
                  <div className="cr-bookmark-item-subject">{b.subjectName || 'Unknown'}</div>
                  <div className="cr-bookmark-item-preview question-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(b.questionHtml) }} />
                  <div className="cr-bookmark-item-meta">{b.questionType} &middot; Answer: {b.correctAnswer}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}



function GroupModal({ mode, group, onClose, onSaved }: { mode: 'create' | 'settings'; group?: GroupInfo | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(group?.name || '');
  const [profileImageUrl, setProfileImageUrl] = useState(group?.profileImageUrl || '');
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    chatApi('get-friends').then((d) => { if (d.success) setFriends(d.friends); });
    if (mode === 'settings' && group?.id) {
      chatApi(`get-group-details&groupId=${encodeURIComponent(group.id)}`).then((d) => {
        if (d.success) {
          setName(d.group.name || '');
          setProfileImageUrl(d.group.profileImageUrl || '');
        }
      });
    }
  }, [group?.id, mode]);

  const submit = async () => {
    setLoading(true);
    if (mode === 'create') {
      await chatPost('create-group', { name, profileImageUrl, memberIds: selectedIds });
    } else if (group?.id) {
      const currentMembers = new Set((group.members || []).map((m) => m.id));
      const addMemberIds = selectedIds.filter((id) => !currentMembers.has(id));
      const removeMemberIds = group.members.filter((m) => m.id !== group.createdByUserId && !selectedIds.includes(m.id)).map((m) => m.id);
      await chatPost('update-group', { groupId: group.id, name, profileImageUrl, addMemberIds, removeMemberIds });
    }
    setLoading(false);
    onSaved();
    onClose();
  };


  const handleProfileImageUpload = async (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/gif'].includes(file.type)) {
      return;
    }
    try {
      const dataUrl = await fileToDataUri(file);
      setProfileImageUrl(dataUrl);
    } catch {
      // ignore upload errors for now
    }
  };

  const memberPool = mode === 'create' ? friends : friends;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal cr-bookmark-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{mode === 'create' ? 'Create Group Chat' : 'Group Settings'}</h2>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="cr-form-group"><label className="cr-form-label">Name</label><input className="cr-form-input" value={name} onChange={e => setName(e.target.value)} maxLength={80} /></div>
          <div className="cr-form-group"><label className="cr-form-label">Profile image URL / upload (PNG or GIF)</label><input className="cr-form-input" value={profileImageUrl} onChange={e => setProfileImageUrl(e.target.value)} placeholder="https://..." /><input className="cr-form-input" type="file" accept="image/png,image/gif" onChange={e => { handleProfileImageUpload(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} /></div>
          <div className="cr-form-group">
            <label className="cr-form-label">Members (max 50)</label>
            <div className="cr-social-list" style={{ maxHeight: 220, overflow: 'auto' }}>
              {memberPool.map((f) => {
                const forced = mode === 'settings' && f.id === group?.createdByUserId;
                const checked = forced || selectedIds.includes(f.id) || (mode === 'settings' && Boolean(group?.members.some((m) => m.id === f.id)));
                return (
                  <label key={f.id} className="cr-social-row" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} disabled={forced} onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...new Set([...prev, f.id])] : prev.filter((id) => id !== f.id))} />
                    <span className="cr-social-name">{f.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="modal-actions">
            <button className="cr-btn cr-btn--secondary" onClick={onClose}>Cancel</button>
            <button className="cr-btn cr-btn--primary" onClick={submit} disabled={loading || !name.trim()}>{loading ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatSidebar({
  activeTab,
  onTabChange,
  collapsed,
  onToggleCollapse,
  chatList,
  activeChatId,
  onSelectChat,
  onOpenDirectChat,
  onCreateGroup,
}: {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  chatList: ChatListItem[];
  activeChatId: string;
  onSelectChat: (chat: ChatListItem) => void;
  onOpenDirectChat: (friend: FriendInfo) => void;
  onCreateGroup: () => void;
}) {
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [requests, setRequests] = useState<FriendReq[]>([]);
  const [blocked, setBlocked] = useState<FriendInfo[]>([]);
  const [privacy, setPrivacy] = useState('everyone');
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<FriendInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [f, r, b, p] = await Promise.all([
      chatApi('get-friends'),
      chatApi('get-friend-requests'),
      chatApi('get-blocked'),
      chatApi('get-privacy'),
    ]);
    if (f.success) setFriends(f.friends);
    if (r.success) setRequests(r.requests);
    if (b.success) setBlocked(b.blocked);
    if (p.success) setPrivacy(p.chatPrivacy);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const doSearch = useCallback(async () => {
    if (searchQ.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const d = await chatApi(`search-users&q=${encodeURIComponent(searchQ.trim())}`);
    if (d.success) setSearchResults(d.users);
    setSearching(false);
  }, [searchQ]);

  const sendRequest = async (targetId: string) => {
    await chatPost('send-friend-request', { targetUserId: targetId });
    setSearchResults(prev => prev.filter(u => u.id !== targetId));
    loadAll();
  };

  const respondRequest = async (reqId: string, response: string) => {
    await chatPost('respond-friend-request', { requestId: reqId, response });
    window.dispatchEvent(new CustomEvent(FRIEND_REQUEST_RESOLVED_EVENT, { detail: { requestId: reqId } }));
    loadAll();
  };

  const removeFriend = async (friendId: string) => {
    await chatPost('remove-friend', { friendId });
    setFriends(prev => prev.filter(f => f.id !== friendId));
  };

  const blockUser = async (targetId: string) => {
    await chatPost('block-user', { targetUserId: targetId });
    loadAll();
  };

  const unblockUser = async (targetId: string) => {
    await chatPost('unblock-user', { targetUserId: targetId });
    setBlocked(prev => prev.filter(b => b.id !== targetId));
  };

  const changePrivacy = async (val: string) => {
    setPrivacy(val);
    await chatPost('set-privacy', { chatPrivacy: val });
  };

  const visibleResults = searchResults.filter(u => {
    if (activeTab === 'friends') return !friends.some(f => f.id === u.id) && !blocked.some(b => b.id === u.id);
    return !blocked.some(b => b.id === u.id);
  });

  return (
    <aside className={`cr-sidebar ${collapsed ? 'cr-sidebar--collapsed' : ''}`}>
      <div className="cr-sidebar-tabs">
        <button
          className="cr-sidebar-collapse"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
        <button className={`cr-sidebar-tab ${activeTab === 'chats' ? 'cr-sidebar-tab--active' : ''}`} onClick={() => onTabChange('chats')} title="Chats" aria-label="Chats">
          <MessageCircle size={15} />
        </button>
        <button className={`cr-sidebar-tab ${activeTab === 'friends' ? 'cr-sidebar-tab--active' : ''}`} onClick={() => onTabChange('friends')} title="Friends list" aria-label="Friends list">
          <Users size={15} />
        </button>
        <button className={`cr-sidebar-tab ${activeTab === 'blocked' ? 'cr-sidebar-tab--active' : ''}`} onClick={() => onTabChange('blocked')} title="Blocked list" aria-label="Blocked list">
          <Shield size={15} />
        </button>
      </div>

      <div className="cr-sidebar-body">
        <div className="cr-social-privacy">
          <span className="cr-social-privacy-label"><Shield size={13} /> Chat privacy</span>
          <div className="cr-social-privacy-btns">
            <button className={`cr-pill ${privacy === 'everyone' ? 'cr-pill--active' : ''}`} onClick={() => changePrivacy('everyone')}>Everyone</button>
            <button className={`cr-pill ${privacy === 'friends' ? 'cr-pill--active' : ''}`} onClick={() => changePrivacy('friends')}>Friends only</button>
          </div>
        </div>

        {activeTab !== 'chats' && (
          <div className="cr-social-search">
            <div className="cr-social-search-bar">
              <input
                className="cr-form-input"
                placeholder="Search by username or enrollment no…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
              />
              <button className="cr-search-btn" onClick={doSearch} disabled={searching || searchQ.trim().length < 2}>
                {searching ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <Search size={14} />}
              </button>
            </div>
            {visibleResults.length > 0 && (
              <div className="cr-social-list">
                {visibleResults.map(u => (
                  <div key={u.id} className="cr-social-row">
                    <div className="cr-social-avatar">
                      {u.profileImageUrl ? <img src={u.profileImageUrl} alt="" /> : <span>{u.name[0]?.toUpperCase()}</span>}
                    </div>
                    <div className="cr-social-meta">
                      <span className="cr-social-name">{u.name}</span>
                      {u.enrollmentNo && <span className="cr-social-sub">{u.enrollmentNo}</span>}
                    </div>
                    <div className="cr-social-row-actions">
                      {activeTab === 'friends' ? (
                        <button className="cr-action-btn" onClick={() => sendRequest(u.id)} title="Send request"><UserPlus size={13} /></button>
                      ) : (
                        <button className="cr-action-btn cr-action-btn--danger" onClick={() => blockUser(u.id)} title="Block"><Shield size={13} /></button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><span className="spinner" /></div>
        ) : (
          <>
            {activeTab === 'friends' && (
              <>
                <div className="cr-sidebar-section">
                  <button className="cr-btn cr-btn--primary" onClick={onCreateGroup}><Plus size={13} /> Create group chat</button>
                </div>
                {requests.length > 0 && (
                  <div className="cr-sidebar-section">
                    <h4>Pending requests</h4>
                    <div className="cr-social-list">
                      {requests.map(r => (
                        <div key={r.id} className="cr-social-row">
                          <div className="cr-social-avatar">
                            {r.senderImage ? <img src={r.senderImage} alt="" /> : <span>{r.senderName[0]?.toUpperCase()}</span>}
                          </div>
                          <span className="cr-social-name">{r.senderName}</span>
                          <div className="cr-social-row-actions">
                            <button className="cr-action-btn" onClick={() => respondRequest(r.id, 'accept')} title="Accept"><UserCheck size={13} /></button>
                            <button className="cr-action-btn cr-action-btn--danger" onClick={() => respondRequest(r.id, 'reject')} title="Reject"><X size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="cr-sidebar-section">
                  <h4>Friends ({friends.length})</h4>
                  {friends.length === 0 ? (
                    <div className="cr-empty" style={{ padding: '1rem 0' }}><Users size={20} /><span>No friends yet</span></div>
                  ) : (
                    <div className="cr-social-list">
                      {friends.map(f => (
                        <div key={f.id} className="cr-social-row">
                          <div className="cr-social-avatar">
                            {f.profileImageUrl ? <img src={f.profileImageUrl} alt="" /> : <span>{f.name[0]?.toUpperCase()}</span>}
                          </div>
                          <div className="cr-social-meta">
                            <span className="cr-social-name">{f.name}</span>
                            {f.enrollmentNo && <span className="cr-social-sub">{f.enrollmentNo}</span>}
                          </div>
                          <div className="cr-social-row-actions">
                            <button className="cr-action-btn" onClick={() => onOpenDirectChat(f)} title="Open personal chat"><MessageCircle size={13} /></button>
                            <button className="cr-action-btn cr-action-btn--danger" onClick={() => removeFriend(f.id)} title="Remove"><UserX size={13} /></button>
                            <button className="cr-action-btn cr-action-btn--danger" onClick={() => blockUser(f.id)} title="Block"><Shield size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'blocked' && (
              <div className="cr-sidebar-section">
                <h4>Blocked users ({blocked.length})</h4>
                {blocked.length === 0 ? (
                  <div className="cr-empty" style={{ padding: '1rem 0' }}><Shield size={20} /><span>No blocked users</span></div>
                ) : (
                  <div className="cr-social-list">
                    {blocked.map(b => (
                      <div key={b.id} className="cr-social-row">
                        <div className="cr-social-avatar">
                          {b.profileImageUrl ? <img src={b.profileImageUrl} alt="" /> : <span>{b.name[0]?.toUpperCase()}</span>}
                        </div>
                        <span className="cr-social-name">{b.name}</span>
                        <button className="cr-action-btn" onClick={() => unblockUser(b.id)} title="Unblock"><UserCheck size={13} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'chats' && (
              <div className="cr-sidebar-section">
                <h4>Chat list</h4>
                {(['global', 'group', 'direct'] as const).map((kind) => {
                  const sectionItems = chatList.filter((item) => item.type === kind);
                  if (sectionItems.length === 0) return null;
                  const label = kind === 'global' ? 'Global' : kind === 'group' ? 'Group' : 'Friends';
                  return (
                    <div key={kind} className="cr-chat-subdivision">
                      <div className="cr-chat-subdivision-title">{label}</div>
                      <div className="cr-social-list">
                        {sectionItems.map(item => (
                          <button key={item.id} className={`cr-social-row cr-social-row--chat ${activeChatId === item.id ? 'cr-social-row--chat-active' : ''}`} onClick={() => onSelectChat(item)}>
                            <div className="cr-social-avatar">
                              {item.profileImageUrl ? <img src={item.profileImageUrl} alt="" /> : <span>{item.title[0]?.toUpperCase()}</span>}
                            </div>
                            <div className="cr-social-meta">
                              <span className="cr-social-name">{item.title}</span>
                              <span className="cr-social-sub">{item.type === 'global' ? 'Community room' : item.type === 'group' ? 'Group chat' : 'Personal chat'}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}


export default function ChatRoom({ onBack, userId, isOwner }: {
  onBack: () => void; userId: string; isOwner: boolean;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [input, setInput] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMsg | null>(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tab, setTab] = useState<'chat' | 'announcements'>('chat');
  const [error, setError] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; type: string } | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [showNewAnn, setShowNewAnn] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [creatingAnn, setCreatingAnn] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showBookmarkPicker, setShowBookmarkPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<GiphyResultItem[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [starredGifs, setStarredGifs] = useState<GifItem[]>([]);
  const [showPinnedPanel, setShowPinnedPanel] = useState(false);
  const [densityMode, setDensityMode] = useState<'comfortable' | 'compact'>('comfortable');
  const [chatList, setChatList] = useState<ChatListItem[]>([{ id: 'global', type: 'global', title: 'Global Chat' }]);
  const [activeChat, setActiveChat] = useState<ChatListItem>({ id: 'global', type: 'global', title: 'Global Chat' });
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupInfo, setGroupInfo] = useState<GroupInfo | null>(null);
  const [showGroupSettings, setShowGroupSettings] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pusherRef = useRef<Pusher | null>(null);
  const channelRef = useRef<Channel | null>(null);
  const lastTimeRef = useRef<string | null>(null);
  const atBottomRef = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gifPanelRef = useRef<HTMLDivElement>(null);
  const readMarkedRef = useRef<Set<string>>(new Set());

  const loadGifs = useCallback(async (query: string) => {
    setGifLoading(true);
    try {
      const q = query.trim();
      const endpoint = `search-gifs&q=${encodeURIComponent(q)}`;
      const data = await chatApi(endpoint);
      if (!data.success) {
        setGifResults([]);
        return;
      }
      setGifResults(Array.isArray(data.gifs) ? data.gifs : []);
    } catch {
      setGifResults([]);
    } finally {
      setGifLoading(false);
    }
  }, []);

  const loadFavoriteGifs = useCallback(async () => {
    try {
      const data = await chatApi('get-favorite-gifs');
      if (data.success && Array.isArray(data.gifs)) {
        setStarredGifs(data.gifs.slice(0, 24));
      }
    } catch {
      setStarredGifs([]);
    }
  }, []);

  useEffect(() => {
    loadFavoriteGifs();
  }, [loadFavoriteGifs]);

  useEffect(() => () => {
    if (channelRef.current) channelRef.current.unbind_all();
    if (pusherRef.current) {
      pusherRef.current.disconnect();
      pusherRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!showGifPicker) return;
    loadGifs(gifQuery);
  }, [showGifPicker, gifQuery, loadGifs]);

  useEffect(() => {
    if (!showGifPicker) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!gifPanelRef.current) return;
      if (gifPanelRef.current.contains(event.target as Node)) return;
      setShowGifPicker(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showGifPicker]);

  const scrollToBottom = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollDown(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current; if (!el) return;
    const at = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    atBottomRef.current = at;
    setShowScrollDown(!at);
  }, []);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current; if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const d = await chatApi(`get-messages&limit=120&chatType=${activeChat.type}${activeChat.userId ? `&targetUserId=${encodeURIComponent(activeChat.userId)}` : ''}${activeChat.groupId ? `&groupId=${encodeURIComponent(activeChat.groupId)}` : ''}`);
      if (d.success) {
        setMessages(d.messages);
        readMarkedRef.current.clear();
        setHasMore(d.hasMore);
        if (d.messages.length > 0) lastTimeRef.current = d.messages[d.messages.length - 1].createdAt;
      }
    } catch {} finally { setLoading(false); }
  }, [activeChat]);

  const loadOlder = useCallback(async () => {
    if (!hasMore || messages.length === 0 || loadingMore) return;
    setLoadingMore(true);
    const oldest = messages[0].createdAt;
    try {
      const d = await chatApi(`get-messages&limit=120&cursor=${encodeURIComponent(oldest)}&chatType=${activeChat.type}${activeChat.userId ? `&targetUserId=${encodeURIComponent(activeChat.userId)}` : ''}${activeChat.groupId ? `&groupId=${encodeURIComponent(activeChat.groupId)}` : ''}`);
      if (d.success) { setMessages(prev => [...d.messages, ...prev]); setHasMore(d.hasMore); }
    } catch {} finally { setLoadingMore(false); }
  }, [hasMore, messages, loadingMore, activeChat]);

  const activeChatKey = useMemo(() => {
    if (activeChat.type === 'direct' && activeChat.userId) {
      const [left, right] = [userId, activeChat.userId].sort();
      return `direct:${left}:${right}`;
    }
    if (activeChat.type === 'group' && activeChat.groupId) return `group:${activeChat.groupId}`;
    return 'global';
  }, [activeChat, userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem(`chat_density_${activeChatKey}`);
    setDensityMode(saved === 'compact' ? 'compact' : 'comfortable');
  }, [activeChatKey]);

  const toggleDensity = useCallback(() => {
    setDensityMode((prev) => {
      const next = prev === 'comfortable' ? 'compact' : 'comfortable';
      if (typeof window !== 'undefined') {
        localStorage.setItem(`chat_density_${activeChatKey}`, next);
      }
      return next;
    });
  }, [activeChatKey]);

  const firstUnreadMessageId = useMemo(() => {
    const first = messages.find((m) => m.userId !== userId && !(m.isReadByCurrent ?? m.readBy.includes(userId)));
    return first?.id || null;
  }, [messages, userId]);

  const loadAnnouncements = useCallback(async () => {
    try {
      const d = await chatApi('get-announcements');
      if (d.success) setAnnouncements(d.announcements);
    } catch {}
  }, []);

  const markMessagesRead = useCallback(async (msgIds: string[]) => {
    if (msgIds.length === 0) return;
    await chatPost('mark-messages-read', { messageIds: msgIds });
  }, []);

  const loadChatList = useCallback(async () => {
    const d = await chatApi('get-chat-list');
    if (d.success) setChatList(d.chats);
  }, []);

  useEffect(() => { loadMessages(); loadAnnouncements(); loadChatList(); }, [loadMessages, loadAnnouncements, loadChatList]);

  useEffect(() => {
    if (activeChat.type !== 'group' || !activeChat.groupId) {
      setGroupInfo(null);
      return;
    }
    chatApi(`get-group-details&groupId=${encodeURIComponent(activeChat.groupId)}`).then((d) => {
      if (d.success) setGroupInfo(d.group);
    });
  }, [activeChat]);
  useEffect(() => {
    chatPost('set-active-chat', { chatKey: activeChatKey, active: true }).catch(() => undefined);
    return () => {
      chatPost('set-active-chat', { chatKey: activeChatKey, active: false }).catch(() => undefined);
    };
  }, [activeChatKey]);

  useEffect(() => {
    let mounted = true;
    let localChannel: Channel | null = null;

    const disconnectChannel = () => {
      if (channelRef.current) {
        channelRef.current.unbind_all();
        if (pusherRef.current) pusherRef.current.unsubscribe(channelRef.current.name);
      }
      channelRef.current = null;
    };

    const setupRealtime = async () => {
      try {
        const config = await chatApi('realtime-config');
        if (!mounted || !config?.success || !config.enabled || !config.key || !config.cluster) return;

        if (!pusherRef.current) {
          pusherRef.current = new Pusher(config.key, {
            cluster: config.cluster,
            channelAuthorization: {
              transport: 'ajax',
              endpoint: `${API_BASE}/chat?action=pusher-auth`,
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
              },
            },
          });
        }

        disconnectChannel();

        const channelName = activeChat.type === 'direct' && activeChat.userId
          ? `private-chat-direct-${[userId, activeChat.userId].sort().join('-')}`
          : activeChat.type === 'group' && activeChat.groupId
            ? `private-chat-group-${activeChat.groupId}`
            : 'private-chat-global';

        localChannel = pusherRef.current.subscribe(channelName);
        channelRef.current = localChannel;

        localChannel.bind('chat.message.created', (payload: { message?: ChatMsg }) => {
          if (!payload?.message) return;
          setMessages(prev => {
            if (prev.some((item) => item.id === payload.message!.id)) return prev;
            const next = [...prev, payload.message!];
            lastTimeRef.current = payload.message!.createdAt;
            return next;
          });
          loadChatList();
          if (atBottomRef.current) setTimeout(scrollToBottom, 50);
        });

        localChannel.bind('chat.message.updated', (payload: { message?: ChatMsg }) => {
          if (!payload?.message) return;
          setMessages(prev => prev.map(item => (item.id === payload.message!.id ? payload.message! : item)));
          loadChatList();
        });

        localChannel.bind('chat.message.deleted', (payload: { messageId?: string }) => {
          if (!payload?.messageId) return;
          setMessages(prev => prev.filter(item => item.id !== payload.messageId));
          loadChatList();
        });

        localChannel.bind('chat.message.read', (payload: { messageId?: string; readByUserId?: string }) => {
          if (!payload?.messageId || !payload.readByUserId) return;
          setMessages(prev => prev.map((item) => {
            if (item.id !== payload.messageId) return item;
            if (item.readBy.includes(payload.readByUserId!)) return item;
            return { ...item, readBy: [...item.readBy, payload.readByUserId!] };
          }));
        });
      } catch {}
    };

    setupRealtime();

    return () => {
      mounted = false;
      if (localChannel) {
        localChannel.unbind_all();
      }
      disconnectChannel();
    };
  }, [activeChat, loadChatList, scrollToBottom, userId]);
  useEffect(() => {
    if (!loading && messages.length > 0) {
      setTimeout(scrollToBottom, 100);
    }
  }, [loading, messages.length, scrollToBottom]);

  useEffect(() => {
    let mounted = true;
    let userChannel: Channel | null = null;

    const setupUserChannel = async () => {
      try {
        const config = await chatApi('realtime-config');
        if (!mounted || !config?.success || !config.enabled || !config.key || !config.cluster) return;
        if (!pusherRef.current) {
          pusherRef.current = new Pusher(config.key, {
            cluster: config.cluster,
            channelAuthorization: {
              transport: 'ajax',
              endpoint: `${API_BASE}/chat?action=pusher-auth`,
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
              },
            },
          });
        }
        const channelName = `private-user-${userId}`;
        userChannel = pusherRef.current.subscribe(channelName);
        userChannel.bind('chat.group.updated', () => {
          loadChatList();
          if (activeChat.type === 'group' && activeChat.groupId) {
            chatApi(`get-group-details&groupId=${encodeURIComponent(activeChat.groupId)}`).then((d) => {
              if (d.success) setGroupInfo(d.group);
            });
          }
        });
      } catch {}
    };

    setupUserChannel();

    return () => {
      mounted = false;
      if (userChannel) {
        userChannel.unbind_all();
        if (pusherRef.current) pusherRef.current.unsubscribe(userChannel.name);
      }
    };
  }, [activeChat.groupId, activeChat.type, loadChatList, userId]);


  useEffect(() => {
    const unread = messages
      .filter(m => m.userId !== userId && !(m.isReadByCurrent ?? m.readBy.includes(userId)) && !readMarkedRef.current.has(m.id))
      .map(m => m.id);
    if (unread.length > 0 && atBottomRef.current) markMessagesRead(unread);
    unread.forEach(id => readMarkedRef.current.add(id));
  }, [messages, markMessagesRead, userId]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    e.target.value = '';
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setError('Only images and videos.'); return;
    }
    try {
      setAttachmentPreview(await fileToDataUri(file));
      setAttachmentFile(file);
      setError('');
    } catch { setError('Failed to read file.'); }
  }, []);

  const removeAttachment = useCallback(() => { setAttachmentPreview(null); setAttachmentFile(null); }, []);

  const toggleStarredGif = useCallback((gif: GifItem) => {
    setStarredGifs(prev => {
      const next = prev.some(item => item.id === gif.id)
        ? prev.filter(item => item.id !== gif.id)
        : [gif, ...prev].slice(0, 24);
      chatPost('set-favorite-gifs', { gifs: next }).catch(() => undefined);
      return next;
    });
  }, []);

  const handleGifSend = useCallback(async (gifUrl: string) => {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const body: Record<string, string> = { attachment: gifUrl, chatType: activeChat.type };
      if (activeChat.userId) body.targetUserId = activeChat.userId;
      if (activeChat.groupId) body.groupId = activeChat.groupId;
      const d = await chatPost('send-message', body);
      if (d.success) {
        setMessages(prev => {
          if (prev.some(m => m.id === d.message.id)) return prev;
          const next = [...prev, d.message];
          lastTimeRef.current = d.message.createdAt;
          return next;
        });
        setShowGifPicker(false);
        loadChatList();
        setTimeout(scrollToBottom, 50);
      } else {
        setError(d.error || 'Failed to send GIF');
      }
    } catch {
      setError('Network error');
    } finally {
      setSending(false);
    }
  }, [sending, activeChat.type, activeChat.userId, activeChat.groupId, loadChatList, scrollToBottom]);

  const handleSend = async (forwardedQuestionId?: string) => {
    const text = input.trim();
    const hasText = text.length > 0;
    const hasAttach = Boolean(attachmentPreview);
    const hasFwd = Boolean(forwardedQuestionId);
    if ((!hasText && !hasAttach && !hasFwd) || sending) return;

    setSending(true);
    setInput('');
    setError('');

    try {
      if (editingMessageId) {
        const d = await chatPost('edit-message', { messageId: editingMessageId, content: text });
        if (d.success) {
          setMessages(prev => prev.map(m => m.id === editingMessageId ? d.message : m));
          setEditingMessageId(null);
          return;
        }
        setError(d.error || 'Failed to edit message');
        setInput(text);
        return;
      }

      const body: Record<string, string> = {};
      if (hasText) body.content = text;
      if (hasAttach && attachmentPreview) body.attachment = attachmentPreview;
      if (hasFwd && forwardedQuestionId) body.forwardedQuestionId = forwardedQuestionId;
      if (!hasFwd && replyTarget?.id) body.replyToMessageId = replyTarget.id;
      body.chatType = activeChat.type;
      if (activeChat.userId) body.targetUserId = activeChat.userId;
      if (activeChat.groupId) body.groupId = activeChat.groupId;

      const d = await chatPost('send-message', body);
      if (d.success) {
        setMessages(prev => {
          if (prev.some(m => m.id === d.message.id)) return prev;
          const next = [...prev, d.message];
          lastTimeRef.current = d.message.createdAt;
          return next;
        });
        removeAttachment();
        loadChatList();
        setTimeout(scrollToBottom, 50);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        if (!hasFwd) setReplyTarget(null);
      } else {
        setError(d.error || 'Failed to send');
        if (hasText) setInput(text);
      }
    } catch {
      setError('Network error');
      if (text) setInput(text);
    } finally { setSending(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleDelete = async (id: string) => {
    const d = await chatPost('delete-message', { messageId: id });
    if (d.success) setMessages(prev => prev.filter(m => m.id !== id));
  };

  const handlePin = async (id: string, pinned: boolean) => {
    const d = await chatPost('pin-message', { messageId: id, pinned });
    if (d.success) setMessages(prev => prev.map(m => m.id === id ? { ...m, isPinned: pinned } : m));
  };

  const handleReact = async (id: string, emoji: string) => {
    const d = await chatPost('react', { messageId: id, emoji });
    if (d.success) {
      setMessages(prev => prev.map(m => {
        if (m.id !== id) return m;
        const reactions = [...m.reactions];
        const idx = reactions.findIndex(r => r.emoji === emoji);
        if (d.action === 'added') {
          if (idx >= 0) { reactions[idx] = { ...reactions[idx], count: reactions[idx].count + 1, reacted: true }; }
          else { reactions.push({ emoji, count: 1, reacted: true }); }
        } else {
          if (idx >= 0) {
            const nr = { ...reactions[idx], count: reactions[idx].count - 1, reacted: false };
            if (nr.count <= 0) reactions.splice(idx, 1); else reactions[idx] = nr;
          }
        }
        return { ...m, reactions };
      }));
    }
  };

  const handleEdit = (id: string, content: string) => {
    setEditingMessageId(id);
    setInput(content);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleForward = (questionId: string) => handleSend(questionId);

  const handleMarkRead = async (id: string) => {
    const d = await chatPost('mark-announcement-read', { announcementId: id });
    if (d.success) setAnnouncements(prev => prev.map(a => a.id === id ? { ...a, isRead: true } : a));
  };

  const handleMarkAllRead = async () => {
    const d = await chatPost('mark-all-read', {});
    if (d.success) setAnnouncements(prev => prev.map(a => ({ ...a, isRead: true })));
  };

  const handleCreateAnn = async () => {
    if (!annTitle.trim() || !annContent.trim() || creatingAnn) return;
    setCreatingAnn(true);
    try {
      const d = await chatPost('create-announcement', { title: annTitle.trim(), content: annContent.trim() });
      if (d.success) { setAnnTitle(''); setAnnContent(''); setShowNewAnn(false); loadAnnouncements(); }
    } catch {} finally { setCreatingAnn(false); }
  };

  const handleDeleteAnn = async (id: string) => {
    const d = await chatPost('delete-announcement', { announcementId: id });
    if (d.success) setAnnouncements(prev => prev.filter(a => a.id !== id));
  };

  const unreadAnnCount = announcements.filter(a => !a.isRead).length;
  const pinnedMessages = messages.filter(m => m.isPinned && (activeChat.type === 'global' ? m.chatType === 'global' : activeChat.type === 'group' ? (m.chatType === 'group' && m.groupId === activeChat.groupId) : false));
  const canPinMessages = isOwner || (activeChat.type === 'group' && Boolean(groupInfo?.isCreator));

  return (
    <div className="cr-page">
      {lightbox && <MediaLightbox src={lightbox.src} type={lightbox.type} onClose={() => setLightbox(null)} />}
      {showBookmarkPicker && <BookmarkPicker onSelect={handleForward} onClose={() => setShowBookmarkPicker(false)} />}
      {showCreateGroup && <GroupModal mode="create" onClose={() => setShowCreateGroup(false)} onSaved={() => loadChatList()} />}
      {showGroupSettings && groupInfo?.isCreator && (
        <GroupModal
          mode="settings"
          group={groupInfo}
          onClose={() => setShowGroupSettings(false)}
          onSaved={() => {
            loadChatList();
            if (activeChat.groupId) chatApi(`get-group-details&groupId=${encodeURIComponent(activeChat.groupId)}`).then((d) => { if (d.success) setGroupInfo(d.group); });
          }}
        />
      )}
      {showNewAnn && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowNewAnn(false)}>
          <div className="modal cr-ann-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title"><Megaphone size={16} /> New Announcement</h2>
              <button className="modal-close" onClick={() => setShowNewAnn(false)}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="cr-form-group">
                <label className="cr-form-label">Title</label>
                <input className="cr-form-input" value={annTitle} onChange={e => setAnnTitle(e.target.value)} placeholder="Announcement title" maxLength={200} />
              </div>
              <div className="cr-form-group">
                <label className="cr-form-label">Content (markdown)</label>
                <textarea className="cr-form-input" value={annContent} onChange={e => setAnnContent(e.target.value)} placeholder="Write your announcement…" rows={6} maxLength={5000} style={{ resize: 'vertical' }} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewAnn(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateAnn} disabled={creatingAnn || !annTitle.trim() || !annContent.trim()}>
                {creatingAnn ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`cr-shell ${sidebarCollapsed ? "cr-shell--collapsed" : ""}`}>
        <ChatSidebar
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
          chatList={chatList}
          activeChatId={activeChat.id}
          onSelectChat={(chat) => { setActiveChat(chat); setSidebarTab('chats'); setTab('chat'); }}
          onCreateGroup={() => setShowCreateGroup(true)}
          onOpenDirectChat={(friend) => {
            const chat = { id: `direct-${friend.id}`, type: 'direct' as const, userId: friend.id, title: friend.name, profileImageUrl: friend.profileImageUrl };
            setActiveChat(chat);
            setChatList(prev => prev.some(c => c.id === chat.id) ? prev : [...prev, chat]);
            setSidebarTab('chats');
            setTab('chat');
          }}
        />
      <div className="cr-container">
        <div className="cr-header">
          <button className="cr-back-btn" onClick={onBack}><ChevronLeft size={18} /></button>
          <div className="cr-header-center">
            <Users size={16} />
            <span className="cr-header-title">{activeChat.type === 'global' ? 'Global Chat' : (activeChat.type === 'group' ? (groupInfo?.name || activeChat.title) : activeChat.title)}</span>
          </div>
          <div className="cr-tabs">
            <button className="cr-sidebar-head-toggle" onClick={() => setSidebarCollapsed(prev => !prev)} title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}>
              {sidebarCollapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
            </button>
            <button className={`cr-tab ${tab === 'chat' ? 'cr-tab--active' : ''}`} onClick={() => setTab('chat')}>Chat</button>
            <button className={`cr-tab ${tab === 'announcements' ? 'cr-tab--active' : ''}`} onClick={() => setTab('announcements')}>
              <Bell size={12} /> News
              {unreadAnnCount > 0 && <span className="cr-tab-badge">{unreadAnnCount}</span>}
            </button>
            <button className="cr-tab" onClick={toggleDensity} title={`Switch to ${densityMode === 'comfortable' ? 'compact' : 'comfortable'} mode`} aria-label="Toggle chat density mode">
              {densityMode === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          </div>
        </div>

        {tab === 'chat' && (
          <div className={`cr-chat-body ${densityMode === 'compact' ? 'cr-chat-body--compact' : ''}`}>
            {(pinnedMessages.length > 0 || activeChat.type === 'group') && (
              <div className="cr-pinned-strip">
                <button className="cr-pinned-strip-btn" onClick={() => setShowPinnedPanel(prev => !prev)}>
                  <Pin size={11} />
                  <span>{pinnedMessages.length} pinned</span>
                </button>
                {activeChat.type === 'group' && groupInfo?.isCreator && (
                  <button className="cr-pinned-strip-btn" onClick={() => setShowGroupSettings(true)}><Cog size={12} /><span>Settings</span></button>
                )}
                {showPinnedPanel && (
                  <div className="cr-pinned-panel">
                    {pinnedMessages.map(pm => (
                      <button key={pm.id} className="cr-pinned-item" onClick={() => {
                        const el = document.getElementById(`msg-${pm.id}`);
                        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        setShowPinnedPanel(false);
                      }}>
                        <span className="cr-pinned-item-name">{pm.userName}</span>
                        <span className="cr-pinned-item-text">{pm.content || (pm.attachmentType ? `[${pm.attachmentType}]` : 'Pinned message')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="cr-messages" ref={containerRef} onScroll={handleScroll}>
              {hasMore && (
                <button className="cr-load-more" onClick={loadOlder} disabled={loadingMore}>
                  {loadingMore ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Load older messages'}
                </button>
              )}

              {loading ? (
                <div className="cr-loading">
                  <span className="spinner" />
                  <div className="cr-loading-dots" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <div className="cr-empty">
                  <Users size={32} />
                  <span>No messages yet</span>
                  <span className="cr-empty-sub">Be the first to say something!</span>
                </div>
              ) : (
                messages.map((m, i) => {
                  const prev = i > 0 ? messages[i - 1] : null;
                  const next = i < messages.length - 1 ? messages[i + 1] : null;
                  const dateSep = showDateDivider(m.createdAt, prev?.createdAt ?? null);
                  const avatar = !sameCluster(prev, m) || dateSep;
                  const showMeta = !sameCluster(m, next);
                  return (
                    <div key={m.id} id={`msg-${m.id}`}>
                      {dateSep && <div className="cr-date-divider"><span>{fmtDate(m.createdAt)}</span></div>}
                      <ChatBubble
                        msg={m}
                        isOwn={m.userId === userId}
                        canPinMessages={canPinMessages}
                        canEdit={m.userId === userId || isOwner || (activeChat.type === 'group' && Boolean(groupInfo?.isCreator))}
                        userId={userId}
                        onDelete={handleDelete}
                        onPin={handlePin}
                        onMedia={(src, type) => setLightbox({ src, type })}
                        onReact={handleReact}
                        onEdit={handleEdit}
                        onReply={setReplyTarget}
                        showAvatar={avatar}
                        showMeta={showMeta}
                      />
                    </div>
                  );
                })
              )}
              <div ref={endRef} />
            </div>

            {showScrollDown && (
              <button className="cr-scroll-down" onClick={scrollToBottom}><ChevronDown size={18} /></button>
            )}

            {firstUnreadMessageId && (
              <button
                className="cr-jump-unread"
                onClick={() => document.getElementById(`msg-${firstUnreadMessageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                aria-label="Jump to first unread message"
              >
                Jump to first unread
              </button>
            )}

            {error && (
              <div className="cr-error"><span>{error}</span><button onClick={() => setError('')}><X size={14} /></button></div>
            )}

            {attachmentPreview && (
              <div className="cr-attach-preview">
                {attachmentFile?.type.startsWith('video/') ? (
                  <video src={attachmentPreview} className="cr-attach-thumb" />
                ) : (
                  <img src={attachmentPreview} alt="" className="cr-attach-thumb" />
                )}
                <div className="cr-attach-info">
                  <span className="cr-attach-name">{attachmentFile?.name}</span>
                  <span className="cr-attach-size">{attachmentFile ? `${(attachmentFile.size / (1024 * 1024)).toFixed(1)} MB` : ''}</span>
                </div>
                <button className="cr-attach-remove" onClick={removeAttachment}><X size={14} /></button>
              </div>
            )}

            <div className="cr-input-wrap">
              {showGifPicker && (
                <div className="cr-gif-panel" ref={gifPanelRef}>
                  <div className="cr-gif-panel-search">
                    <Search size={14} />
                    <input value={gifQuery} onChange={(event) => setGifQuery(event.target.value)} placeholder="Search GIFs" />
                  </div>
                  <div className="cr-gif-section">
                    <div className="cr-gif-section-title">Starred</div>
                    <div className="cr-gif-grid cr-gif-grid--starred">
                      {starredGifs.length === 0 ? <span className="cr-gif-empty">No starred GIFs yet</span> : starredGifs.map(gif => (
                        <button key={`star-${gif.id}`} className="cr-gif-item" onClick={() => handleGifSend(gif.url)}>
                          <img src={gif.previewUrl} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="cr-gif-section">
                    <div className="cr-gif-section-title">Results</div>
                    <div className="cr-gif-grid">
                      {gifLoading && <span className="cr-gif-empty">Loading…</span>}
                      {!gifLoading && gifResults.map(gif => {
                        const gifUrl = gif.images?.original?.url || gif.images?.fixed_width?.url || '';
                        const previewUrl = gif.images?.fixed_width_still?.url || gif.images?.fixed_width?.url || gifUrl;
                        if (!gifUrl || !previewUrl) return null;
                        const favoriteGif: GifItem = { id: gif.id, url: gifUrl, previewUrl };
                        const starred = starredGifs.some(item => item.id === gif.id);
                        return (
                          <div key={gif.id} className="cr-gif-card">
                            <button className="cr-gif-item" onClick={() => handleGifSend(gifUrl)}>
                              <Gif gif={gif as any} width={110} hideAttribution noLink />
                            </button>
                            <button className={`cr-gif-star ${starred ? 'active' : ''}`} onClick={() => toggleStarredGif(favoriteGif)}><Star size={12} /></button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
              {replyTarget && !editingMessageId && (
                <div className="cr-replying-row">
                  <div className="cr-replying-preview">
                    <span className="cr-replying-label">Replying to {replyTarget.userName}</span>
                    <span className="cr-replying-text">
                      {replyTarget.content?.trim()
                        ? replyTarget.content.slice(0, 140)
                        : replyTarget.attachmentType
                          ? `[${replyTarget.attachmentType}]`
                          : 'Message'}
                    </span>
                  </div>
                  <button className="cr-action-btn" onClick={() => setReplyTarget(null)} title="Cancel reply">
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="cr-input-bar">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm" style={{ display: 'none' }} onChange={handleFileSelect} />
                <button className="cr-input-action" onClick={() => fileRef.current?.click()} title="Attach"><Paperclip size={17} /></button>
                <button className="cr-input-action" onClick={() => { setShowBookmarkPicker(true); setShowGifPicker(false); }} title="Forward a question"><BookOpen size={17} /></button>
                <button className="cr-input-action" onClick={() => { setShowGifPicker(prev => !prev); setShowBookmarkPicker(false); }} title="Send GIF"><Sticker size={17} /></button>
                <textarea
                  ref={textareaRef}
                  className="cr-input"
                  value={input}
                  onChange={e => { setInput(e.target.value); resizeTextarea(); }}
                  onKeyDown={handleKeyDown}
                  placeholder={editingMessageId ? 'Edit message…' : (activeChat.type === 'global' ? 'Message… (use @username to mention)' : `Message ${activeChat.title}…`)}
                  rows={1}
                  maxLength={2000}
                />
                <button
                  className="cr-send-btn"
                  onClick={() => handleSend()}
                  disabled={sending || (!input.trim() && !attachmentPreview)}
                >
                  <Send size={16} />
                </button>
              </div>
              {editingMessageId && (
                <div className="cr-editing-row">
                  <span>Editing message</span>
                  <button className="cr-action-btn" onClick={() => { setEditingMessageId(null); setInput(''); }}>Cancel</button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'announcements' && (
          <div className="cr-announcements">
            <div className="cr-ann-toolbar">
              {isOwner && <button className="cr-btn cr-btn--primary" onClick={() => setShowNewAnn(true)}><Megaphone size={13} /> New</button>}
              {unreadAnnCount > 0 && <button className="cr-btn cr-btn--secondary" onClick={handleMarkAllRead}><CheckCheck size={13} /> Mark all read</button>}
            </div>
            {announcements.length === 0 ? (
              <div className="cr-empty"><Megaphone size={32} /><span>No announcements yet</span></div>
            ) : (
              <div className="cr-ann-list">
                {announcements.map(a => (
                  <AnnouncementCard key={a.id} a={a} onMarkRead={handleMarkRead} isOwner={isOwner} onDelete={handleDeleteAnn} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}


export function NotificationBell({ onClick }: { onClick: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(async () => {
    try {
      const d = await chatApi('unread-count');
      if (d.success) setCount(d.count);
    } catch {}
  }, []);

  useEffect(() => {
    fetchCount();
    const iv = setInterval(fetchCount, 30000);
    return () => clearInterval(iv);
  }, [fetchCount]);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    try {
      const d = await chatApi('notification-feed');
      if (d.success) setItems(d.items);
    } catch {} finally { setLoading(false); }
  }, []);

  const togglePanel = () => {
    if (!open) loadFeed();
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    const onResolved = (evt: Event) => {
      const customEvt = evt as CustomEvent<{ requestId?: string }>;
      const resolvedId = customEvt.detail?.requestId;
      if (!resolvedId) {
        loadFeed();
        fetchCount();
        return;
      }
      setItems(prev => prev.filter((it) => !(it.type === 'friend_request' && it.requestId === resolvedId)));
      fetchCount();
    };
    window.addEventListener(FRIEND_REQUEST_RESOLVED_EVENT, onResolved as EventListener);
    return () => window.removeEventListener(FRIEND_REQUEST_RESOLVED_EVENT, onResolved as EventListener);
  }, [fetchCount, loadFeed]);

  const markOneRead = async (notifId: string) => {
    await chatPost('mark-notification-read', { notificationId: notifId });
    setItems(prev => prev.map(it => it.id === notifId ? { ...it, isRead: true } : it));
    setCount(prev => Math.max(0, prev - 1));
  };

  const respondFriendRequestFromNotif = async (item: NotifItem, response: 'accept' | 'reject') => {
    if (!item.requestId) return;
    await chatPost('respond-friend-request', { requestId: item.requestId, response });
    window.dispatchEvent(new CustomEvent(FRIEND_REQUEST_RESOLVED_EVENT, { detail: { requestId: item.requestId } }));
    setItems(prev => prev.filter(it => it.id !== item.id));
    setCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    await chatPost('mark-all-notifications-read', {});
    setItems(prev => prev.map(it => it.type === 'friend_request' ? it : ({ ...it, isRead: true })));
    setCount(0);
  };

  const handleItemClick = (item: NotifItem) => {
    if (!item.isRead) markOneRead(item.id);
    if (item.type === 'message') {
      setOpen(false);
      onClick();
    }
  };

  return (
    <div className="notif-bell-wrapper" ref={panelRef}>
      <button className="notif-bell-btn" onClick={togglePanel} title="Notifications">
        <Bell size={18} />
        {count > 0 && <span className="notif-bell-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span className="notif-panel-title">Notifications</span>
            {items.some(it => !it.isRead && it.type !== 'friend_request') && (
              <button className="notif-panel-readall" onClick={markAllRead}><CheckCheck size={12} /> Read all</button>
            )}
          </div>

          <div className="notif-panel-body">
            {loading ? (
              <div className="notif-panel-loading"><span className="spinner" style={{ width: 18, height: 18 }} /></div>
            ) : items.length === 0 || items.every(it => it.isRead) ? (
              <div className="notif-panel-empty">
                <CheckCheck size={20} />
                <span>All notifications read</span>
              </div>
            ) : (
              items.filter(it => !it.isRead).slice(0, 10).map(item => (
                <div
                  key={item.id}
                  className={`notif-item ${item.isRead ? 'notif-item--read' : ''}`}
                >
                  <div className="notif-item-main" onClick={() => item.type !== 'friend_request' && handleItemClick(item)}>
                    <div className="notif-item-avatar">
                      {item.fromImage ? <img src={item.fromImage} alt="" /> : (
                        item.type === 'announcement' ? <Megaphone size={14} /> : <span>{item.from[0]?.toUpperCase()}</span>
                      )}
                    </div>
                    <div className="notif-item-content">
                      <div className="notif-item-title">
                        {item.type === 'announcement' && <span className="notif-item-tag">Announcement</span>}
                        {item.type === 'friend_request' && <span className="notif-item-tag">Friend request</span>}
                        {item.title}
                      </div>
                      <div className="notif-item-preview">{item.preview}</div>
                      <div className="notif-item-time">{fmtRelative(item.createdAt)}</div>
                    </div>
                  </div>
                  {item.type === 'friend_request' ? (
                    <div className="notif-item-actions">
                      <button
                        className="notif-item-action-btn"
                        onClick={e => { e.stopPropagation(); respondFriendRequestFromNotif(item, 'accept'); }}
                        title="Accept request"
                      >
                        <UserCheck size={12} />
                        Accept
                      </button>
                      <button
                        className="notif-item-action-btn notif-item-action-btn--danger"
                        onClick={e => { e.stopPropagation(); respondFriendRequestFromNotif(item, 'reject'); }}
                        title="Decline request"
                      >
                        <X size={12} />
                        Decline
                      </button>
                    </div>
                  ) : !item.isRead && (
                    <button className="notif-item-read-btn" onClick={e => { e.stopPropagation(); markOneRead(item.id); }} title="Mark read">
                      <Check size={12} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
