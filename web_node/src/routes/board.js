import express from "express";
import db from "../config/db.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 업로드 폴더: web_node/src/public/uploads
const uploadDir = path.join(__dirname, "..", "public", "uploads");

// 폴더 없으면 생성
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

//저장 방식 설정
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname);
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);

    cb(null, unique + ext);  
  },
});

// 파일 다운로드
router.get("/download/:id", async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).send("잘못된 요청입니다.");
    }

    const [rows] = await db.query(
      `
      SELECT file_original, file_saved
      FROM boards
      WHERE post_id = ?
      `,
      [id]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).send("파일 정보가 없습니다.");
    }

    const { file_original, file_saved } = rows[0];

    if (!file_saved) {
      return res.status(404).send("첨부 파일이 없습니다.");
    }

    const filePath = path.join(uploadDir, file_saved);

    if (!fs.existsSync(filePath)) {
      console.error("다운로드 실패 - 파일이 존재하지 않음:", filePath);
      return res.status(404).send("서버에 파일이 존재하지 않습니다.");
    }

    const downloadName = file_original
      ? file_original.normalize("NFC")
      : file_saved;

    return res.download(filePath, downloadName);
  } catch (err) {
    next(err);
  }
});

const upload = multer({ storage });

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
router.post(
  "/new",
  requireLogin,
  upload.single("attachment"),
  async (req, res, next) => {
    try {
      const { title, content, is_notice } = req.body;
      const user = req.session.user;
      if (!user) return res.redirect("/");

      if (!title || !content) {
        return res.status(400).send("제목과 내용을 입력하세요.");
      }

      const isAdmin = user.role === "admin";
      const isNoticeValue = isAdmin && is_notice ? 1 : 0;
      const file = req.file;
      let fileOriginal = null;
      let fileSaved = null;
      let fileSize = null;

      if (file) {
        const decoded = Buffer.from(file.originalname, "latin1").toString("utf8");
        fileOriginal = decoded.normalize("NFC");  // 맥/윈도우 한글 조합 통일
        fileSaved = file.filename;
        fileSize = file.size;
      }

      const [result] = await db.query(
        `
        INSERT INTO boards
          (user_id, title, content, is_notice, file_original, file_saved, file_size)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          user.user_id,
          title,
          content,
          isNoticeValue,
          fileOriginal,
          fileSaved,
          fileSize,
        ]
      );

      const newId = result.insertId;
      return res.redirect(`/board/${newId}`);
    } catch (err) {
      next(err);
    }
  }
);

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
router.post(
  "/:id/edit",
  requireLogin,
  upload.single("attachment"),  
  async (req, res, next) => {
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
  }
);

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
            b.file_original,
            b.file_saved,
            b.file_size,
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
