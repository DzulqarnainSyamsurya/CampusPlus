
const db = require('../../config/database');

// Mengambil semua jadwal
exports.getAll = () => {
    return db.prepare(`
        SELECT * FROM schedules
        ORDER BY
            CASE day
                WHEN 'Senin' THEN 1
                WHEN 'Selasa' THEN 2
                WHEN 'Rabu' THEN 3
                WHEN 'Kamis' THEN 4
                WHEN 'Jumat' THEN 5
                WHEN 'Sabtu' THEN 6
                WHEN 'Minggu' THEN 7
            END,
            start_time ASC
    `).all();
};

exports.getOccurrences = (from, to, timezoneOffset = 0) => {
    const schedules = exports.getAll();
    const exceptions = db.prepare(`
        SELECT * FROM schedule_exceptions
        WHERE occurrence_date BETWEEN ? AND ?
    `).all(from, to);
    const exceptionByOccurrence = new Map(
        exceptions.map((exception) => [
            `${exception.schedule_id}:${exception.occurrence_date}`,
            exception
        ])
    );
    const startDate = new Date(`${from}T00:00:00.000Z`);
    const endDate = new Date(`${to}T00:00:00.000Z`);
    const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const now = Date.now();
    const occurrences = [];

    for (const date = new Date(startDate); date <= endDate; date.setUTCDate(date.getUTCDate() + 1)) {
        const occurrenceDate = date.toISOString().slice(0, 10);
        const day = dayNames[date.getUTCDay()];

        for (const schedule of schedules) {
            if (schedule.day !== day) continue;

            const exception = exceptionByOccurrence.get(`${schedule.id}:${occurrenceDate}`);
            const [year, month, dayOfMonth] = occurrenceDate.split('-').map(Number);
            const [startHour, startMinute] = schedule.start_time.split(':').map(Number);
            const [endHour, endMinute] = schedule.end_time.split(':').map(Number);
            const startAt = Date.UTC(year, month - 1, dayOfMonth, startHour, startMinute) + timezoneOffset * 60000;
            const endAt = Date.UTC(year, month - 1, dayOfMonth, endHour, endMinute) + timezoneOffset * 60000;
            let automaticStatus = 'Terjadwal';

            if (now >= endAt) {
                automaticStatus = 'Selesai';
            } else if (now >= startAt) {
                automaticStatus = 'Berlangsung';
            } else if (startAt - now <= 60 * 60000) {
                automaticStatus = 'Akan Berlangsung';
            }

            occurrences.push({
                schedule_id: schedule.id,
                occurrence_date: occurrenceDate,
                course_name: schedule.course_name,
                lecturer: schedule.lecturer,
                day,
                start_time: schedule.start_time,
                end_time: schedule.end_time,
                room: exception?.room || schedule.room,
                status: exception?.status || automaticStatus,
                note: exception?.note || '',
                manual_status: Boolean(exception)
            });
        }
    }

    return occurrences.sort((left, right) =>
        left.occurrence_date.localeCompare(right.occurrence_date) ||
        left.start_time.localeCompare(right.start_time) ||
        left.schedule_id - right.schedule_id
    );
};

exports.getException = (scheduleId, occurrenceDate) => {
    return db.prepare(`
        SELECT * FROM schedule_exceptions
        WHERE schedule_id = ? AND occurrence_date = ?
    `).get(scheduleId, occurrenceDate);
};

exports.saveException = (scheduleId, occurrenceDate, status, note, room) => {
    return db.prepare(`
        INSERT INTO schedule_exceptions (schedule_id, occurrence_date, status, note, room)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (schedule_id, occurrence_date) DO UPDATE SET
            status = excluded.status,
            note = excluded.note,
            room = excluded.room,
            updated_at = CURRENT_TIMESTAMP
    `).run(scheduleId, occurrenceDate, status, note, room || null);
};

// Mengambil jadwal berdasarkan ID
exports.getById = (id) => {
    return db.prepare(`
        SELECT * FROM schedules
        WHERE id = ?
    `).get(id);
};

// Menambahkan jadwal
exports.create = (data) => {
    return db.prepare(`
        INSERT INTO schedules (
            course_name,
            lecturer,
            day,
            start_time,
            end_time,
            room
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        data.course_name,
        data.lecturer,
        data.day,
        data.start_time,
        data.end_time,
        data.room || null
    );
};

// Memperbarui jadwal
exports.update = (id, data) => {
    return db.prepare(`
        UPDATE schedules
        SET
            course_name = ?,
            lecturer = ?,
            day = ?,
            start_time = ?,
            end_time = ?,
            room = ?
        WHERE id = ?
    `).run(
        data.course_name,
        data.lecturer,
        data.day,
        data.start_time,
        data.end_time,
        data.room || null,
        id
    );
};

// Menghapus jadwal
exports.remove = (id) => {
    return db.prepare(`
        DELETE FROM schedules
        WHERE id = ?
    `).run(id);
};
// Memeriksa jadwal yang bentrok
exports.checkConflict = (day, start_time, end_time, excludeId = null) => {
    return db.prepare(`
        SELECT * FROM schedules
        WHERE day = ?
        AND (? IS NULL OR id != ?)
        AND start_time < ?
        AND end_time > ?
    `).all(
        day,
        excludeId,
        excludeId,
        end_time,
        start_time
    );
};
