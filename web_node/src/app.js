import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";     // http 서버
import { Server } from "socket.io";      // socket.io 서버

import db from "./config/db.js";

// 라우터
import authRouter from "./routes/auth.js";
import boardRouter from "./routes/board.js";
import chatRouter from "./routes/chat.js";
import worklogRouter from "./routes/worklog.js";
import meetingRouter from "./routes/meeting.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);

// socket.io 서버 생성
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const sessionMiddleware = session({
  secret: "unistudyhub-secret",
  resave: false,
  saveUninitialized: false,
});
app.use(sessionMiddleware);

// 라우터 연결
app.use("/", authRouter);
app.use("/board", boardRouter);
app.use("/chat", chatRouter);
app.use("/worklog", worklogRouter);
app.use("/meeting", meetingRouter);

// socket.io – 세션 연동
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// 과거 메시지 조회
async function getPastMessages(roomId) {
  const safeRoomId = Number(roomId) || 1;

  try {
    const query = `
      SELECT m.content, m.created_at, u.user_name, m.user_id
      FROM messages m
      JOIN users u ON m.user_id = u.user_id
      WHERE m.room_id = ?
      ORDER BY m.created_at ASC
      LIMIT 50
    `;
    const [rows] = await db.query(query, [safeRoomId]);
    return rows;
  } catch (error) {
    console.error("과거 메시지 조회 오류:", error);
    return [];
  }
}

// 메시지 저장
async function saveChatMessage(userId, messageContent, roomId) {
  if (!userId || !messageContent) {
    console.error("[DB ERROR] 사용자 ID 또는 메시지 내용이 없습니다. 저장 불가.");
    return;
  }

  const safeRoomId = Number(roomId) || 1;

  try {
    const query = `
      INSERT INTO messages (user_id, room_id, content)
      VALUES (?, ?, ?)
    `;
    await db.query(query, [userId, safeRoomId, messageContent]);
  } catch (error) {
    console.error("메시지 DB 저장 오류:", error);
    throw error;
  }
}

// socket.io – 연결 처리
io.on("connection", (socket) => {
  const sessionUser = socket.request.session.user;

  if (!sessionUser) {
    socket.emit("system message", "로그인이 필요합니다.");
    socket.disconnect();
    return;
  }

  const userId = sessionUser.user_id;
  const userName = sessionUser.user_name;

  socket.userId = userId;
  socket.userName = userName;

  let currentRoomId = 1;
  socket.join(`room-${currentRoomId}`);

  getPastMessages(currentRoomId)
    .then((messages) => {
      messages.forEach((msg) => {
        socket.emit("past message", {
          user_id: msg.user_id,
          user_name: msg.user_name,
          message: msg.content,
          timestamp: new Date(msg.created_at).toLocaleTimeString(),
          room_id: currentRoomId,
        });
      });
      socket.emit("system message", "채팅 내역 로딩 완료.");
    })
    .catch((err) => {
      console.error("과거 메시지 전송 실패:", err);
      socket.emit("system message", "채팅 내역을 불러오는 데 실패했습니다.");
    });

  socket.emit("system message", `${userName}님, 채팅방에 오신 것을 환영합니다!`);

  // === 방 전환(join room) ===
  socket.on("join room", async (roomId) => {
    if (!roomId) return;

    socket.leave(`room-${currentRoomId}`);
    currentRoomId = Number(roomId) || 1;
    socket.join(`room-${currentRoomId}`);

    try {
      const messages = await getPastMessages(currentRoomId);

      socket.emit("clear messages");

      messages.forEach((msg) => {
        socket.emit("past message", {
          user_id: msg.user_id,
          user_name: msg.user_name,
          message: msg.content,
          timestamp: new Date(msg.created_at).toLocaleTimeString(),
          room_id: currentRoomId,
        });
      });

      socket.emit(
        "system message",
        `채팅 내역 로딩 완료.(방 ${currentRoomId})`
      );
    } catch (err) {
      console.error("과거 메시지 전송 실패:", err);
      socket.emit("system message", "채팅 내역을 불러오는 데 실패했습니다.");
    }
  });

  // === 채팅 전송 ===
  socket.on("chat message", async (payload) => {

    const isObject = typeof payload === "object" && payload !== null;
    const text = isObject
      ? String(payload.message || "").trim()
      : String(payload || "").trim();

    const roomIdFromClient = isObject ? Number(payload.room_id) : NaN;
    const roomId = roomIdFromClient || currentRoomId;

    if (!text) {
      // 빈 메시지 무시
      return;
    }

    try {
      await saveChatMessage(socket.userId, text, roomId);
    } catch (error) {
      console.error("메시지 DB 저장 오류:", error);
      socket.emit("system message", "메시지 저장 중 오류가 발생했습니다.");
      return;
    }

    io.to(`room-${roomId}`).emit("chat message", {
      user_id: socket.userId,
      user_name: socket.userName,
      message: text,
      timestamp: new Date().toLocaleTimeString(),
      room_id: roomId,
    });
  });

  socket.on("disconnect", () => {
    console.log(`${socket.userName} 연결이 끊어졌습니다.`);
  });
});

app.get("/db-test", async (req, res, next) => {
  try {
    const [rows] = await db.query("SELECT NOW() AS now");
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

app.get("/healthz", (req, res) => res.type("text").send("OK"));
app.get("/", (req, res) => {
  res.render("login", {
    title: "UniStudyHub 로그인",
    error: null,
  });
});

app.use((err, req, res, next) => {
  console.error("[ERROR]", err);
  if (res.headersSent) return next(err);
  res.status(500).type("text").send("Internal Server Error");
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
