import express from "express";
import db from "../config/db.js";

const router = express.Router();

// 로그인 페이지
router.get("/", (req, res) => {
  res.render("login", {
    title: "로그인",
    active: "",
    user: null,
    error: null,
  });
});

router.get("/signup", (req, res) => {
  res.render("signup", {
    title: "회원가입",
    active: "",
    user: null,
    error: null,
  });
});

// 회원가입 페이지
router.post("/signup", async (req, res, next) => {
  try {
    const { username, email, password, department, position } = req.body;

    if (!username || !email || !password || !department || !position) {
      return res.status(400).render("signup", {
        title: "회원가입",
        active: "",
        user: null,
        error: "모든 항목을 입력하세요.",
      });
    }

    const [existRows] = await db.query(
      "SELECT user_id FROM users WHERE email = ?",
      [email]
    );

    if (existRows.length > 0) {
      return res.status(400).render("signup", {
        title: "회원가입",
        active: "",
        user: null,
        error: "이미 존재하는 이메일입니다.",
      });
    }

    await db.query(
      "INSERT INTO users (user_name, email, password, department, position) VALUES (?, ?, ?, ?, ?)",
      [username, email, password, department, position]
    );

    return res.redirect("/");
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).render("login", {
        title: "로그인",
        active: "",
        user: null,
        error: "이메일과 비밀번호를 모두 입력하세요.",
      });
    }

    // 사용자 조회
    const [rows] = await db.query(
      "SELECT user_id, user_name, email, password, role, department, position phone_number FROM users WHERE email = ?",
      [email]
    );

    if (rows.length === 0) {
      return res.status(400).render("login", {
        title: "로그인",
        active: "",
        user: null,
        error: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    const userRow = rows[0];

    if (userRow.password !== password) {
      return res.status(400).render("login", {
        title: "로그인",
        active: "",
        user: null,
        error: "이메일 또는 비밀번호가 올바르지 않습니다.",
      });
    }

    req.session.user = {
      user_id: userRow.user_id,
      user_name: userRow.user_name,
      email: userRow.email,
      role: userRow.role,
      department: userRow.department,
      position: userRow.position,
      phone_number: userRow.phone_number,
    };

    res.redirect("/home");
  } catch (err) {
    next(err);
  }
});

// 로그아웃
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

export default router;