const Schedule = require('./schedule.model');
const ActivityLog = require('../activity-logs/activityLog.model');
const occurrenceStatuses = [
    'Terjadwal',
    'Akan Berlangsung',
    'Berlangsung',
    'Selesai',
    'Dosen Tidak Masuk',
    'Kuliah Diliburkan',
    'Kuliah Ditunda',
    'Pindah Ruangan',
    'Kuliah Online',
    'Diganti Dosen Lain'
];

function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

exports.getOccurrences = (req, res) => {
    const { from, to } = req.query;
    const timezoneOffset = Number(req.query.timezoneOffset ?? 0);

    if (
        !isValidDate(from) || !isValidDate(to) || to < from ||
        !Number.isInteger(timezoneOffset) || Math.abs(timezoneOffset) > 840
    ) {
        return res.status(400).json({
            message: 'Rentang tanggal atau zona waktu tidak valid.'
        });
    }

    const dayCount = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;

    if (dayCount > 31) {
        return res.status(400).json({
            message: 'Rentang jadwal maksimal 32 hari.'
        });
    }

    try {
        res.json(Schedule.getOccurrences(from, to, timezoneOffset));
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal mengambil occurrence jadwal.'
        });
    }
};

exports.updateOccurrence = (req, res) => {
    const scheduleId = Number(req.params.scheduleId);
    const occurrenceDate = req.params.date;
    const { status, note, room } = req.body;
    const timezoneOffset = Number(req.query.timezoneOffset ?? 0);

    if (
        !Number.isInteger(scheduleId) || scheduleId <= 0 || !isValidDate(occurrenceDate) ||
        !Number.isInteger(timezoneOffset) || Math.abs(timezoneOffset) > 840
    ) {
        return res.status(400).json({
            message: 'ID jadwal atau tanggal pertemuan tidak valid.'
        });
    }

    if (
        typeof status !== 'string' || !occurrenceStatuses.includes(status) ||
        (note !== undefined && typeof note !== 'string') ||
        (room !== undefined && room !== null && typeof room !== 'string')
    ) {
        return res.status(400).json({
            message: 'Status, keterangan, atau ruangan pertemuan tidak valid.'
        });
    }

    try {
        const schedule = Schedule.getById(scheduleId);

        if (!schedule) {
            return res.status(404).json({
                message: 'Jadwal reguler tidak ditemukan.'
            });
        }

        const weekdays = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
        const occurrenceDay = weekdays[new Date(`${occurrenceDate}T00:00:00.000Z`).getUTCDay()];

        if (schedule.day !== occurrenceDay) {
            return res.status(400).json({
                message: 'Tanggal tersebut bukan occurrence dari jadwal reguler ini.'
            });
        }

        Schedule.saveException(
            scheduleId,
            occurrenceDate,
            status,
            note?.trim() || '',
            room?.trim() || null
        );

        ActivityLog.create(
            'Ubah Status Jadwal',
            `${schedule.course_name} pada ${occurrenceDate}: ${status}${note?.trim() ? ` - ${note.trim()}` : ''}`
        );

        const occurrence = Schedule.getOccurrences(
            occurrenceDate,
            occurrenceDate,
            timezoneOffset
        )[0];

        res.json({
            message: 'Status pertemuan berhasil disimpan.',
            occurrence
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal menyimpan status pertemuan.'
        });
    }
};

// Mengambil semua jadwal
exports.getAll = (req, res) => {
    try {
        const schedules = Schedule.getAll();
        res.json(schedules);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal mengambil data jadwal.'
        });
    }
};

// Mengambil jadwal berdasarkan ID
exports.getById = (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: 'ID jadwal tidak valid.'
        });
    }    
    try {
        const schedule = Schedule.getById(id);

        if (!schedule) {
            return res.status(404).json({
                message: 'Jadwal tidak ditemukan.'
            });
        }

        res.json(schedule);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal mengambil jadwal.'
        });
    }
};

// Menambahkan jadwal
exports.create = (req, res) => {
    const {
        course_name,
        lecturer,
        day,
        start_time,
        end_time,
        room
    } = req.body;

    if (
        typeof course_name !== 'string' || !course_name.trim() ||
        typeof lecturer !== 'string' || !lecturer.trim() ||
        typeof day !== 'string' || !day.trim() ||
        typeof start_time !== 'string' || !start_time.trim() ||
        typeof end_time !== 'string' || !end_time.trim() ||
        (room !== undefined && room !== null && typeof room !== 'string')
    ) {
        return res.status(400).json({
            message: 'Nama mata kuliah, dosen, hari, dan waktu wajib diisi.'
        });
    }

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

if (!timePattern.test(start_time) || !timePattern.test(end_time)) {
    return res.status(400).json({
        message: 'Format waktu harus menggunakan HH:MM yang valid.'
    });
}

    if (end_time <= start_time) {
        return res.status(400).json({
            message: 'Jam selesai harus lebih besar dari jam mulai.'
        });
    }

    const validDays = [
        'Senin',
        'Selasa',
        'Rabu',
        'Kamis',
        'Jumat',
        'Sabtu',
        'Minggu'
    ];

    if (!validDays.includes(day.trim())) {
        return res.status(400).json({
            message: 'Hari yang dimasukkan tidak valid.'
        });
    }

    try {
    const conflicts = Schedule.checkConflict(
        day.trim(),
        start_time.trim(),
        end_time.trim()
    );

    if (conflicts.length > 0) {
        return res.status(409).json({
            message: 'Jadwal bentrok dengan jadwal lain pada hari dan waktu tersebut.'
        });
    }

    const result = Schedule.create({
            course_name: course_name.trim(),
            lecturer: lecturer.trim(),
            day: day.trim(),
            start_time: start_time.trim(),
            end_time: end_time.trim(),
            room: room?.trim()
        });

        ActivityLog.create(
            'Tambah Jadwal',
            `Menambahkan jadwal ${course_name.trim()} pada hari ${day.trim()}`
        );

        res.status(201).json({
            message: 'Jadwal berhasil ditambahkan.',
            id: result.lastInsertRowid
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal menambahkan jadwal.'
        });
    }
};

// Memperbarui jadwal
exports.update = (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: 'ID jadwal tidak valid.'
        });
    }    
    const {
        course_name,
        lecturer,
        day,
        start_time,
        end_time,
        room
    } = req.body;

    if (
        typeof course_name !== 'string' || !course_name.trim() ||
        typeof lecturer !== 'string' || !lecturer.trim() ||
        typeof day !== 'string' || !day.trim() ||
        typeof start_time !== 'string' || !start_time.trim() ||
        typeof end_time !== 'string' || !end_time.trim() ||
        (room !== undefined && room !== null && typeof room !== 'string')
    ) {
        return res.status(400).json({
            message: 'Data jadwal wajib diisi.'
        });
    }

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

if (!timePattern.test(start_time) || !timePattern.test(end_time)) {
    return res.status(400).json({
        message: 'Format waktu harus menggunakan HH:MM yang valid.'
    });
}

    if (end_time <= start_time) {
        return res.status(400).json({
            message: 'Jam selesai harus lebih besar dari jam mulai.'
        });
    }

    const validDays = [
        'Senin',
        'Selasa',
        'Rabu',
        'Kamis',
        'Jumat',
        'Sabtu',
        'Minggu'
    ];

    if (!validDays.includes(day.trim())) {
        return res.status(400).json({
            message: 'Hari yang dimasukkan tidak valid.'
        });
    }

    try {
        const conflicts = Schedule.checkConflict(
    day.trim(),
    start_time.trim(),
    end_time.trim(),
    id
);

if (conflicts.length > 0) {
    return res.status(409).json({
        message: 'Jadwal bentrok dengan jadwal lain pada hari dan waktu tersebut.'
    });
}
        const existingSchedule = Schedule.getById(id);

        if (!existingSchedule) {
            return res.status(404).json({
                message: 'Jadwal tidak ditemukan.'
            });
        }

        const result = Schedule.update(id, {
            course_name: course_name.trim(),
            lecturer: lecturer.trim(),
            day: day.trim(),
            start_time: start_time.trim(),
            end_time: end_time.trim(),
            room: room?.trim()
        });

        if (result.changes === 0) {
            return res.status(404).json({
                message: 'Jadwal tidak ditemukan.'
            });
        }

        ActivityLog.create(
            'Edit Jadwal',
            `Memperbarui jadwal ${course_name.trim()} pada hari ${day.trim()}`
        );

        res.json({
            message: 'Jadwal berhasil diperbarui.'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal memperbarui jadwal.'
        });
    }
};

// Menghapus jadwal
exports.remove = (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
            message: 'ID jadwal tidak valid.'
        });
    }

    try {
        const schedule = Schedule.getById(id);

        if (!schedule) {
            return res.status(404).json({
                message: 'Jadwal tidak ditemukan.'
            });
        }

        const result = Schedule.remove(id);

        if (result.changes === 0) {
            return res.status(404).json({
                message: 'Jadwal tidak ditemukan.'
            });
        }

        ActivityLog.create(
            'Hapus Jadwal',
            `Menghapus jadwal ${schedule.course_name} pada hari ${schedule.day}`
        );

        res.json({
            message: 'Jadwal berhasil dihapus.'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal menghapus jadwal.'
        });
    }
};
