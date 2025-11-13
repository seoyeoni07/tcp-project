import express from "express";
const router = express.Router();

router.get("/", (req, res) => {
  res.render("worklog/list", {
    title: "업무일지",
    active: "worklog",
    user: req.session.user || null,
  });
});

router.get("/new", (req, res) => {
  res.render("worklog/new", {
    title: "업무일지 작성",
    active: "worklog",
    user: req.session.user || null,
  });
});

export default router;
