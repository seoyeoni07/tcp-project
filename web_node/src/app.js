import express from "express";
import session from "express-session";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";

import db from "./config/db.js";

import authRouter from "./routes/auth.js";
import boardRouter from "./routes/board.js";
import chatRouter from "./routes/chat.js";
import worklogRouter from "./routes/worklog.js";
import meetingRouter from "./routes/meeting.js";
import homeRouter from "./routes/home.js";
import adminRouter from "./routes/admin.js";
import statusRouter from "./routes/status.js";

dotenv.config();

const app = express();
const httpServer = createServer(app);

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
  secret: process.env.SESSION_SECRET || "TeamDeskHub",
  resave: false,
  saveUninitialized: false,
});
app.use(sessionMiddleware);
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/");
  }
  next();
}

app.use("/", authRouter);
app.use("/home", homeRouter);
app.use("/board", boardRouter);
app.use("/chat", chatRouter);
app.use("/worklog", worklogRouter);
app.use("/meeting", meetingRouter);
app.use("/admin", adminRouter);
app.use("/api/status", statusRouter);

io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

async function getPastMessages(roomId) {
  const safeRoomId = Number(roomId) || 1;

  try {
    const query = `
      SELECT m.message_id, m.content, m.created_at, u.user_name, m.user_id
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

async function saveChatMessage(userId, messageContent, roomId) {
  if (!userId || !messageContent) {
    console.error("[DB ERROR] 사용자 ID 또는 메시지 내용이 없습니다. 저장 불가.");
    return null;
  }

  const safeRoomId = Number(roomId) || 1;

  try {
    const query = `
      INSERT INTO messages (user_id, room_id, content)
      VALUES (?, ?, ?)
    `;
    const [result] = await db.query(query, [userId, safeRoomId, messageContent]);
    return result.insertId;
  } catch (error) {
    console.error("메시지 DB 저장 오류:", error);
    throw error;
  }
}

async function updateLastReadMessageId(userId, roomId, messageId) {
  try {
    const query = `
            INSERT INTO chat_participants (room_id, user_id, last_read_message_id)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE last_read_message_id = ?
        `;
    await db.query(query, [roomId, userId, messageId, messageId]);
  } catch (error) {
    console.error("마지막 읽은 메시지 ID 업데이트 오류:", error);
  }
}

async function getRoomParticipants(roomId) {
  try {
    const [rows] = await db.query(
      "SELECT user_id FROM chat_participants WHERE room_id = ?",
      [roomId]
    );
    return rows.map(row => Number(row.user_id));
  } catch (error) {
    console.error("채팅방 참여자 조회 오류:", error);
    return [];
  }
}

async function calculateTotalUnreadCount(userId) {
  if (!userId) return { unreadCount: 0, newNoticeCount: 0, todayMeetingCount: 0, totalCount: 0 };

  try {
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

    const [[todayMeetings]] = await db.query(
      `
      SELECT COUNT(*) AS today_meeting_count
      FROM meeting_reservations
      WHERE user_id = ?
        AND DATE(start_time) = CURDATE()
      `,
      [userId]
    );

    const chatCount = unreadMessages.unread_count || 0;
    const noticeCount = newNotices.new_notice_count || 0;
    const meetingCount = todayMeetings.today_meeting_count || 0;
    const totalCount = chatCount + noticeCount + meetingCount;

    return { 
      unreadCount: chatCount, 
      newNoticeCount: noticeCount, 
      todayMeetingCount: meetingCount, 
      totalCount: totalCount 
    };

  } catch (error) {
    console.error("전체 알림 카운트 계산 오류:", error);
    return { unreadCount: 0, newNoticeCount: 0, todayMeetingCount: 0, totalCount: 0 };
  }
}

export function notifyNewRoom(newRoomId, participantIds, roomInfo) {
  if (!io) return;

  io.fetchSockets().then(sockets => {
    sockets.forEach(s => {
      if (participantIds.includes(s.userId)) {
        s.emit("new room created", {
          room_id: newRoomId,
          room_name: roomInfo.room_name,
          type: roomInfo.type,
          other_name: roomInfo.type === 'single' ? roomInfo.otherName : null
        });
      }
    });
  }).catch(err => {
    console.error("New room notification error:", err);
  });
}


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
  socket.currentRoomId = 1;

   io.emit("online count", io.engine.clientsCount);

  socket.emit("system message", `${userName}님, 채팅방에 오신 것을 환영합니다!`);

  socket.on("join room", async (roomId) => {
    if (!roomId) return;

    socket.leave(`room-${socket.currentRoomId}`);
    socket.currentRoomId = Number(roomId) || 1;
    socket.join(`room-${socket.currentRoomId}`);

    try {
      socket.emit("clear messages");

      const messages = await getPastMessages(socket.currentRoomId);

      const lastMessageId = messages.length > 0 ? messages[messages.length - 1].message_id : null;
      if (lastMessageId) {
        await updateLastReadMessageId(userId, socket.currentRoomId, lastMessageId);
        
        const counts = await calculateTotalUnreadCount(socket.userId);
        socket.emit('update total count', counts);
      }

      messages.forEach((msg) => {
        socket.emit("past message", {
          user_id: msg.user_id,
          user_name: msg.user_name,
          message: msg.content,
          timestamp: new Date(msg.created_at).toLocaleTimeString(),
          room_id: socket.currentRoomId,
          message_id: msg.message_id,
        });
      });

      socket.emit(
        "system message",
        `채팅 내역 로딩 완료.(방 ${socket.currentRoomId})`
      );
    } catch (err) {
      console.error("과거 메시지 전송 실패:", err);
      socket.emit("system message", "채팅 내역을 불러오는 데 실패했습니다.");
    }
  });

  socket.on("read message", (messageId) => {
    if (messageId && socket.currentRoomId) {
      updateLastReadMessageId(userId, socket.currentRoomId, Number(messageId));
    }
  });

  socket.on("read room messages", async (roomId) => {
    if (!roomId) return;

    const counts = await calculateTotalUnreadCount(socket.userId);
    socket.emit('update total count', counts);
    socket.emit('read all messages in room done');
  });

  socket.on("typing start", (data) => {
    if (!data.roomId) return;
    socket.to(`room-${data.roomId}`).emit("user typing", {
      userId: socket.userId,
      userName: socket.userName,
      roomId: data.roomId
    });
  });

  socket.on("typing stop", (data) => {
    if (!data.roomId) return;
    socket.to(`room-${data.roomId}`).emit("user stop typing", {
      userId: socket.userId,
      userName: socket.userName,
      roomId: data.roomId
    });
  });

  socket.on("chat message", async (payload) => {

    const isObject = typeof payload === "object" && payload !== null;
    const text = isObject
      ? String(payload.message || "").trim()
      : String(payload || "").trim();

    const roomIdFromClient = isObject ? Number(payload.room_id) : NaN;
    const roomId = roomIdFromClient || socket.currentRoomId;

    if (!text) {
      return;
    }

    let newMessageId;
    try {
      newMessageId = await saveChatMessage(socket.userId, text, roomId);
      if (!newMessageId) return;
      await updateLastReadMessageId(socket.userId, roomId, newMessageId);
    } catch (error) {
      console.error("메시지 DB 저장 오류:", error);
      socket.emit("system message", "메시지 저장 중 오류가 발생했습니다.");
      return;
    }

    const messageData = {
      user_id: socket.userId,
      user_name: socket.userName,
      message: text,
      timestamp: new Date().toLocaleTimeString(),
      room_id: roomId,
      message_id: newMessageId,
    };

    io.to(`room-${roomId}`).emit("chat message", messageData);
    const participantIds = await getRoomParticipants(roomId);

    io.fetchSockets().then(async sockets => {
      sockets.forEach(async s => {
        if (participantIds.includes(s.userId) && s.userId !== socket.userId) {
          
          if (s.currentRoomId === roomId) {
            // 새 메시지가 왔는데, 수신자가 현재 그 방을 보고 있다면 즉시 읽음 처리
            await updateLastReadMessageId(s.userId, roomId, newMessageId);
          } else {
            // 방을 보고 있지 않다면 알림을 보냄 (새 메시지 왔다고 클라이언트가 UI에 표시할 수 있음)
            s.emit("new message notification", messageData);
          }
          
          // 카운트를 계산하여 전송 (읽음 처리를 했다면 카운트가 올라가지 않음)
          const counts = await calculateTotalUnreadCount(s.userId);
          s.emit('update total count', counts);
        }
      });
      
      const myCounts = await calculateTotalUnreadCount(socket.userId);
      socket.emit('update total count', myCounts);
    });
  });

  socket.on("disconnect", async () => {
    console.log(`${socket.userName} 연결이 끊어졌습니다.`);
    io.emit("online count", io.engine.clientsCount);
    
    try {
      const [users] = await db.query(
        `SELECT 
          user_id, 
          user_name, 
          department, 
          position, 
          work_status,
          status_updated_at
        FROM users`
      );
      io.emit("status-updated", { users });
    } catch (error) {
      console.error("DB 조회 오류:", error);
    }
  });

  socket.on("status-change", async (data) => {
    const { status } = data;
    const validStatuses = ["online", "meeting", "out", "offline"];
    
    if (!validStatuses.includes(status)) {
      return;
    }

    try {
      await db.query(
        `UPDATE users 
         SET work_status = ?, 
             status_updated_at = NOW() 
         WHERE user_id = ?`,
        [status, socket.userId]
      );

      if (socket.request.session.user) {
        socket.request.session.user.work_status = status;
      }

      const [users] = await db.query(
        `SELECT 
          user_id, 
          user_name, 
          department, 
          position, 
          work_status,
          status_updated_at
        FROM users`
      );

      io.emit("status-updated", { users });

    } catch (error) {
      console.error("상태 변경 오류:", error);
    }
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