import express from "express";
import db from "../config/db.js";

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

function isAdmin(user) {
  return user && user.role === "admin";
}

// 목록
router.get("/", requireLogin, async (req, res, next) => {
  const user = req.session.user;

  try {
    let sql = `
      SELECT
        w.log_id,
        w.user_id,
        w.title,
        DATE_FORMAT(w.created_at, '%Y-%m-%d')       AS created_at_fmt,
        DATE_FORMAT(w.updated_at, '%Y-%m-%d')       AS updated_at_fmt,
        u.user_name                                  AS author_name
      FROM worklogs w
      JOIN users u ON u.user_id = w.user_id
    `;
    const params = [];

    if (!isAdmin(user)) {
      sql += " WHERE w.user_id = ?";
      params.push(user.user_id);
    }

    sql += " ORDER BY w.created_at DESC";

    const [rows] = await db.query(sql, params);

    return res.render("worklog/list", {
      title: "업무일지",
      active: "worklog",
      user,
      logs: rows,
    });
  } catch (err) {
    next(err);
  }
});

// 작성
router.get("/new", requireLogin, (req, res) => {
  res.render("worklog/new", {
    title: "업무일지 작성",
    active: "worklog",
    user: req.session.user,
  });
});

// 저장
router.post("/new", requireLogin, async (req, res, next) => {
  const user = req.session.user;
  const { title, content } = req.body;

  try {
    if (!title || !content) {
      return res.status(400).send("제목과 내용을 모두 입력하세요.");
    }

    await db.query(
      "INSERT INTO worklogs (user_id, title, content) VALUES (?, ?, ?)",
      [user.user_id, title, content]
    );

    return res.redirect("/worklog");
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireLogin, async (req, res, next) => {
  const user = req.session.user;
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    return res.status(400).send("잘못된 요청입니다.");
  }

  try {
    const [rows] = await db.query(
      `
      SELECT
        w.log_id,
        w.user_id,
        w.title,
        w.content,
        DATE_FORMAT(w.created_at, '%Y-%m-%d %H:%i') AS created_at_fmt,
        DATE_FORMAT(w.updated_at, '%Y-%m-%d %H:%i') AS updated_at_fmt,
        u.user_name                                  AS author_name
      FROM worklogs w
      JOIN users u ON u.user_id = w.user_id
      WHERE w.log_id = ?
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).send("업무일지를 찾을 수 없습니다.");
    }

    const log = rows[0];

    if (!isAdmin(user) && log.user_id !== user.user_id) {
      return res.status(403).send("열람 권한이 없습니다.");
    }

    const canEdit = isAdmin(user) || log.user_id === user.user_id;

    return res.render("worklog/detail", {
      title: "업무일지 상세",
      active: "worklog",
      user,
      log,
      canEdit,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/edit", requireLogin, async (req, res, next) => {
  const user = req.session.user;
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    return res.status(400).send("잘못된 요청입니다.");
  }

  try {
    const [rows] = await db.query(
      `
      SELECT
        w.log_id,
        w.user_id,
        w.title,
        w.content,
        DATE_FORMAT(w.created_at, '%Y-%m-%d %H:%i') AS created_at_fmt,
        DATE_FORMAT(w.updated_at, '%Y-%m-%d %H:%i') AS updated_at_fmt
      FROM worklogs w
      WHERE w.log_id = ?
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).send("업무일지를 찾을 수 없습니다.");
    }

    const log = rows[0];

    if (!isAdmin(user) && log.user_id !== user.user_id) {
      return res.status(403).send("수정 권한이 없습니다.");
    }

    return res.render("worklog/edit", {
      title: "업무일지 수정",
      active: "worklog",
      user,
      log,
    });
  } catch (err) {
    next(err);
  }
});

// 수정
router.post("/:id/edit", requireLogin, async (req, res, next) => {
  const user = req.session.user;
  const id = parseInt(req.params.id, 10);
  const { title, content } = req.body;

  if (Number.isNaN(id)) {
    return res.status(400).send("잘못된 요청입니다.");
  }

  try {
    const [result] = await db.query(
      `
      UPDATE worklogs
         SET title = ?, content = ?
       WHERE log_id = ?
         AND (user_id = ? OR ? = 'admin')
      `,
      [title, content, id, user.user_id, user.role]
    );

    if (result.affectedRows === 0) {
      return res
        .status(403)
        .send("수정 권한이 없거나 업무일지가 존재하지 않습니다.");
    }

    return res.redirect(`/worklog/${id}`);
  } catch (err) {
    next(err);
  }
});

// 삭제
router.post("/:id/delete", requireLogin, async (req, res, next) => {
  const user = req.session.user;
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    return res.status(400).send("잘못된 요청입니다.");
  }

  try {
    const [result] = await db.query(
      `
      DELETE FROM worklogs
       WHERE log_id = ?
         AND (user_id = ? OR ? = 'admin')
      `,
      [id, user.user_id, user.role]
    );

    if (result.affectedRows === 0) {
      return res
        .status(403)
        .send("삭제 권한이 없거나 업무일지가 존재하지 않습니다.");
    }

    return res.redirect("/worklog");
  } catch (err) {
    next(err);
  }
});

export default router;
