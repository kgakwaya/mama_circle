const WebSocket = require('ws');
const jwt       = require('jsonwebtoken');
const pool      = require('./db/pool');

/**
 * Each connected client is stored in:
 *   clients: Map<userId, { ws, rooms: Set<roomId> }>
 *
 * On connect the client sends:
 *   { type: 'auth', token: '...' }
 *
 * Then can send:
 *   { type: 'join_room',  roomId }
 *   { type: 'leave_room', roomId }
 *   { type: 'message',    roomId, content, isAnonymous? }
 *   { type: 'typing',     roomId }
 *
 * Server broadcasts:
 *   { type: 'message',     roomId, message: { id, content, senderId, senderNickname, senderRole, isAnonymous, createdAt } }
 *   { type: 'typing',      roomId, userId, nickname }
 *   { type: 'user_joined', roomId, userId, nickname }
 *   { type: 'error',       message }
 */

const clients = new Map(); // userId → { ws, userId, nickname, role, rooms }

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let user = null;

    const send = (data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    };

    const broadcast = (roomId, data, excludeUserId = null) => {
      for (const [uid, client] of clients.entries()) {
        if (uid === excludeUserId) continue;
        if (client.rooms.has(roomId)) {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify(data));
          }
        }
      }
    };

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); }
      catch { return send({ type: 'error', message: 'Invalid JSON' }); }

      // ── AUTH ──────────────────────────────────────────────────────────
      if (msg.type === 'auth') {
        try {
          const decoded = jwt.verify(msg.token, process.env.JWT_SECRET || 'secret');
          const { rows } = await pool.query(
            `SELECT id, nickname, role FROM users WHERE id = $1 AND is_active = true`,
            [decoded.id]
          );
          if (!rows[0]) return send({ type: 'error', message: 'User not found' });

          user = { ...rows[0], rooms: new Set() };
          clients.set(user.id, { ws, ...user });
          send({ type: 'auth_ok', user: { id: user.id, nickname: user.nickname, role: user.role } });
        } catch {
          send({ type: 'error', message: 'Invalid token' });
        }
        return;
      }

      if (!user) return send({ type: 'error', message: 'Not authenticated' });

      // ── JOIN ROOM ─────────────────────────────────────────────────────
      if (msg.type === 'join_room') {
        const { roomId } = msg;
        // verify membership
        const { rows } = await pool.query(
          `SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
          [roomId, user.id]
        );
        if (!rows[0]) return send({ type: 'error', message: 'Not a member of this room' });

        user.rooms.add(roomId);
        clients.get(user.id).rooms.add(roomId);
        send({ type: 'joined_room', roomId });
        broadcast(roomId, { type: 'user_joined', roomId, userId: user.id, nickname: user.nickname }, user.id);
        return;
      }

      // ── LEAVE ROOM ────────────────────────────────────────────────────
      if (msg.type === 'leave_room') {
        user.rooms.delete(msg.roomId);
        clients.get(user.id)?.rooms.delete(msg.roomId);
        return;
      }

      // ── MESSAGE ───────────────────────────────────────────────────────
      if (msg.type === 'message') {
        const { roomId, content, isAnonymous } = msg;
        if (!content?.trim()) return;

        // verify membership
        const { rows: [member] } = await pool.query(
          `SELECT 1 FROM chat_room_members WHERE room_id = $1 AND user_id = $2`,
          [roomId, user.id]
        );
        if (!member) return send({ type: 'error', message: 'Not a member of this room' });

        // persist
        const { rows: [saved] } = await pool.query(
          `INSERT INTO messages (room_id, sender_id, content, is_anonymous)
           VALUES ($1, $2, $3, $4)
           RETURNING id, content, is_anonymous, created_at`,
          [roomId, user.id, content.trim(), isAnonymous || false]
        );

        const payload = {
          type: 'message',
          roomId,
          message: {
            id: saved.id,
            content: saved.content,
            isAnonymous: saved.is_anonymous,
            createdAt: saved.created_at,
            senderId: isAnonymous ? null : user.id,
            senderNickname: isAnonymous ? 'Anonymous' : user.nickname,
            senderRole: user.role,
          },
        };

        // broadcast to everyone in the room (including sender)
        broadcast(roomId, payload);
        // also send to sender (who may not be subscribed via broadcast if excludeUserId was set)
        send(payload);
        return;
      }

      // ── TYPING ────────────────────────────────────────────────────────
      if (msg.type === 'typing') {
        broadcast(msg.roomId, {
          type: 'typing',
          roomId: msg.roomId,
          userId: user.id,
          nickname: user.nickname,
        }, user.id);
        return;
      }
    });

    ws.on('close', () => {
      if (user) clients.delete(user.id);
    });

    ws.on('error', (err) => {
      console.error('WS error:', err.message);
      if (user) clients.delete(user.id);
    });
  });

  console.log('✅  WebSocket server ready at /ws');
  return wss;
}

module.exports = setupWebSocket;
