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

// Node.js 내장 모듈 http *추가
import { createServer } from "http";
// socket.io 서버 모듈 *추가
import { Server } from "socket.io";


dotenv.config();

const app = express();
//express앱으로 http서버 생성 *추가
const httpServer = createServer(app);
//socket.io서버 초기화, http서버 연결* 추가
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(express.urlencoded({ extended: true }));

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

io.use((socket, next) => {
    // Express 세션 미들웨어를 소켓 요청에 적용
    sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// 메세지 내역 불러오기
async function getPastMessages() {
    try {
        const query = `
            SELECT m.content, m.created_at, u.user_name, m.user_id
            FROM messages m
            JOIN users u ON m.user_id = u.user_id
            ORDER BY m.created_at ASC
            LIMIT 50 
        `; 
        
        const [rows] = await db.query(query);
        return rows;
    } catch (error) {
        console.error("과거 메시지 조회 오류:", error);
        return [];
    }
}

async function saveChatMessage(userId, messageContent) {
    if (!userId || !messageContent) {
        console.error("[DB ERROR] 사용자 ID 또는 메시지 내용이 없습니다. 저장 불가.");
        return;
    }
    
    try {
        const query = `
            INSERT INTO messages (user_id, content) 
            VALUES (?, ?)
        `;
        await db.query(query, [userId, messageContent]);
    } catch (error) {
        console.error("메시지 DB 저장 오류:", error);
        throw error; 
    }
}

io.on('connection', (socket) => {
    // 사용자 정보 불러오기
    const sessionUser = socket.request.session.user;

    const isAuthenticated = !!sessionUser;
    const userId = isAuthenticated ? sessionUser.user_id : null;
    const userName = isAuthenticated ? sessionUser.user_name : 'Guest';
    
    socket.userId = userId;
    socket.userName = userName;

    if (isAuthenticated) {
        getPastMessages().then(messages => {
            messages.forEach(msg => {
                // 'past message' 이벤트로 현재 연결된 소켓에게만 전송
                socket.emit('past message', { 
                    user_id: msg.user_id,
                    user_name: msg.user_name,
                    message: msg.content,
                    timestamp: new Date(msg.created_at).toLocaleTimeString()
                });
            });
            // 로딩 완료 후 스크롤을 맨 아래로 내리도록 클라이언트에게 알림
            socket.emit('system message', '채팅 내역 로딩 완료.'); 
        }).catch(err => {
            console.error("과거 메시지 전송 실패:", err);
            socket.emit('system message', '채팅 내역을 불러오는 데 실패했습니다.');
        });
    }
    
    socket.emit('system message', `${userName}님, 채팅방에 오신 것을 환영합니다!`);


    socket.on('chat message', async (msg) => {
        if (!isAuthenticated) {
            console.log(`[WARN] 비로그인 사용자(${userName})의 메시지 전송 차단.`);
            socket.emit('system message', '로그인 후 메시지를 전송할 수 있습니다.');
            return;
        }

        // DB 저장 함수 호출
        try {
            await saveChatMessage(socket.userId, msg);
        } catch (error) {
            console.error("메시지 DB 저장 오류:", error);
            socket.emit('system message', '메시지 저장 중 오류가 발생했습니다.');
            return;
        }
        
        io.emit('chat message', { 
            user_id: socket.userId,
            user_name: socket.userName, 
            message: msg,
            timestamp: new Date().toLocaleTimeString()
        });
    });

    socket.on('disconnect', () => {
        console.log(`${socket.userName} 연결이 끊어졌습니다.`);
    });
});

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

// 서버 시작 수정 app.listen -> httpServer.listen
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => { 
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});