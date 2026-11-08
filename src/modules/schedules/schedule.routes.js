
const express = require('express');
const router = express.Router();

const controller = require('./schedule.controller');

router.get('/occurrences', controller.getOccurrences);
router.put('/occurrences/:scheduleId/:date', controller.updateOccurrence);

// Mengambil semua jadwal
router.get('/', controller.getAll);

// Mengambil jadwal berdasarkan ID
router.get('/:id', controller.getById);

router.post('/', controller.create);

// Memperbarui jadwal
router.put('/:id', controller.update);

// Menghapus jadwal
router.delete('/:id', controller.remove);

module.exports = router;
