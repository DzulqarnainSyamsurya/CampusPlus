const express = require('express');
const router = express.Router();

const controller = require('./task.controller');

// Mengambil semua tugas
router.get('/', controller.getAll);

// Mengambil tugas berdasarkan ID
router.get('/:id', controller.getById);

// Menambahkan tugas
router.post('/', controller.create);

// Mengedit tugas
router.put('/:id', controller.update);

// Menghapus tugas
router.delete('/:id', controller.remove);

module.exports = router;
