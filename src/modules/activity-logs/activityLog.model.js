const db = require("../../config/database");

// Mengambil semua riwayat aktivitas
exports.getAll = () => {
    return db.prepare(`
        SELECT * FROM activity_logs
        ORDER BY created_at DESC, id DESC
    `).all();
};

exports.getPage = (page, limit, activity) => {
    const offset = (page - 1) * limit;
    const filter = activity ? 'WHERE activity = ?' : '';
    const parameters = activity ? [activity, limit, offset] : [limit, offset];
    return {
        data: db.prepare(`
            SELECT * FROM activity_logs
            ${filter}
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
        `).all(...parameters),
        total: db.prepare(`
            SELECT COUNT(*) AS count FROM activity_logs ${filter}
        `).get(...(activity ? [activity] : [])).count
    };
};

// Menambahkan aktivitas baru
exports.create = (activity, description) => {
    return db.prepare(`
        INSERT INTO activity_logs (activity, description)
        VALUES (?, ?)
    `).run(activity, description);
};

// Menghapus seluruh riwayat aktivitas
exports.deleteAll = () => {
    return db.prepare(`
        DELETE FROM activity_logs
    `).run();
};
