const Task = require('./task.model');
const ActivityLog = require('../activity-logs/activityLog.model');

// Mengambil semua tugas
exports.getAll = (req, res) => {
    try {
        const tasks = Task.getAll();
        res.json(tasks);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal mengambil data tugas.'
        });
    }
};

// Mengambil tugas berdasarkan ID
exports.getById = (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                message: 'ID tugas tidak valid.'
            });
        }

        const task = Task.getById(id);

        if (!task) {
            return res.status(404).json({
                message: 'Tugas tidak ditemukan.'
            });
        }

        res.json(task);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal mengambil detail tugas.'
        });
    }
};

// Menambahkan tugas
exports.create = (req, res) => {
    try {
        const {
            title,
            description,
            course_name,
            deadline,
            status
        } = req.body;

        if (
            typeof title !== 'string' ||
            !title.trim() ||
            typeof course_name !== 'string' ||
            !course_name.trim() ||
            typeof deadline !== 'string' ||
            !deadline.trim() ||
            (description !== undefined && typeof description !== 'string')
        ) {
            return res.status(400).json({
                message: 'Data tugas tidak valid. Periksa judul, mata kuliah, deskripsi, dan deadline.'
            });
        }

        const validStatuses = [
            'Belum Dikerjakan',
            'Sedang Dikerjakan',
            'Selesai'
        ];

        const taskStatus = status || 'Belum Dikerjakan';

        if (!validStatuses.includes(taskStatus)) {
            return res.status(400).json({
                message: 'Status tugas tidak valid.'
            });
        }

        const deadlineDate = new Date(deadline);

        if (Number.isNaN(deadlineDate.getTime())) {
            return res.status(400).json({
                message: 'Format deadline tidak valid.'
            });
        }

        const result = Task.create({
            title: title.trim(),
            description: description?.trim() || '',
            course_name: course_name.trim(),
            deadline,
            status: taskStatus
        });

         ActivityLog.create(
            'Tambah Tugas',
            `Menambahkan tugas ${title.trim()} pada mata kuliah ${course_name.trim()}`
        );

        res.status(201).json({
            message: 'Tugas berhasil ditambahkan.',
            id: result.lastInsertRowid
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal menambahkan tugas.'
        });
    }
};

// Mengedit tugas
exports.update = (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                message: 'ID tugas tidak valid.'
            });
        }

        const existingTask = Task.getById(id);

        if (!existingTask) {
            return res.status(404).json({
                message: 'Tugas tidak ditemukan.'
            });
        }

        const {
            title,
            description,
            course_name,
            deadline,
            status
        } = req.body;

        if (
            typeof title !== 'string' ||
            !title.trim() ||
            typeof course_name !== 'string' ||
            !course_name.trim() ||
            typeof deadline !== 'string' ||
            !deadline.trim() ||
            (description !== undefined && typeof description !== 'string')
        ) {
            return res.status(400).json({
                message: 'Data tugas tidak valid. Periksa judul, mata kuliah, deskripsi, dan deadline.'
            });
        }

        const validStatuses = [
            'Belum Dikerjakan',
            'Sedang Dikerjakan',
            'Selesai'
        ];

        if (
            typeof status !== 'string' ||
            !validStatuses.includes(status)
        ) {
            return res.status(400).json({
                message: 'Status tugas tidak valid.'
            });
        }

        const deadlineDate = new Date(deadline);

        if (Number.isNaN(deadlineDate.getTime())) {
            return res.status(400).json({
                message: 'Format deadline tidak valid.'
            });
        }

        Task.update(id, {
            title: title.trim(),
            description: description?.trim() || '',
            course_name: course_name.trim(),
            deadline,
            status
        });

        ActivityLog.create(
            'Edit Tugas',
            `Memperbarui tugas ${title.trim()} pada mata kuliah ${course_name.trim()}`
        );

        res.json({
            message: 'Tugas berhasil diperbarui.'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal memperbarui tugas.'
        });
    }
};

// Menghapus tugas
exports.remove = (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({
                message: 'ID tugas tidak valid.'
            });
        }

        const existingTask = Task.getById(id);

        if (!existingTask) {
            return res.status(404).json({
                message: 'Tugas tidak ditemukan.'
            });
        }

        Task.remove(id);

        ActivityLog.create(
            'Hapus Tugas',
            `Menghapus tugas ${existingTask.title} pada mata kuliah ${existingTask.course_name}`
        );

        res.json({
            message: 'Tugas berhasil dihapus.'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal menghapus tugas.'
        });
    }
};
