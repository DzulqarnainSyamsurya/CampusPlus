const db = require('../../config/database');
const ActivityLog = require('../activity-logs/activityLog.model');

// GET: mengambil semua pengumuman
exports.getAll = (req, res) => {
    try {
        const announcements = db.prepare(`
            SELECT * FROM announcements
            ORDER BY created_at DESC
        `).all();

        res.json(announcements);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal mengambil pengumuman.'
        });
    }
};

// POST: menambahkan pengumuman
exports.create = (req, res) => {
    const { title, content, category } = req.body;

    if (
        typeof title !== 'string' ||
        !title.trim() ||
        typeof content !== 'string' ||
        !content.trim() ||
        (category !== undefined && typeof category !== 'string')
    ) {
        return res.status(400).json({
            message: 'Data pengumuman tidak valid. Periksa judul, isi, dan kategori.'
        });
    }

    try {
        const result = db.prepare(`
            INSERT INTO announcements (title, content, category)
            VALUES (?, ?, ?)
        `).run(
            title.trim(),
            content.trim(),
            category || 'Informasi Akademik'
        );

        ActivityLog.create(
            'Tambah Pengumuman',
            `Menambahkan pengumuman: ${title.trim()}`
        );

        res.status(201).json({
            message: 'Pengumuman berhasil ditambahkan.',
            id: result.lastInsertRowid
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal menambahkan pengumuman.'
        });
    }
};

// PUT: mengedit pengumuman
exports.update = (req, res) => {
    const { id } = req.params;
    const { title, content, category } = req.body;
    const announcementId = Number(id);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
        return res.status(400).json({
            message: 'ID pengumuman tidak valid.'
        });
    }

    if (
        typeof title !== 'string' ||
        !title.trim() ||
        typeof content !== 'string' ||
        !content.trim() ||
        (category !== undefined && typeof category !== 'string')
    ) {
        return res.status(400).json({
            message: 'Data pengumuman tidak valid. Periksa judul, isi, dan kategori.'
        });
    }

    try {
        const result = db.prepare(`
            UPDATE announcements
            SET title = ?, content = ?, category = ?
            WHERE id = ?
        `).run(
            title.trim(),
            content.trim(),
            category || 'Informasi Akademik',
            announcementId
        );

        if (result.changes === 0) {
            return res.status(404).json({
                message: 'Pengumuman tidak ditemukan.'
            });
        }

        ActivityLog.create(
            'Edit Pengumuman',
            `Memperbarui pengumuman: ${title.trim()}`
        );

        res.json({
            message: 'Pengumuman berhasil diperbarui.'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal memperbarui pengumuman.'
        });
    }
};

// DELETE: menghapus pengumuman
exports.remove = (req, res) => {
    const { id } = req.params;
    const announcementId = Number(id);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
        return res.status(400).json({
            message: 'ID pengumuman tidak valid.'
        });
    }

    try {
        // Ambil data pengumuman sebelum dihapus
        const announcement = db.prepare(`
            SELECT title FROM announcements WHERE id = ?
        `).get(announcementId);

        if (!announcement) {
            return res.status(404).json({
                message: 'Pengumuman tidak ditemukan.'
            });
        }

        // Hapus pengumuman
        const result = db.prepare(`
            DELETE FROM announcements
            WHERE id = ?
        `).run(announcementId);

        if (result.changes === 0) {
            return res.status(404).json({
                message: 'Pengumuman tidak ditemukan.'
            });
        }

        // Catat aktivitas
        ActivityLog.create(
            'Hapus Pengumuman',
            `Menghapus pengumuman: ${announcement.title}`
        );

        res.json({
            message: 'Pengumuman berhasil dihapus.'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: 'Gagal menghapus pengumuman.'
        });
    }
};
