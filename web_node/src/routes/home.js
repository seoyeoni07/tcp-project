import express from "express";
import db from "../config/db.js";

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

router.get("/", requireLogin, async (req, res, next) => {
  const user = req.session.user;
  const userId = user.user_id;

  try {
    const [notices] = await db.query(
      `
      SELECT 
        post_id,
        title,
        DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at
      FROM boards
      WHERE is_notice = 1
      ORDER BY created_at DESC
      LIMIT 5
      `
    );

    // 읽지 않은 메시지 개수
    const [[unreadMessages]] = await db.query(
      `
      SELECT COUNT(*) AS unread_count
      FROM messages m
      JOIN chat_participants cp ON cp.room_id = m.room_id AND cp.user_id = ?
      WHERE m.user_id != ?
        AND (cp.last_read_message_id IS NULL OR m.message_id > cp.last_read_message_id)
            `,
      [userId, userId]
    );

    // 새 공지사항 개수 (최근 7일 이내 + 내가 안 읽은 것만)
    const [[newNotices]] = await db.query(
      `
      SELECT COUNT(*) AS new_notice_count
      FROM boards b
      WHERE b.is_notice = 1
        AND b.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        AND NOT EXISTS (
          SELECT 1 FROM board_views bv
          WHERE bv.post_id = b.post_id
            AND bv.user_id = ?
        )
      `,
      [userId]
    );

    // 오늘 회의실 예약 개수 (내가 예약한)
    const [[todayMeetings]] = await db.query(
      `
      SELECT COUNT(*) AS today_meeting_count
      FROM meeting_reservations
      WHERE user_id = ?
        AND DATE(start_time) = CURDATE()
      `,
      [userId]
    );
    const today = new Date().toISOString().split('T')[0];
    const hasVisitedToday = req.session.meetingPageVisitDate === today;
    const todayMeetingCount = hasVisitedToday ? 0 : (todayMeetings.today_meeting_count || 0);

    res.render("home", {
      title: "홈",
      user,
      notices,
      // 부재중 알림 데이터
      unreadCount: unreadMessages.unread_count || 0,
      newNoticeCount: newNotices.new_notice_count || 0,
      todayMeetingCount: todayMeetingCount,
    });
  } catch (err) {
    console.error("홈 화면 데이터 조회 오류:", err);
    next(err);
  }
});

export default router;
