import express from "express";
const router = express.Router();

// 회의실 목록
router.get("/", (req, res) => {
  res.render("meeting/list", {
    title: "회의실 예약",
    active: "meeting",
    user: req.session.user || null,
  });
});

// 내 예약 목록
router.get("/my", (req, res) => {
  res.render("meeting/my", {
    title: "내 예약 목록",
    active: "meeting",
    user: req.session.user || null,
  });
});

// 예약 화면
router.get("/reserve/:room_id", (req, res) => {
  const { room_id } = req.params;
  res.render("meeting/reserve", {
    title: "회의실 예약",
    active: "meeting",
    user: req.session.user || null,
    room_id,
  });
});

export default router;
