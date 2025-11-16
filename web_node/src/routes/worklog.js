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

// 근무 시간 계산 (점심시간 1시간 30분 제외)
function calculateWorkTime(start, end) {
    if (!start || !end) return null;

    try {
        const baseDate = new Date().toISOString().split('T')[0];
        
        const partsStart = String(start).split(':');
        const cleanStart = partsStart[0] + ':' + partsStart[1];
        
        const partsEnd = String(end).split(':');
        const cleanEnd = partsEnd[0] + ':' + partsEnd[1];

        const startTime = new Date(`${baseDate}T${cleanStart.padStart(5, '0')}:00`);
        const endTime = new Date(`${baseDate}T${cleanEnd.padStart(5, '0')}:00`);

        if (endTime < startTime) {
            endTime.setDate(endTime.getDate() + 1);
        }

        let diffMilliseconds = endTime - startTime;
        
        const LUNCH_BREAK_MS = 90 * 60 * 1000;
        
        diffMilliseconds -= LUNCH_BREAK_MS;

        const totalMinutes = Math.floor(diffMilliseconds / (1000 * 60));

        if (totalMinutes < 0) {
            return "0시간 0분";
        }

        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        return `${hours}시간 ${minutes}분`;
    } catch (e) {
        return null;
    }
}

// 목록
router.get("/", requireLogin, async (req, res, next) => {
    const user = req.session.user;

    try {
        const today = new Date();
        let currentYear = parseInt(req.query.year) || today.getFullYear();
        let currentMonth = parseInt(req.query.month) || (today.getMonth() + 1);


        if (req.query.prev) {
            const date = new Date(currentYear, currentMonth - 2, 1);
            currentYear = date.getFullYear();
            currentMonth = date.getMonth() + 1;
        } else if (req.query.next) {
            const date = new Date(currentYear, currentMonth, 1);
            currentYear = date.getFullYear();
            currentMonth = date.getMonth() + 1;
        }

        const monthFormatted = String(currentMonth).padStart(2, '0');
        const startDate = `${currentYear}-${monthFormatted}-01`;
        let nextMonthDate = new Date(currentYear, currentMonth, 1);
        const endDate = nextMonthDate.toISOString().split('T')[0];

        let sql = "SELECT w.log_id, w.user_id, w.title, w.work_date, w.start_time, w.end_time, u.user_name AS author_name FROM worklogs w JOIN users u ON u.user_id = w.user_id WHERE w.work_date >= ? AND w.work_date < ?";

        const params = [startDate, endDate];

        if (!isAdmin(user)) {
            sql += " AND w.user_id = ?";
            params.push(user.user_id);
        }

        sql += " ORDER BY w.work_date ASC";

        const [rows] = await db.query(sql, params);

        const logsWithWorkTime = rows.map(log => ({
            ...log,
            work_time: calculateWorkTime(log.start_time, log.end_time)
        }));

        const logsByDate = logsWithWorkTime.reduce((acc, log) => {
            let workDateString;
            
            if (log.work_date instanceof Date) {
                const date = log.work_date;
                const userTimezoneOffset = date.getTimezoneOffset() * 60000;
                const kstDate = new Date(date.getTime() - userTimezoneOffset);
                workDateString = kstDate.toISOString().split('T')[0];
            } else {
                workDateString = log.work_date;
            }

            const dateKey = workDateString.substring(0, 10);
            if (!acc[dateKey]) {
                acc[dateKey] = [];
            }
            acc[dateKey].push(log);
            return acc;
        }, {});


        return res.render("worklog/list", {
            title: "업무일지 달력",
            active: "worklog",
            user,
            year: currentYear,
            month: currentMonth,
            logsByDate: logsByDate,
        });
    } catch (err) {
        next(err);
    }
});

// 작성 페이지
router.get("/new", requireLogin, (req, res) => {
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000; 
    const localTime = new Date(today.getTime() - offset);
    const todayDateString = localTime.toISOString().split('T')[0];

    const defaultDate = req.query.date || todayDateString; 

    res.render("worklog/new", {
        title: "업무일지 작성",
        active: "worklog",
        user: req.session.user,
        defaultDate: defaultDate,
    });
});

// 저장 
router.post("/new", requireLogin, async (req, res, next) => {
    const user = req.session.user;
    const { title, content, work_date, start_time, end_time, department, position, next_plan } = req.body;

    try {
        if (!title || !content || !work_date || !start_time || !end_time) {
            return res.status(400).send("필수 항목(제목, 내용, 업무일, 출퇴근 시간)을 모두 입력하세요.");
        }
        
        const dateToStore = typeof work_date === 'string' ? work_date.substring(0, 10) : work_date;

        await db.query(
            "INSERT INTO worklogs (user_id, title, content, work_date, start_time, end_time, department, position, next_plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [user.user_id, title, content, dateToStore, start_time, end_time, department, position, next_plan]
        );

        return res.redirect("/worklog");
    } catch (err) {
        next(err);
    }
});

// 상세 조회 
router.get("/:id", requireLogin, async (req, res, next) => {
    const user = req.session.user;
    const id = parseInt(req.params.id, 10);

    if (Number.isNaN(id)) {
        return res.status(400).send("잘못된 요청입니다.");
    }

    try {
        const [rows] = await db.query(
            "SELECT w.*, DATE_FORMAT(w.created_at, '%Y-%m-%d %H:%i') AS created_at_fmt, DATE_FORMAT(w.updated_at, '%Y-%m-%d %H:%i') AS updated_at_fmt, u.user_name AS author_name FROM worklogs w JOIN users u ON u.user_id = w.user_id WHERE w.log_id = ?",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).send("업무일지를 찾을 수 없습니다.");
        }

        const log = rows[0];

        log.work_time = calculateWorkTime(log.start_time, log.end_time);

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

// 수정
router.get("/:id/edit", requireLogin, async (req, res, next) => {
    const user = req.session.user;
    const id = parseInt(req.params.id, 10);

    if (Number.isNaN(id)) {
        return res.status(400).send("잘못된 요청입니다.");
    }

    try {
        const [rows] = await db.query(
            "SELECT w.* FROM worklogs w WHERE w.log_id = ?",
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).send("업무일지를 찾을 수 없습니다.");
        }

        const log = rows[0];

        if (log.work_date instanceof Date) {
            const date = log.work_date;
            const userTimezoneOffset = date.getTimezoneOffset() * 60000;
            const kstDate = new Date(date.getTime() - userTimezoneOffset);
            log.work_date = kstDate.toISOString().split('T')[0];
        }

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


// 수정 처리
router.post("/:id/edit", requireLogin, async (req, res, next) => {
    const user = req.session.user;
    const id = parseInt(req.params.id, 10);
    const { title, content, work_date, start_time, end_time, department, position, next_plan } = req.body;

    if (Number.isNaN(id)) {
        return res.status(400).send("잘못된 요청입니다.");
    }

    if (!title || !content || !work_date || !start_time || !end_time) {
        return res.status(400).send("필수 항목(제목, 내용, 업무일, 출퇴근 시간)을 모두 입력하세요.");
    }

    const dateToStore = typeof work_date === 'string' ? work_date.substring(0, 10) : work_date;

    try {
        const [result] = await db.query(
            "UPDATE worklogs SET title = ?, content = ?, work_date = ?, start_time = ?, end_time = ?, department = ?, position = ?, next_plan = ? WHERE log_id = ? AND (user_id = ? OR ? = 'admin')",
            [title, content, dateToStore, start_time, end_time, department, position, next_plan, id, user.user_id, user.role]
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
            "DELETE FROM worklogs WHERE log_id = ? AND (user_id = ? OR ? = 'admin')",
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

// 관리자 전용 업무일지 조회
router.get("/day/:date", requireLogin, async (req, res, next) => {
    const user = req.session.user;
    const date = req.params.date;

    if (!isAdmin(user)) {
        return res.status(403).send("접근 권한이 없습니다.");
    }

    try {
        const sql = "SELECT w.log_id, w.title, w.start_time, w.end_time, u.user_name AS author_name FROM worklogs w JOIN users u ON u.user_id = w.user_id WHERE w.work_date = ? ORDER BY w.start_time ASC";
        
        const [rows] = await db.query(sql, [date]);

        const logsWithWorkTime = rows.map(log => ({
            ...log,
            work_time: calculateWorkTime(log.start_time, log.end_time)
        }));

        return res.render("worklog/day_list", {
            title: `${date} 업무일지 목록`,
            active: "worklog",
            user,
            date,
            logs: logsWithWorkTime
        });

    } catch (err) {
        next(err);
    }
});

export default router;