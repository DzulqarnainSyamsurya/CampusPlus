
const express = require('express');
const router = express.Router();

const controller = require('./announcement.controller');

// GET: mengambil semua pengumuman
router.get('/', controller.getAll);

// POST: menambahkan pengumuman
router.post('/', controller.create);

// PUT: mengedit pengumuman berdasarkan ID
router.put('/:id', controller.update);

// DELETE: menghapus pengumuman berdasarkan ID
router.delete('/:id', controller.remove);

module.exports = router;
