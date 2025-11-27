import express from "express";
import db from "../config/db.js";
import { notifyNewRoom } from "../app.js"; 

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  next();
}

router.get("/", requireLogin, async (req, res, next) => {
  const user = req.session.user;

  try {
    const [rooms] = await db.query(
      `
      SELECT
        r.room_id,
        r.room_name,
        r.type,
        (
          SELECT u.user_name
          FROM chat_participants cp
          JOIN users u ON u.user_id = cp.user_id
          WHERE cp.room_id = r.room_id
            AND cp.user_id <> ?
            AND r.type = 'single'
          LIMIT 1
        ) AS other_name,
        (
          SELECT COUNT(m.message_id)
          FROM messages m
          LEFT JOIN chat_participants cp ON cp.room_id = r.room_id AND cp.user_id = ?
          WHERE m.room_id = r.room_id
            AND (cp.last_read_message_id IS NULL OR m.message_id > cp.last_read_message_id)
        ) AS unread_count
      FROM chat_rooms r
      JOIN chat_participants p ON p.room_id = r.room_id
      WHERE p.user_id = ?
      ORDER BY r.room_id ASC
      `,
      [user.user_id, user.user_id, user.user_id]
    );

    const [users] = await db.query(
      `
      SELECT user_id, user_name, department, position, work_status
      FROM users
      WHERE user_id <> ?
      ORDER BY 
        CASE work_status
          WHEN 'online' THEN 1
          WHEN 'meeting' THEN 2
          WHEN 'out' THEN 3
          WHEN 'offline' THEN 4
          ELSE 5
        END,
        user_name ASC
      `,
      [user.user_id]
    );

    res.render("chat", {
      title: "채팅",
      active: "chat",
      user,
      rooms,
      users,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/start", requireLogin, async (req, res, next) => {
  const myId = req.session.user.user_id;
  const myName = req.session.user.user_name;
  const otherId = Number(req.body.user_id);

  if (!otherId || Number.isNaN(otherId)) {
    return res.status(400).json({ ok: false, error: "상대 사용자 ID가 없습니다." });
  }
  if (otherId === myId) {
    return res.status(400).json({ ok: false, error: "자기 자신과는 채팅할 수 없습니다." });
  }

  try {
    const [existing] = await db.query(
      `
      SELECT r.room_id, r.room_name, r.type
      FROM chat_rooms r
      JOIN chat_participants p1 ON p1.room_id = r.room_id AND p1.user_id = ?
      JOIN chat_participants p2 ON p2.room_id = r.room_id AND p2.user_id = ?
      WHERE r.type = 'single'
      LIMIT 1
      `,
      [myId, otherId]
    );

    if (existing.length > 0) {
      return res.json({
        ok: true,
        existed: true,
        room: existing[0],
      });
    }

    const [[otherUser]] = await db.query(
      "SELECT user_name FROM users WHERE user_id = ?",
      [otherId]
    );
    if (!otherUser) {
      return res.status(404).json({ ok: false, error: "상대 사용자를 찾을 수 없습니다." });
    }

    const roomName = `${myName} ↔ ${otherUser.user_name} 1:1 채팅`;

    const [roomResult] = await db.query(
      "INSERT INTO chat_rooms (room_name, type) VALUES (?, 'single')",
      [roomName]
    );
    const newRoomId = roomResult.insertId;

    const participantIds = [myId, otherId];
    await db.query(
      `
      INSERT INTO chat_participants (room_id, user_id)
      VALUES (?, ?), (?, ?)
      `,
      [newRoomId, myId, newRoomId, otherId]
    );

    // 1:1 채팅방 생성 알림
    const roomInfo = {
      room_name: roomName,
      type: 'single',
      creatorId: myId,
      creatorName: myName,
      otherName: otherUser.user_name
    };
    // 참여자 알림 전송
    notifyNewRoom(newRoomId, participantIds.filter(id => id !== myId), roomInfo);

    res.json({
      ok: true,
      existed: false,
      room: { room_id: newRoomId, room_name: roomName, type: 'single' },
    });

  } catch (err) {
    next(err);
  }
});

router.post("/group/start", requireLogin, async (req, res, next) => {
  const myId = req.session.user.user_id;
  const myName = req.session.user.user_name;
  const userIds = req.body.user_ids;
  const providedRoomName = req.body.room_name ? req.body.room_name.trim() : null;

  if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ ok: false, error: "참여할 사용자를 선택해야 합니다." });
  }

  const participantIds = [...new Set([myId, ...userIds.map(Number)])];

  if (participantIds.length < 2) {
    return res.status(400).json({ ok: false, error: "그룹 채팅은 2명 이상이어야 합니다." });
  }

  try {
    const [participants] = await db.query(
      `SELECT user_id, user_name FROM users WHERE user_id IN (?)`,
      [participantIds]
    );

    if (participants.length !== participantIds.length) {
      return res.status(404).json({ ok: false, error: "선택된 사용자 중 존재하지 않는 사용자가 있습니다." });
    }

    const names = participants.map(p => p.user_name);

    // 채팅방 이름 미기입시 이름 자동 생성
    const defaultRoomName = `${names.join(", ")}의 그룹 채팅`;
    const roomName = providedRoomName || defaultRoomName;

    const [roomResult] = await db.query(
      "INSERT INTO chat_rooms (room_name, type) VALUES (?, 'group')",
      [roomName]
    );
    const newRoomId = roomResult.insertId;

    const participantValues = participantIds.map(id => [newRoomId, id]).flat();
    const valuePlaceholders = Array(participantIds.length).fill("(?, ?)").join(", ");

    await db.query(
      `INSERT INTO chat_participants (room_id, user_id) VALUES ${valuePlaceholders}`,
      participantValues
    );

    // 그룹 채팅방 생성 알림
    const roomInfo = {
      room_name: roomName,
      type: 'group',
      creatorId: myId,
      creatorName: myName,
      otherName: null
    };
    // 만든사람 제외 알림
    notifyNewRoom(newRoomId, participantIds.filter(id => id !== myId), roomInfo);

    res.json({
      ok: true,
      existed: false,
      room: { room_id: newRoomId, room_name: roomName, type: 'group' },
    });
  } catch (err) {
    next(err);
  }
});


router.get("/room/participants/:roomId", requireLogin, async (req, res, next) => {
  const roomId = Number(req.params.roomId);

  if (Number.isNaN(roomId)) {
    return res.status(400).json({ ok: false, error: "유효하지 않은 방 ID입니다." });
  }

  try {
    const [participants] = await db.query(
      `SELECT u.user_id, u.user_name, u.work_status
      FROM chat_participants cp
      JOIN users u ON u.user_id = cp.user_id
      WHERE cp.room_id = ?
      ORDER BY u.user_name ASC
      `,
      [roomId]
    );

    res.json({
      ok: true,
      participants: participants,
    });
  } catch (err) {
    next(err);
  }
});

export default router;