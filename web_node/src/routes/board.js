import express from "express";
import db from "../config/db.js";

const router = express.Router();

// 로그인 여부
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

router.get("/", requireLogin, async (req, res, next) => {
  try {
    const qRaw = (req.query.q || "").trim();
    const q = qRaw;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = 10;

    const [notices] = await db.query(
      `
      SELECT b.post_id,
             b.title,
             u.user_name AS author_name,
             DATE_FORMAT(b.created_at, '%Y-%m-%d') AS created_date,
             b.view_count AS views
      FROM boards b
      JOIN users u ON u.user_id = b.user_id
      WHERE b.is_notice = 1
      ORDER BY b.post_id DESC
      `
    );

    let countSql = "SELECT COUNT(*) AS cnt FROM boards b WHERE b.is_notice = 0";
    const countParams = [];

    if (q) {
      countSql += " AND b.title LIKE ?";
      countParams.push(`%${q}%`);
    }

    const [[countRow]] = await db.query(countSql, countParams);
    const totalCount = countRow ? countRow.cnt : 0;

    const totalPages = totalCount > 0 ? Math.ceil(totalCount / limit) : 1;
    const currentPage = page > totalPages ? totalPages : page;
    const offset = (currentPage - 1) * limit;

    // 글 목록
    let listSql = `
      SELECT b.post_id,
             b.title,
             u.user_name AS author_name,
             DATE_FORMAT(b.created_at, '%Y-%m-%d') AS created_date,
             b.view_count AS views
      FROM boards b
      JOIN users u ON u.user_id = b.user_id
      WHERE b.is_notice = 0
    `;
    const listParams = [];

    if (q) {
      listSql += " AND b.title LIKE ?";
      listParams.push(`%${q}%`);
    }

    listSql += " ORDER BY b.post_id DESC LIMIT ? OFFSET ?";
    listParams.push(limit, offset);

    const [posts] = await db.query(listSql, listParams);

    return res.render("board", {
      title: "게시판",
      active: "board",
      user: req.session.user || null,
      notices,
      posts,
      q,
      currentPage,
      totalPages,
      pageSize: limit,
      totalCount,
    });
  } catch (err) {
    next(err);
  }
});

// 글쓰기
router.get("/new", requireLogin, (req, res) => {
  res.render("board_form", {
    title: "새 글 작성",
    active: "board",
    user: req.session.user || null,
    mode: "create",
    post: null,
  });
});

// 글 등록
router.post("/new", requireLogin, async (req, res, next) => {
  try {
    const { title, content, is_notice } = req.body;
    const user = req.session.user;
    if (!user) return res.redirect("/");

    if (!title || !content) {
      return res.status(400).send("제목과 내용을 입력하세요.");
    }

    const isAdmin = user.role === "admin";

    // 관리자만 공지 가능
    const isNoticeValue = isAdmin && is_notice ? 1 : 0;

    const [result] = await db.query(
      `
      INSERT INTO boards (user_id, title, content, is_notice)
      VALUES (?, ?, ?, ?)
      `,
      [user.user_id, title, content, isNoticeValue]
    );

    const newId = result.insertId;
    return res.redirect(`/board/${newId}`);
  } catch (err) {
    next(err);
  }
});

// 글 수정
router.get("/:id/edit", requireLogin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("잘못된 요청입니다.");
    }

    const [rows] = await db.query(
      `
      SELECT b.post_id,
             b.user_id,
             b.title,
             b.content,
             b.is_notice,
             DATE_FORMAT(b.created_at, '%Y-%m-%d %H:%i') AS created_at_fmt,
             DATE_FORMAT(b.updated_at, '%Y-%m-%d %H:%i') AS updated_at_fmt
      FROM boards b
      WHERE b.post_id = ?
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).send("글을 찾을 수 없습니다.");
    }

    const post = rows[0];
    const user = req.session.user;
    const isAdmin = user && user.role === "admin";

    // 작성자 또는 관리자만 수정 가능
    if (!user || (post.user_id !== user.user_id && !isAdmin)) {
      return res.status(403).send("수정할 권한이 없습니다.");
    }

    return res.render("board_form", {
      title: "글 수정",
      active: "board",
      user,
      mode: "edit",
      post,
    });
  } catch (err) {
    next(err);
  }
});

// 글 수정
router.post("/:id/edit", requireLogin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("잘못된 요청입니다.");
    }

    const { title, content, is_notice } = req.body;
    const user = req.session.user;
    if (!user) return res.redirect("/");

    if (!title || !content) {
      return res.status(400).send("제목과 내용을 입력하세요.");
    }

    const isAdmin = user.role === "admin";
    const isNoticeValue = isAdmin && is_notice ? 1 : 0;

    const [result] = await db.query(
      `
      UPDATE boards
      SET title = ?, content = ?, is_notice = ?, updated_at = NOW()
      WHERE post_id = ?
        AND (user_id = ? OR ? = 'admin')
      `,
      [title, content, isNoticeValue, id, user.user_id, user.role]
    );

    if (result.affectedRows === 0) {
      return res
        .status(403)
        .send("수정 권한이 없거나 글이 존재하지 않습니다.");
    }

    return res.redirect(`/board/${id}`);
  } catch (err) {
    next(err);
  }
});

// 글 삭제
router.post("/:id/delete", requireLogin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("잘못된 요청입니다.");
    }

    const user = req.session.user;
    if (!user) return res.redirect("/");

    const [result] = await db.query(
      `
      DELETE FROM boards
      WHERE post_id = ?
        AND (user_id = ? OR ? = 'admin')
      `,
      [id, user.user_id, user.role]
    );

    if (result.affectedRows === 0) {
      return res
        .status(403)
        .send("삭제 권한이 없거나 글이 존재하지 않습니다.");
    }

    return res.redirect("/board");
  } catch (err) {
    next(err);
  }
});

router.get("/:id", requireLogin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("잘못된 요청입니다.");
    }

    // 조회수 증가
    await db.query(
      "UPDATE boards SET view_count = view_count + 1 WHERE post_id = ?",
      [id]
    );

    const [rows] = await db.query(
      `
      SELECT b.post_id,
             b.user_id,
             b.title,
             b.content,
             b.is_notice,
             b.view_count AS views,
             DATE_FORMAT(b.created_at, '%Y-%m-%d %H:%i') AS created_at_fmt,
             DATE_FORMAT(b.updated_at, '%Y-%m-%d %H:%i') AS updated_at_fmt,
             u.user_name AS author_name
      FROM boards b
      JOIN users u ON u.user_id = b.user_id
      WHERE b.post_id = ?
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).send("글을 찾을 수 없습니다.");
    }

    const post = rows[0];

    return res.render("board_detail", {
      title: post.title,
      active: "board",
      user: req.session.user || null,
      post,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
