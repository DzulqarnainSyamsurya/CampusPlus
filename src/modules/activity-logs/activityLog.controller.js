const ActivityLog = require("./activityLog.model");

// Mengambil semua riwayat aktivitas
exports.getAll = (req, res) => {
    try {
        if (req.query.page !== undefined || req.query.limit !== undefined) {
            const page = Number(req.query.page ?? 1);
            const limit = Number(req.query.limit ?? 10);
            const activity = req.query.activity;

            if (
                !Number.isInteger(page) || page < 1 ||
                !Number.isInteger(limit) || limit < 1 || limit > 100 ||
                (activity !== undefined && typeof activity !== "string")
            ) {
                return res.status(400).json({
                    message: "Parameter pagination tidak valid."
                });
            }

            const result = ActivityLog.getPage(page, limit, activity);
            return res.json({
                data: result.data,
                page,
                limit,
                total: result.total,
                totalPages: Math.ceil(result.total / limit)
            });
        }

        const logs = ActivityLog.getAll();

        res.json(logs);
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Gagal mengambil riwayat aktivitas."
        });
    }
};

// Menambahkan riwayat aktivitas
exports.create = (req, res) => {
    try {
        const { activity, description } = req.body;

        if (
            typeof activity !== "string" || !activity.trim() ||
            (description !== undefined && typeof description !== "string")
        ) {
            return res.status(400).json({
                message: "Nama aktivitas wajib diisi."
            });
        }

        ActivityLog.create(
            activity.trim(),
            description?.trim() || ""
        );

        res.status(201).json({
            message: "Aktivitas berhasil dicatat."
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Gagal mencatat aktivitas."
        });
    }
};

// Menghapus seluruh riwayat aktivitas
exports.deleteAll = (req, res) => {
    try {
        ActivityLog.deleteAll();

        res.json({
            message: "Seluruh riwayat berhasil dihapus."
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            message: "Gagal menghapus riwayat aktivitas."
        });
    }
};
