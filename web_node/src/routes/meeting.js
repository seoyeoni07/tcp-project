import express from "express";
import db from "../config/db.js";

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

function parseLocalDateTime(str) {
  if (!str) return null;
  return str.replace("T", " ") + ":00";
}

// 회의실 목록
router.get("/", requireLogin, async (req, res, next) => {
  const user = req.session.user;

  const today = new Date();
  let year  = parseInt(req.query.year  || today.getFullYear(), 10);
  let month = parseInt(req.query.month || (today.getMonth() + 1), 10);

  if (req.query.prev) {
    month -= 1;
  } else if (req.query.next) {
    month += 1;
  }

  if (month <= 0) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }

  const monthStr = String(month).padStart(2, "0");
  const start = `${year}-${monthStr}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const nextMonthStr = String(nextMonth).padStart(2, "0");
  const end = `${nextYear}-${nextMonthStr}-01`;

  try {
    const [rows] = await db.query(
      `
      SELECT
        r.reservation_id,
        r.room_id,
        mr.room_name,
        r.start_time,
        r.end_time,
        DATE_FORMAT(r.start_time, '%Y-%m-%d') AS reserved_date,
        u.user_name
      FROM meeting_reservations r
      JOIN meeting_rooms mr ON mr.room_id = r.room_id
      JOIN users u ON u.user_id = r.user_id
      WHERE r.start_time >= ? AND r.start_time < ?
      ORDER BY r.start_time
      `,
      [start, end]
    );

    const byDate = {};
    for (const row of rows) {
      const d = row.reserved_date;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(row);
    }

    res.render("meeting/list", {
      title: "회의실 예약",
      active: "meeting",
      user,
      year,
      month,
      reservationsByDate: byDate,
    });
  } catch (err) {
    next(err);
  }
});

// 예약 목록
router.get("/my", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;

    const [reservations] = await db.query(
      `
      SELECT
        r.reservation_id,
        m.room_name,
        DATE_FORMAT(r.start_time, '%Y-%m-%d %H:%i') AS start_time,
        DATE_FORMAT(r.end_time, '%Y-%m-%d %H:%i')   AS end_time
      FROM meeting_reservations r
      JOIN meeting_rooms m ON m.room_id = r.room_id
      WHERE r.user_id = ?
      ORDER BY r.start_time DESC
      `,
      [user.user_id]
    );

    res.render("meeting/my", {
      title: "내 예약 목록",
      active: "meeting",
      user,
      reservations,
    });
  } catch (err) {
    next(err);
  }
});

// 예약 화면
router.get("/reserve/:room_id", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const { room_id } = req.params;

    const [[room]] = await db.query(
      `
      SELECT room_id, room_name, capacity
      FROM meeting_rooms
      WHERE room_id = ?
      `,
      [room_id]
    );

    if (!room) {
      return res.status(404).send("존재하지 않는 회의실입니다.");
    }

    res.render("meeting/reserve", {
      title: "회의실 예약",
      active: "meeting",
      user,
      room,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// 예약 처리
router.post("/reserve/:room_id", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const { room_id } = req.params;
    const { start, end } = req.body;

    if (!start || !end) {
      const [[room]] = await db.query(
        `SELECT room_id, room_name, capacity FROM meeting_rooms WHERE room_id = ?`,
        [room_id]
      );

      return res.status(400).render("meeting/reserve", {
        title: "회의실 예약",
        active: "meeting",
        user,
        room,
        error: "시작/종료 시간을 모두 입력하세요.",
      });
    }

    const startTime = parseLocalDateTime(start);
    const endTime = parseLocalDateTime(end);

    await db.query(
      `
      INSERT INTO meeting_reservations (user_id, room_id, start_time, end_time)
      VALUES (?, ?, ?, ?)
      `,
      [user.user_id, room_id, startTime, endTime]
    );

    res.redirect("/meeting/my");
  } catch (err) {
    next(err);
  }
});

export default router;