import express from "express";
const router = express.Router();

router.get("/", (req, res) => {
  res.render("chat", {
    title: "채팅",
    active: "chat",
    user: req.session.user || null
  });
});

export default router;
