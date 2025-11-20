import express from "express";
import db from "../config/db.js";

const router = express.Router();

function requireAdmin(req, res, next) {
  const user = req.session.user;
  if (!user) {
    return res.redirect("/");
  }
  if (user.role !== "admin") {
    // 일반 사용자는 접근 불가
    return res.status(403).type("text").send("접근 권한이 없습니다.");
  }
  next();
}

// 회원 목록
router.get("/users", requireAdmin, async (req, res, next) => {
  try {
    const [users] = await db.query(
      `
      SELECT user_id, user_name, email, department, position, phone_number, role, created_at
      FROM users
      ORDER BY user_id ASC
      `
    );

    res.render("admin/users", {
      title: "회원 관리",
      active: "admin",
      user: req.session.user, 
      users,
    });
  } catch (err) {
    next(err);
  }
});

// 회원 정보 수정
router.post("/users/:id/update", requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { department, position, role } = req.body;

    await db.query(
      `
      UPDATE users
      SET department = ?, position = ?, phone_number = ?, role = ?
      WHERE user_id = ?
      `,
      [department || null, position || null, role, userId]
    );

    if (req.session.user && req.session.user.user_id == userId) {
      req.session.user.role = role;
      req.session.user.department = department;
      req.session.user.position = position;
      req.session.user.phone_number = phone_number;
    }

    res.redirect("/admin/users");
  } catch (err) {
    next(err);
  }
});

// 회원 삭제
router.post("/users/:id/delete", requireAdmin, async (req, res, next) => {
  try {
    const userId = req.params.id;
    await db.query("DELETE FROM users WHERE user_id = ?", [userId]);
    res.redirect("/admin/users");
  } catch (err) {
    next(err);
  }
});

export default router;
