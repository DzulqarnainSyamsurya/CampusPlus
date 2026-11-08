const express = require("express");
const router = express.Router();

const ActivityLog = require("./activityLog.controller");

// Mengambil semua riwayat
router.get("/", ActivityLog.getAll);

// Menambahkan riwayat
router.post("/", ActivityLog.create);

// Menghapus semua riwayat
router.delete("/", ActivityLog.deleteAll);

module.exports = router;
