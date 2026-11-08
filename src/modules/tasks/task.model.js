const db = require('../../config/database');

// Mengambil semua tugas
exports.getAll = () => {
    return db.prepare(`
        SELECT * FROM tasks
        ORDER BY deadline ASC
    `).all();
};

// Mengambil tugas berdasarkan ID
exports.getById = (id) => {
    return db.prepare(`
        SELECT * FROM tasks
        WHERE id = ?
    `).get(id);
};

// Menambahkan tugas
exports.create = (data) => {
    return db.prepare(`
        INSERT INTO tasks (
            title,
            description,
            course_name,
            deadline,
            status
        )
        VALUES (?, ?, ?, ?, ?)
    `).run(
        data.title,
        data.description,
        data.course_name,
        data.deadline,
        data.status || 'Belum Dikerjakan'
    );
};

// Mengedit tugas
exports.update = (id, data) => {
    return db.prepare(`
        UPDATE tasks
        SET
            title = ?,
            description = ?,
            course_name = ?,
            deadline = ?,
            status = ?
        WHERE id = ?
    `).run(
        data.title,
        data.description,
        data.course_name,
        data.deadline,
        data.status,
        id
    );
};

// Menghapus tugas
exports.remove = (id) => {
    return db.prepare(`
        DELETE FROM tasks
        WHERE id = ?
    `).run(id);
};
