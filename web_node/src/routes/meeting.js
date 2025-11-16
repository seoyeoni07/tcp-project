import express from "express";
import db from "../config/db.js";

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).send("관리자만 접근할 수 있습니다.");
  }
  next();
}

function parseLocalDateTime(str) {
  if (!str) return null; // "2025-11-16T09:00" → "2025-11-16 09:00:00"
  return str.replace("T", " ") + ":00";
}

//  회의실 달력 + 오늘 예약 현황
router.get("/", requireLogin, async (req, res, next) => {
  const user = req.session.user;

  const today = new Date();
  let year = parseInt(req.query.year || today.getFullYear(), 10);
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
  const nextYear = month === 12 ? year + 1 : year;
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
        DATE_FORMAT(r.start_time, '%H:%i')   AS start_hm,
        DATE_FORMAT(r.end_time,   '%H:%i')   AS end_hm,
        u.user_name
      FROM meeting_reservations r
      JOIN meeting_rooms mr ON mr.room_id = r.room_id
      JOIN users u         ON u.user_id  = r.user_id
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

//  예약 목록
router.get("/my", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;

    let sql = `
      SELECT
        r.reservation_id,
        m.room_name,
        DATE_FORMAT(r.start_time, '%Y-%m-%d %H:%i') AS start_time,
        DATE_FORMAT(r.end_time,   '%Y-%m-%d %H:%i') AS end_time,
        u.user_name
      FROM meeting_reservations r
      JOIN meeting_rooms m ON m.room_id = r.room_id
      JOIN users u        ON u.user_id = r.user_id
    `;
    const params = [];

    if (user.role !== "admin") {
      sql += " WHERE r.user_id = ? ";
      params.push(user.user_id);
    }

    sql += " ORDER BY r.start_time DESC";

    const [reservations] = await db.query(sql, params);

    res.render("meeting/my", {
      title: user.role === "admin" ? "전체 예약 목록" : "내 예약 목록",
      active: "meeting",
      user,
      reservations,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/reserve", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const [rooms] = await db.query(
      `SELECT room_id, room_name, capacity
       FROM meeting_rooms ORDER BY room_name ASC`
    );

    res.render("meeting/reserve", {
      title: "회의실 예약",
      active: "meeting",
      user,
      rooms,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

//  예약 등록
router.post("/reserve", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const { room_id, start, end } = req.body;

    if (!room_id || !start || !end) {
      const [rooms] = await db.query(
        `SELECT room_id, room_name, capacity
         FROM meeting_rooms ORDER BY room_name ASC`
      );

      return res.status(400).render("meeting/reserve", {
        title: "회의실 예약",
        active: "meeting",
        user,
        rooms,
        error: "회의실, 시작 시간, 종료 시간을 모두 선택하세요.",
      });
    }

    if (new Date(start) >= new Date(end)) {
      const [rooms] = await db.query(
        `SELECT room_id, room_name, capacity
         FROM meeting_rooms ORDER BY room_name ASC`
      );

      return res.status(400).render("meeting/reserve", {
        title: "회의실 예약",
        active: "meeting",
        user,
        rooms,
        error: "종료 시간은 시작 시간보다 늦어야 합니다.",
      });
    }

    const parsedRoomId = parseInt(room_id, 10);
    const startTime = parseLocalDateTime(start);
    const endTime = parseLocalDateTime(end);

    // 겹치는 예약 체크
    const [overlaps] = await db.query(
      `
      SELECT 1
      FROM meeting_reservations
      WHERE room_id = ?
        AND NOT (end_time <= ? OR start_time >= ?)
      LIMIT 1
      `,
      [parsedRoomId, startTime, endTime]
    );

    if (overlaps.length > 0) {
      const [rooms] = await db.query(
        `SELECT room_id, room_name, capacity
         FROM meeting_rooms ORDER BY room_name ASC`
      );

      return res.status(400).render("meeting/reserve", {
        title: "회의실 예약",
        active: "meeting",
        user,
        rooms,
        error:
          "해당 시간대에 이미 예약이 있습니다. 다른 시간 또는 회의실을 선택하세요.",
      });
    }

    await db.query(
      `
      INSERT INTO meeting_reservations (user_id, room_id, start_time, end_time)
      VALUES (?, ?, ?, ?)
      `,
      [user.user_id, parsedRoomId, startTime, endTime]
    );

    res.redirect("/meeting/my");
  } catch (err) {
    next(err);
  }
});

//  예약 취소
router.get("/cancel/:reservation_id", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const { reservation_id } = req.params;

    const [[reservation]] = await db.query(
      `SELECT user_id FROM meeting_reservations WHERE reservation_id = ?`,
      [reservation_id]
    );

    if (!reservation) {
      return res.status(404).send("존재하지 않는 예약입니다.");
    }

    if (reservation.user_id !== user.user_id && user.role !== "admin") {
      return res
        .status(403)
        .send("본인 예약 또는 관리자만 취소할 수 있습니다.");
    }

    await db.query(
      `DELETE FROM meeting_reservations WHERE reservation_id = ?`,
      [reservation_id]
    );

    res.redirect("/meeting/my");
  } catch (err) {
    next(err);
  }
});

//  예약 수정
router.get("/edit/:reservation_id", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const { reservation_id } = req.params;

    const [rooms] = await db.query(
      `SELECT room_id, room_name, capacity
       FROM meeting_rooms ORDER BY room_name ASC`
    );

    const [[reservation]] = await db.query(
      `
      SELECT 
        reservation_id, room_id, user_id,
        DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i') AS start_time_local,
        DATE_FORMAT(end_time,   '%Y-%m-%dT%H:%i') AS end_time_local
      FROM meeting_reservations 
      WHERE reservation_id = ?
      `,
      [reservation_id]
    );

    if (!reservation) {
      return res.status(404).send("존재하지 않는 예약입니다.");
    }

    if (reservation.user_id !== user.user_id && user.role !== "admin") {
      return res
        .status(403)
        .send("본인 예약 또는 관리자만 수정할 수 있습니다.");
    }

    res.render("meeting/edit", {
      title: "예약 수정",
      active: "meeting",
      user,
      rooms,
      reservation,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

//  예약 수정 처리
router.post("/edit/:reservation_id", requireLogin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const { reservation_id } = req.params;
    const { room_id, start, end } = req.body;

    if (!room_id || !start || !end) {
      const [rooms] = await db.query(
        `SELECT room_id, room_name, capacity
         FROM meeting_rooms ORDER BY room_name ASC`
      );

      const [[reservation]] = await db.query(
        `
        SELECT 
          reservation_id, room_id, user_id,
          DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i') AS start_time_local,
          DATE_FORMAT(end_time,   '%Y-%m-%dT%H:%i') AS end_time_local
        FROM meeting_reservations 
        WHERE reservation_id = ?
        `,
        [reservation_id]
      );

      return res.status(400).render("meeting/edit", {
        title: "예약 수정",
        active: "meeting",
        user,
        rooms,
        reservation,
        error: "회의실, 시작 시간, 종료 시간을 모두 선택하세요.",
      });
    }

    if (new Date(start) >= new Date(end)) {
      const [rooms] = await db.query(
        `SELECT room_id, room_name, capacity
         FROM meeting_rooms ORDER BY room_name ASC`
      );

      const [[reservation]] = await db.query(
        `
        SELECT 
          reservation_id, room_id, user_id,
          DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i') AS start_time_local,
          DATE_FORMAT(end_time,   '%Y-%m-%dT%H:%i') AS end_time_local
        FROM meeting_reservations 
        WHERE reservation_id = ?
        `,
        [reservation_id]
      );

      return res.status(400).render("meeting/edit", {
        title: "예약 수정",
        active: "meeting",
        user,
        rooms,
        reservation,
        error: "종료 시간은 시작 시간보다 늦어야 합니다.",
      });
    }

    const startTime = parseLocalDateTime(start);
    const endTime = parseLocalDateTime(end);

    const [[originalReservation]] = await db.query(
      `SELECT user_id FROM meeting_reservations WHERE reservation_id = ?`,
      [reservation_id]
    );

    if (
      !originalReservation ||
      (originalReservation.user_id !== user.user_id &&
        user.role !== "admin")
    ) {
      return res
        .status(403)
        .send("권한이 없습니다. (본인 또는 관리자만 수정 가능)");
    }

    // 겹치는 예약 체크
    const [overlaps] = await db.query(
      `
      SELECT 1
      FROM meeting_reservations
      WHERE room_id = ?
        AND reservation_id <> ?
        AND NOT (end_time <= ? OR start_time >= ?)
      LIMIT 1
      `,
      [room_id, reservation_id, startTime, endTime]
    );

    if (overlaps.length > 0) {
      const [rooms] = await db.query(
        `SELECT room_id, room_name, capacity
         FROM meeting_rooms ORDER BY room_name ASC`
      );

      const [[reservation]] = await db.query(
        `
        SELECT 
          reservation_id, room_id, user_id,
          DATE_FORMAT(start_time, '%Y-%m-%dT%H:%i') AS start_time_local,
          DATE_FORMAT(end_time,   '%Y-%m-%dT%H:%i') AS end_time_local
        FROM meeting_reservations 
        WHERE reservation_id = ?
        `,
        [reservation_id]
      );

      return res.status(400).render("meeting/edit", {
        title: "예약 수정",
        active: "meeting",
        user,
        rooms,
        reservation,
        error:
          "해당 시간대에 이미 예약이 있습니다. 다른 시간 또는 회의실을 선택하세요.",
      });
    }

    await db.query(
      `
      UPDATE meeting_reservations
      SET room_id = ?, start_time = ?, end_time = ?
      WHERE reservation_id = ?
      `,
      [room_id, startTime, endTime, reservation_id]
    );

    res.redirect("/meeting/my");
  } catch (err) {
    next(err);
  }
});

//  관리자용 회의실 관리
router.get("/rooms", requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const user = req.session.user;
    const [rooms] = await db.query(
      `SELECT room_id, room_name, capacity
       FROM meeting_rooms ORDER BY room_id ASC`
    );

    res.render("meeting/rooms", {
      title: "회의실 관리",
      active: "meeting",
      user,
      rooms,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/rooms", requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const { room_name, capacity } = req.body;

    if (!room_name || !room_name.trim()) {
      const [rooms] = await db.query(
        `SELECT room_id, room_name, capacity
         FROM meeting_rooms ORDER BY room_id ASC`
      );
      return res.status(400).render("meeting/rooms", {
        title: "회의실 관리",
        active: "meeting",
        user: req.session.user,
        rooms,
        error: "회의실 이름은 필수입니다.",
      });
    }

    const cap = capacity ? parseInt(capacity, 10) || null : null;

    await db.query(
      `INSERT INTO meeting_rooms (room_name, capacity)
       VALUES (?, ?)`,
      [room_name.trim(), cap]
    );

    res.redirect("/meeting/rooms");
  } catch (err) {
    next(err);
  }
});

export default router;
