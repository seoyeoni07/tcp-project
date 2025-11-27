import express from "express";
import db from "../config/db.js";

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "로그인이 필요합니다" });
  }
  next();
}

// 전체 팀원 상태 조회
router.get("/", requireLogin, async (req, res) => {
  try {
    const { department } = req.query; 
    const currentUser = req.session.user;

    let query = `
      SELECT 
        user_id, 
        user_name, 
        department, 
        position, 
        work_status,
        status_updated_at
      FROM users 
      WHERE 1=1
    `;
    const params = [];

    // 부서별 필터링
    if (department === 'my') {
      // 내 부서만
      query += ` AND department = ?`;
      params.push(currentUser.department);
    } else if (department && department !== 'all') {
      // 특정 부서
      query += ` AND department = ?`;
      params.push(department);
    }

    query += `
      ORDER BY 
        CASE work_status
          WHEN 'online' THEN 1
          WHEN 'meeting' THEN 2
          WHEN 'out' THEN 3
          WHEN 'offline' THEN 4
        END,
        user_name
    `;

    const [users] = await db.query(query, params);

    res.json({ users, currentDepartment: currentUser.department });
  } catch (error) {
    console.error("팀 상태 조회 오류:", error);
    res.status(500).json({ error: "서버 오류" });
  }
});

router.get("/departments", requireLogin, async (req, res) => {
  try {
    const [departments] = await db.query(
      `SELECT DISTINCT department 
       FROM users 
       WHERE department IS NOT NULL 
         AND department != '' 
       ORDER BY department`
    );

    res.json({ 
      departments: departments.map(d => d.department),
      myDepartment: req.session.user.department 
    });
  } catch (error) {
    console.error("부서 목록 조회 오류:", error);
    res.status(500).json({ error: "서버 오류" });
  }
});

// 내 상태 변경
router.post("/change", requireLogin, async (req, res) => {
  const { status } = req.body;
  const userId = req.session.user.user_id;
  const validStatuses = ["online", "meeting", "out", "offline"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "유효하지 않은 상태값입니다" });
  }

  try {
    await db.query(
      `UPDATE users 
       SET work_status = ?, 
           status_updated_at = NOW() 
       WHERE user_id = ?`,
      [status, userId]
    );

    req.session.user.work_status = status;

    // 변경된 사용자 정보 조회
    const [users] = await db.query(
      `SELECT 
        user_id, 
        user_name, 
        department, 
        position, 
        work_status,
        status_updated_at
      FROM users 
      WHERE user_id = ?`,
      [userId]
    );

    res.json({ success: true, user: users[0] });
  } catch (error) {
    console.error("상태 변경 오류:", error);
    res.status(500).json({ error: "상태 변경 실패" });
  }
});

export default router;