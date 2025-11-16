import express from "express";
import db from "../config/db.js";

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/");
  next();
}

router.get("/", requireLogin, async (req, res, next) => {
  const user = req.session.user;

  try {
    // 내가 참여 중인 채팅방
    const [rooms] = await db.query(
      `
      SELECT
        r.room_id,
        r.room_name,
        (
          SELECT u.user_name
          FROM chat_participants cp
          JOIN users u ON u.user_id = cp.user_id
          WHERE cp.room_id = r.room_id
            AND cp.user_id <> ?
          LIMIT 1
        ) AS other_name
      FROM chat_rooms r
      JOIN chat_participants p ON p.room_id = r.room_id
      WHERE p.user_id = ?
      ORDER BY r.room_id ASC
      `,
      [user.user_id, user.user_id]
    );

    // 사용자 목록
    const [users] = await db.query(
      `
      SELECT user_id, user_name
      FROM users
      WHERE user_id <> ?
      ORDER BY user_name ASC
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

// 1:1 채팅 생성 or 기존 방 반환
router.post("/start", requireLogin, async (req, res, next) => {
  const myId = req.session.user.user_id;
  const otherId = Number(req.body.user_id);

  if (!otherId || Number.isNaN(otherId)) {
    return res.status(400).json({ ok: false, error: "상대 사용자 ID가 없습니다." });
  }
  if (otherId === myId) {
    return res.status(400).json({ ok: false, error: "자기 자신과는 채팅할 수 없습니다." });
  }

  try {
    // 기존 채팅 존재 여부 확인
    const [existing] = await db.query(
      `
      SELECT r.room_id, r.room_name
      FROM chat_rooms r
      JOIN chat_participants p1 ON p1.room_id = r.room_id AND p1.user_id = ?
      JOIN chat_participants p2 ON p2.room_id = r.room_id AND p2.user_id = ?
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

    // 새 방 생성
    const [[otherUser]] = await db.query(
      "SELECT user_name FROM users WHERE user_id = ?",
      [otherId]
    );
    if (!otherUser) {
      return res.status(404).json({ ok: false, error: "상대 사용자를 찾을 수 없습니다." });
    }

    const roomName = `${req.session.user.user_name} ↔ ${otherUser.user_name} 1:1 채팅`;

    const [roomResult] = await db.query(
      "INSERT INTO chat_rooms (room_name) VALUES (?)",
      [roomName]
    );
    const newRoomId = roomResult.insertId;

    // 채팅 참여자 등록
    await db.query(
      `
      INSERT INTO chat_participants (room_id, user_id)
      VALUES (?, ?), (?, ?)
      `,
      [newRoomId, myId, newRoomId, otherId]
    );

    res.json({
      ok: true,
      existed: false,
      room: { room_id: newRoomId, room_name: roomName },
    });

  } catch (err) {
    next(err);
  }
});

export default router;
