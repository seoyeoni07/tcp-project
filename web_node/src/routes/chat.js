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

    let activeRoomId = null;
    if (rooms.length > 0) {
        activeRoomId = rooms[0].room_id; 
    }

    // ------------------- 수정된 부분: DB 업데이트 및 EJS 데이터 수정 -------------------
    if (activeRoomId) {
        // 1. DB에서 해당 방의 마지막 메시지 ID를 가져옵니다.
        const [latestMessage] = await db.query(
            `SELECT MAX(message_id) AS max_id FROM messages WHERE room_id = ?`,
            [activeRoomId]
        );
        const latestMessageId = latestMessage[0].max_id;

        if (latestMessageId) {
            // 2. DB에 읽음 처리 상태를 업데이트합니다.
            await db.query(
                `UPDATE chat_participants 
                 SET last_read_message_id = ? 
                 WHERE room_id = ? AND user_id = ?`,
                [latestMessageId, activeRoomId, user.user_id]
            );
        }
        
        // 3. EJS 템플릿에 전달할 'rooms' 배열의 unread_count를 0으로 수동 업데이트합니다.
        // (DB 업데이트가 'rooms' 배열 생성 후에 이루어졌으므로, EJS에 전달할 배열을 수정)
        const activeRoomIndex = rooms.findIndex(r => r.room_id === activeRoomId);
        if (activeRoomIndex !== -1) {
            rooms[activeRoomIndex].unread_count = 0;
        }
    }
    // ----------------------------------------------------------------------------------

    res.render("chat", {
      title: "채팅",
      active: "chat",
      user,
      rooms,
      users,
      activeRoomId: activeRoomId,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/start", requireLogin, async (req, res, next) => {
  const myId = req.session.user.user_id;
  const otherId = Number(req.body.user_id);

  if (Number.isNaN(otherId) || myId === otherId) {
    return res.json({ ok: false, error: "유효하지 않은 상대방 ID입니다." });
  }

  try {
    const [existingRoom] = await db.query(
      `
      SELECT r.room_id, r.room_name, r.type
      FROM chat_rooms r
      JOIN chat_participants p1 ON r.room_id = p1.room_id AND p1.user_id = ?
      JOIN chat_participants p2 ON r.room_id = p2.room_id AND p2.user_id = ?
      WHERE r.type = 'single' AND (
        SELECT COUNT(*) 
        FROM chat_participants 
        WHERE room_id = r.room_id
      ) = 2
      `,
      [myId, otherId]
    );

    if (existingRoom && existingRoom.length > 0) {
      return res.json({
        ok: true,
        existed: true,
        room: existingRoom[0],
      });
    }

    const [otherUser] = await db.query(
      `SELECT user_name FROM users WHERE user_id = ?`,
      [otherId]
    );
    if (!otherUser || otherUser.length === 0) {
      return res.status(404).json({ ok: false, error: "상대방 사용자를 찾을 수 없습니다." });
    }
    const otherName = otherUser[0].user_name;

    const roomName = `${req.session.user.user_name} ↔ ${otherName} (1:1 채팅)`;
    const [roomResult] = await db.query(
      `INSERT INTO chat_rooms (room_name, type) VALUES (?, 'single')`,
      [roomName]
    );
    const newRoomId = roomResult.insertId;

    await db.query(
      `INSERT INTO chat_participants (room_id, user_id) VALUES (?, ?), (?, ?)`,
      [newRoomId, myId, newRoomId, otherId]
    );

    const roomInfo = {
      room_name: roomName,
      type: 'single',
      creatorId: myId,
      creatorName: req.session.user.user_name,
      otherName: otherName
    };
    notifyNewRoom(newRoomId, [otherId], roomInfo);

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
  let participantIds = req.body.user_ids || [];
  const roomNameFromInput = req.body.room_name ? req.body.room_name.trim() : "";

  participantIds = participantIds.map(Number).filter(id => !Number.isNaN(id));

  if (!participantIds.includes(myId)) {
    participantIds.push(myId);
  }

  if (participantIds.length < 3) {
    return res.status(400).json({ ok: false, error: "그룹 채팅은 3명 이상의 참여자(본인 포함)가 필요합니다." });
  }
  
  try {
    let roomName = roomNameFromInput;
    if (!roomName) {
      const [users] = await db.query(
        `SELECT user_name FROM users WHERE user_id IN (?) ORDER BY FIELD(user_id, ?)`,
        [participantIds, participantIds]
      );
      const names = users.map(u => u.user_name).join(', ');
      roomName = `${names} 그룹 채팅`;
    }

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

    const roomInfo = {
      room_name: roomName,
      type: 'group',
      creatorId: myId,
      creatorName: myName,
      otherName: null
    };
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
      `
      SELECT 
        u.user_id, 
        u.user_name, 
        u.department, 
        u.position, 
        u.work_status
      FROM chat_participants cp
      JOIN users u ON u.user_id = cp.user_id
      WHERE cp.room_id = ?
      ORDER BY 
        CASE u.work_status
          WHEN 'online' THEN 1
          WHEN 'meeting' THEN 2
          WHEN 'out' THEN 3
          WHEN 'offline' THEN 4
          ELSE 5
        END,
        u.user_name ASC
      `,
      [roomId]
    );

    res.json({ ok: true, participants });
  } catch (err) {
    next(err);
  }
});

export default router;