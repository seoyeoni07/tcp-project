import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import db from "./config/db.js";

// 라우터
import authRouter from "./routes/auth.js";
import boardRouter from "./routes/board.js";
import chatRouter from "./routes/chat.js";
import worklogRouter from "./routes/worklog.js";
import meetingRouter from "./routes/meeting.js";

dotenv.config();

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "unistudyhub-secret",
    resave: false,
    saveUninitialized: false,
  })
);

// 라우터 연결
app.use("/", authRouter);
app.use("/board", boardRouter);
app.use("/chat", chatRouter);
app.use("/worklog", worklogRouter);
app.use("/meeting", meetingRouter);

// DB 연결
app.get("/db-test", async (req, res, next) => {
  try {
    const [rows] = await db.query("SELECT NOW() AS now");
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get("/healthz", (req, res) => res.type("text").send("OK"));

// 로그인 페이지
app.get("/", (req, res) => {
  res.render("login", {
    title: "UniStudyHub 로그인",
    error: null,
  });
});

// 에러
app.use((err, req, res, next) => {
  console.error("[ERROR]", err);
  if (res.headersSent) return next(err);
  res.status(500).type("text").send("Internal Server Error");
});

// 서버 시작
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
