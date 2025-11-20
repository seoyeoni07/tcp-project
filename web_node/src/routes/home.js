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

    res.render("home", {
      title: "홈",
      user,
      notices, 
    });
  } catch (err) {
    console.error("홈 화면 공지 조회 오류:", err);
    next(err);
  }
});

router.get("/", requireLogin, (req, res) => {
  res.render("home", {
    title: "홈",
    user: req.session.user,
    active: "home",
  });
});

export default router;