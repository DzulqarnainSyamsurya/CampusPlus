const pageTitles = {
  dashboard: "Dashboard",
  pengumuman: "Pengumuman",
  jadwal: "Jadwal Kuliah",
  tugas: "Tugas & Deadline",
  aktivitas: "Riwayat Aktivitas",
  profile: "Profil Saya",
  settings: "Account Settings",
  "change-password": "Ganti Password",
};

const classStatuses = [
  "Terjadwal",
  "Akan Berlangsung",
  "Berlangsung",
  "Selesai",
  "Dosen Tidak Masuk",
  "Kuliah Diliburkan",
  "Kuliah Ditunda",
  "Pindah Ruangan",
  "Kuliah Online",
  "Diganti Dosen Lain",
];

const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const occurrenceDialog = document.getElementById("occurrenceDialog");
const recordDialog = document.getElementById("recordDialog");
let activeRoute = "";
let themePreference = 'system';
let announcements = [];
let schedules = [];
let tasks = [];
let calendarDate = new Date();
let selectedOccurrence = null;
let saveRecordHandler = null;
let currentUser = null;
let avatarPreviewUrl = null;
let activityPage = 1;
let activityPages = 0;
const activityLimit = 10;

function escapeHTML(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (character) => entities[character]);
}

async function api(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...options.headers };
  const isFormData = options.body instanceof FormData;
  if (options.body && !isFormData && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrfResponse = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
    const csrfResult = await csrfResponse.json();
    if (!csrfResponse.ok) throw new Error(csrfResult.message || 'Sesi keamanan tidak tersedia.');
    headers['X-CSRF-Token'] = csrfResult.csrfToken;
  }

  const response = await fetch(url, {
    ...options,
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
  });
  const result = response.status === 204 ? null : await response.json();
  if (response.status === 401) {
    location.replace('/login');
    throw new Error('Sesi berakhir. Silakan login kembali.');
  }
  if (!response.ok) throw new Error(result?.message || "Permintaan tidak dapat diproses.");
  return result;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftDate(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function dateLabel(dateKey, options = {}) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("id-ID", options);
}

function formatTime(dateTime) {
  return new Date(dateTime).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function formatTimestamp(value) {
  const date = new Date(`${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? "Waktu tidak tersedia"
    : `${date.toLocaleDateString("id-ID", { dateStyle: "medium" })}, ${formatTime(date)}`;
}

function emptyState(message, isError = false) {
  const element = document.createElement("p");
  element.className = isError ? "empty-state error-state" : "empty-state";
  element.textContent = message;
  return element;
}

function setLoading(container, message = "Memuat data...") {
  if (container) container.replaceChildren(emptyState(message));
}

function setError(container, error) {
  if (container) container.replaceChildren(emptyState(error.message || "Gagal memuat data.", true));
}

function updateDateLabels() {
  const now = new Date();
  document.getElementById("topbarDate").textContent = now.toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  document.getElementById("currentDate").textContent = now.toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function routeTo(route) {
  const nextRoute = pageTitles[route] ? route : "dashboard";
  if (location.hash !== `#${nextRoute}`) {
    location.hash = nextRoute;
    return;
  }
  renderRoute();
}

function renderRoute() {
  const requestedRoute = location.hash.slice(1);
  const route = pageTitles[requestedRoute] ? requestedRoute : "dashboard";
  if (location.hash !== `#${route}`) history.replaceState(null, "", `#${route}`);

  document.querySelectorAll(".page-view").forEach((view) => {
    view.hidden = view.dataset.page !== route;
  });
  document.querySelectorAll(".nav-link[data-route]").forEach((link) => {
    const active = link.dataset.route === route;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.getElementById("pageTitle").textContent = pageTitles[route];
  document.getElementById("pageEyebrow").textContent = `CAMPUSPLUS / ${pageTitles[route].toLocaleUpperCase("id-ID")}`;
  document.title = `CampusPlus | ${pageTitles[route]}`;
  document.getElementById("sidebar").classList.remove("show");
  document.getElementById("sidebarScrim").classList.remove("show");

  const changedRoute = activeRoute !== route;
  if (changedRoute) {
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  }
  activeRoute = route;
  if (route === "dashboard") loadDashboard();
  if (route === "pengumuman") loadAnnouncements();
  if (route === "jadwal") loadSchedules();
  if (route === "tugas") loadTasksPage();
  if (route === "aktivitas" && changedRoute) {
    activityPage = 1;
    loadActivityPage();
  }
  if (route === 'profile') loadProfilePage();
  if (route === 'settings') loadSettingsPage();
}

function occurrenceUrl(from, to) {
  const params = new URLSearchParams({
    from,
    to,
    timezoneOffset: String(new Date().getTimezoneOffset()),
  });
  return `/api/schedules/occurrences?${params}`;
}

async function getOccurrences(from, to) {
  return api(occurrenceUrl(from, to));
}

function statusClass(status) {
  const classes = {
    "Terjadwal": "status-scheduled",
    "Akan Berlangsung": "status-soon",
    "Berlangsung": "status-live",
    "Selesai": "status-complete",
    "Dosen Tidak Masuk": "status-cancelled",
    "Kuliah Diliburkan": "status-cancelled",
    "Kuliah Ditunda": "status-delayed",
    "Pindah Ruangan": "status-changed",
    "Kuliah Online": "status-online",
    "Diganti Dosen Lain": "status-changed",
  };
  return classes[status] || "status-scheduled";
}

function makeStatusBadge(status) {
  const badge = document.createElement("span");
  badge.className = `status-badge ${statusClass(status)}`;
  badge.textContent = status;
  return badge;
}

function renderOccurrence(item, options = {}) {
  const card = document.createElement("article");
  card.className = "occurrence-card";

  const time = document.createElement("div");
  time.className = "occurrence-time";
  time.innerHTML = `<strong>${escapeHTML(item.start_time)}</strong><span>${escapeHTML(item.end_time)}</span>`;

  const details = document.createElement("div");
  details.className = "occurrence-details";
  const title = document.createElement("h3");
  title.textContent = item.course_name;
  const meta = document.createElement("p");
  meta.textContent = `Dosen: ${item.lecturer} · ${item.room || "Ruangan belum ditentukan"}`;
  details.append(title, meta);
  if (item.note) {
    const note = document.createElement("p");
    note.className = "occurrence-note";
    note.textContent = `Keterangan: ${item.note}`;
    details.appendChild(note);
  }

  const badge = makeStatusBadge(item.status);
  const actions = document.createElement("div");
  actions.className = "occurrence-actions";
  const statusButton = document.createElement("button");
  statusButton.type = "button";
  statusButton.className = "text-action";
  statusButton.textContent = "Status";
  statusButton.addEventListener("click", () => openOccurrenceDialog(item));
  actions.appendChild(statusButton);

  if (options.allowScheduleEdit) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "text-action";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => editSchedule(item.schedule));
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "text-action danger-action";
    deleteButton.textContent = "Hapus Rutin";
    deleteButton.addEventListener("click", () => deleteSchedule(item.schedule_id));
    actions.append(editButton, deleteButton);
  }

  card.append(time, details, badge, actions);
  return card;
}

async function loadDashboard() {
  const todayKey = localDateKey(new Date());
  const nextWeekKey = shiftDate(todayKey, 7);
  const todayContainer = document.getElementById("dashboardTodaySchedule");
  const upcomingContainer = document.getElementById("dashboardUpcomingSchedule");

  try {
    const [regularSchedules, occurrences, taskData, announcementData, activityData] = await Promise.all([
      api("/api/schedules"),
      getOccurrences(todayKey, nextWeekKey),
      api("/api/tasks"),
      api("/api/announcements"),
      api("/api/activity-logs?page=1&limit=3"),
    ]);
    const todayOccurrences = occurrences.filter((item) => item.occurrence_date === todayKey);
    const upcomingOccurrences = occurrences.filter((item) => item.occurrence_date > todayKey).slice(0, 5);

    document.getElementById("dashboardCourseCount").textContent = new Set(regularSchedules.map((item) => item.course_name)).size;
    document.getElementById("dashboardActiveTasks").textContent = taskData.filter((task) => task.status !== "Selesai").length;
    document.getElementById("dashboardCompletedTasks").textContent = taskData.filter((task) => task.status === "Selesai").length;
    document.getElementById("announcementCount").textContent = announcementData.length;

    todayContainer.replaceChildren();
    if (todayOccurrences.length === 0) todayContainer.appendChild(emptyState("Tidak ada jadwal kuliah hari ini."));
    else todayOccurrences.forEach((item) => todayContainer.appendChild(renderOccurrence(item)));

    upcomingContainer.replaceChildren();
    if (upcomingOccurrences.length === 0) upcomingContainer.appendChild(emptyState("Belum ada jadwal mendatang dalam 7 hari."));
    else upcomingOccurrences.forEach((item) => {
      const wrapper = document.createElement("div");
      wrapper.className = "upcoming-item";
      const date = document.createElement("p");
      date.className = "upcoming-date";
      date.textContent = dateLabel(item.occurrence_date, { weekday: "short", day: "numeric", month: "short" });
      wrapper.append(date, renderOccurrence(item));
      upcomingContainer.appendChild(wrapper);
    });

    renderDashboardTasks(taskData);
    renderDashboardAnnouncements(announcementData);
    renderDashboardActivities(activityData.data);
  } catch (error) {
    setError(todayContainer, error);
    setError(upcomingContainer, error);
    setError(document.getElementById("dashboardTaskList"), error);
    setError(document.getElementById("dashboardAnnouncementList"), error);
    setError(document.getElementById("dashboardActivityList"), error);
  }
}

function renderDashboardTasks(data) {
  const container = document.getElementById("dashboardTaskList");
  const upcoming = data.filter((task) => task.status !== "Selesai").slice(0, 5);
  container.replaceChildren();
  if (!upcoming.length) {
    container.appendChild(emptyState("Tidak ada tugas aktif."));
    return;
  }
  upcoming.forEach((task) => {
    const row = document.createElement("article");
    row.className = "compact-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = task.title;
    const meta = document.createElement("small");
    meta.textContent = task.course_name;
    copy.append(title, meta);
    const deadline = document.createElement("time");
    deadline.textContent = new Date(task.deadline).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
    row.append(copy, deadline);
    container.appendChild(row);
  });
}

function renderDashboardAnnouncements(data) {
  const container = document.getElementById("dashboardAnnouncementList");
  container.replaceChildren();
  const recent = data.slice(0, 3);
  if (!recent.length) {
    container.appendChild(emptyState("Belum ada pengumuman."));
    return;
  }
  recent.forEach((item) => {
    const row = document.createElement("article");
    row.className = "compact-row announcement-summary";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.title;
    const meta = document.createElement("small");
    meta.textContent = item.category;
    copy.append(title, meta);
    row.appendChild(copy);
    container.appendChild(row);
  });
}

function renderDashboardActivities(data) {
  const container = document.getElementById("dashboardActivityList");
  container.replaceChildren();
  if (!data.length) {
    container.appendChild(emptyState("Belum ada aktivitas."));
    return;
  }
  data.forEach((item) => {
    const row = document.createElement("article");
    row.className = "compact-row activity-summary";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.activity;
    const description = document.createElement("small");
    description.textContent = item.description || "Aktivitas akademik";
    copy.append(title, description);
    row.append(copy);
    container.appendChild(row);
  });
}

async function loadAnnouncements() {
  const container = document.getElementById("announcementList");
  setLoading(container, "Memuat pengumuman...");
  try {
    announcements = await api("/api/announcements");
    document.getElementById("announcementCount").textContent = announcements.length;
    renderAnnouncementList();
  } catch (error) {
    setError(container, error);
  }
}

function renderAnnouncementList() {
  const container = document.getElementById("announcementList");
  const keyword = document.getElementById("searchAnnouncement").value.trim().toLocaleLowerCase("id-ID");
  const filtered = announcements.filter((item) => `${item.title} ${item.content} ${item.category}`.toLocaleLowerCase("id-ID").includes(keyword));
  document.getElementById("announcementResultCount").textContent = `${filtered.length} pengumuman`;
  container.replaceChildren();
  if (!filtered.length) {
    container.appendChild(emptyState(announcements.length ? "Pengumuman tidak ditemukan." : "Belum ada pengumuman."));
    return;
  }
  filtered.forEach((item) => {
    const article = document.createElement("article");
    article.className = "announcement-card";
    const category = document.createElement("span");
    category.className = "announcement-category";
    category.textContent = item.category;
    const title = document.createElement("h3");
    title.textContent = item.title;
    const content = document.createElement("p");
    content.textContent = item.content;
    const meta = document.createElement("time");
    meta.textContent = formatTimestamp(item.created_at);
    const actions = document.createElement("div");
    actions.className = "item-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary-action";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openAnnouncementDialog(item));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet-danger";
    remove.textContent = "Hapus";
    remove.addEventListener("click", () => deleteAnnouncement(item.id));
    actions.append(edit, remove);
    article.append(category, title, content, meta, actions);
    container.appendChild(article);
  });
}

const announcementCategories = ["Informasi Akademik", "Perkuliahan", "Program Studi", "Kegiatan Kampus"];

function openAnnouncementDialog(item = null) {
  openRecordDialog(item ? "Edit Pengumuman" : "Tambah Pengumuman", [
    { name: "title", label: "Judul Pengumuman", value: item?.title || "", required: true },
    { name: "category", label: "Kategori", type: "select", value: item?.category || announcementCategories[0], options: announcementCategories.map((value) => ({ value, label: value })) },
    { name: "content", label: "Isi Pengumuman", type: "textarea", value: item?.content || "", required: true },
  ], async (values) => {
    await api(item ? `/api/announcements/${item.id}` : "/api/announcements", { method: item ? "PUT" : "POST", body: JSON.stringify(values) });
    await Promise.all([loadAnnouncements(), loadDashboard()]);
    await refreshActivity();
  });
}

async function deleteAnnouncement(id) {
  if (!confirm("Hapus pengumuman ini?")) return;
  try {
    await api(`/api/announcements/${id}`, { method: "DELETE" });
    await Promise.all([loadAnnouncements(), loadDashboard(), refreshActivity()]);
  } catch (error) {
    alert(error.message);
  }
}

function weekRange(selectedDate) {
  const [year, month, day] = selectedDate.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  const startKey = localDateKey(start);
  return { from: startKey, to: shiftDate(startKey, 6) };
}

async function loadSchedules() {
  const container = document.getElementById("scheduleList");
  setLoading(container, "Memuat jadwal mingguan...");
  const dateInput = document.getElementById("scheduleDate");
  if (!dateInput.value) dateInput.value = localDateKey(new Date());
  const range = weekRange(dateInput.value);
  const filterDay = document.getElementById("filterDay").value;

  try {
    const [occurrences, regularSchedules] = await Promise.all([
      getOccurrences(range.from, range.to),
      api("/api/schedules"),
    ]);
    schedules = regularSchedules;
    const filtered = filterDay === "Semua" ? occurrences : occurrences.filter((item) => item.day === filterDay);
    const weekStart = dateLabel(range.from, { day: "numeric", month: "short" });
    const weekEnd = dateLabel(range.to, { day: "numeric", month: "short", year: "numeric" });
    document.getElementById("scheduleWeekLabel").textContent = `${weekStart} – ${weekEnd}`;
    renderWeekSchedule(filtered, range, regularSchedules);
  } catch (error) {
    setError(container, error);
  }
}

function renderWeekSchedule(occurrences, range, regularSchedules) {
  const container = document.getElementById("scheduleList");
  container.replaceChildren();
  const renderedScheduleControls = new Set();
  const selectedDay = document.getElementById("filterDay").value;
  const dateKeys = Array.from({ length: 7 }, (_, index) => shiftDate(range.from, index));
  const hasOccurrences = occurrences.length > 0;

  if (!hasOccurrences) {
    container.appendChild(emptyState("Tidak ada jadwal pada rentang tanggal ini."));
    return;
  }

  dateKeys.forEach((dateKey) => {
    const day = dayNames[new Date(`${dateKey}T12:00:00`).getDay()];
    if (selectedDay !== "Semua" && selectedDay !== day) return;
    const dayItems = occurrences.filter((item) => item.occurrence_date === dateKey);
    const group = document.createElement("section");
    group.className = "day-group";
    const heading = document.createElement("div");
    heading.className = "day-group-heading";
    const title = document.createElement("h3");
    title.textContent = dateLabel(dateKey, { weekday: "long", day: "numeric", month: "long" });
    const count = document.createElement("span");
    count.textContent = `${dayItems.length} kelas`;
    heading.append(title, count);
    group.appendChild(heading);

    if (!dayItems.length) group.appendChild(emptyState("Tidak ada kuliah."));
    dayItems.forEach((item) => {
      const schedule = regularSchedules.find((entry) => entry.id === item.schedule_id);
      const showControls = schedule && !renderedScheduleControls.has(item.schedule_id);
      renderedScheduleControls.add(item.schedule_id);
      group.appendChild(renderOccurrence({ ...item, schedule }, { allowScheduleEdit: showControls }));
    });
    container.appendChild(group);
  });
}

function openScheduleDialog(schedule = null) {
  const days = dayNames.slice(1).concat(dayNames[0]);
  openRecordDialog(schedule ? "Edit Jadwal Rutin" : "Tambah Jadwal Rutin", [
    { name: "course_name", label: "Nama Mata Kuliah", value: schedule?.course_name || "", required: true },
    { name: "lecturer", label: "Nama Dosen", value: schedule?.lecturer || "", required: true },
    { name: "day", label: "Hari", type: "select", value: schedule?.day || "Senin", options: days.map((value) => ({ value, label: value })) },
    { name: "start_time", label: "Jam Mulai", type: "time", value: schedule?.start_time || "", required: true },
    { name: "end_time", label: "Jam Selesai", type: "time", value: schedule?.end_time || "", required: true },
    { name: "room", label: "Ruangan", value: schedule?.room || "" },
  ], async (values) => {
    await api(schedule ? `/api/schedules/${schedule.id}` : "/api/schedules", { method: schedule ? "PUT" : "POST", body: JSON.stringify(values) });
    await Promise.all([loadSchedules(), loadDashboard()]);
    await refreshActivity();
  });
}

async function deleteSchedule(id) {
  if (!confirm("Hapus jadwal rutin ini? Semua exception per tanggal akan ikut dihapus.")) return;
  try {
    await api(`/api/schedules/${id}`, { method: "DELETE" });
    await Promise.all([loadSchedules(), loadDashboard()]);
    await refreshActivity();
  } catch (error) {
    alert(error.message);
  }
}

function editSchedule(scheduleOrOccurrence) {
  const schedule = scheduleOrOccurrence?.id
    ? scheduleOrOccurrence
    : schedules.find((entry) => entry.id === scheduleOrOccurrence?.schedule_id);
  if (!schedule) {
    alert("Jadwal tidak ditemukan. Muat ulang halaman lalu coba lagi.");
    return;
  }
  openScheduleDialog(schedule);
}

function openOccurrenceDialog(occurrence) {
  selectedOccurrence = occurrence;
  document.getElementById("occurrenceCourse").value = occurrence.course_name;
  document.getElementById("occurrenceDate").value = dateLabel(occurrence.occurrence_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  document.getElementById("occurrenceNote").value = occurrence.note || "";
  document.getElementById("occurrenceRoom").value = occurrence.room || "";
  document.getElementById("occurrenceMessage").textContent = "";
  const statusSelect = document.getElementById("occurrenceStatus");
  statusSelect.replaceChildren(...classStatuses.map((status) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = status;
    return option;
  }));
  statusSelect.value = occurrence.status;
  occurrenceDialog.showModal();
}

async function saveOccurrence(event) {
  event.preventDefault();
  if (!selectedOccurrence) return;
  const saveButton = document.getElementById("saveOccurrence");
  const message = document.getElementById("occurrenceMessage");
  saveButton.disabled = true;
  message.textContent = "";
  const query = new URLSearchParams({ timezoneOffset: String(new Date().getTimezoneOffset()) });

  try {
    await api(`/api/schedules/occurrences/${selectedOccurrence.schedule_id}/${selectedOccurrence.occurrence_date}?${query}`, {
      method: "PUT",
      body: JSON.stringify({
        status: document.getElementById("occurrenceStatus").value,
        note: document.getElementById("occurrenceNote").value.trim(),
        room: document.getElementById("occurrenceRoom").value.trim(),
      }),
    });
    occurrenceDialog.close();
    await Promise.all([loadDashboard(), activeRoute === "jadwal" ? loadSchedules() : Promise.resolve()]);
    await refreshActivity();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
}

async function loadTasksPage() {
  setLoading(document.getElementById("taskList"), "Memuat tugas...");
  try {
    tasks = await api("/api/tasks");
    renderTasks();
    renderTaskStatistics(tasks);
    renderTaskCalendar(tasks);
    renderDeadlineNotifications(tasks);
  } catch (error) {
    setError(document.getElementById("taskList"), error);
  }
}

function renderTaskStatistics(data) {
  document.getElementById("totalTasks").textContent = data.length;
  document.getElementById("pendingTasks").textContent = data.filter((task) => task.status === "Belum Dikerjakan").length;
  document.getElementById("progressTasks").textContent = data.filter((task) => task.status === "Sedang Dikerjakan").length;
  document.getElementById("completedTasks").textContent = data.filter((task) => task.status === "Selesai").length;
}

function renderTasks() {
  const container = document.getElementById("taskList");
  const keyword = document.getElementById("searchTask").value.trim().toLocaleLowerCase("id-ID");
  const selectedStatus = document.getElementById("filterTaskStatus").value;
  const filtered = tasks.filter((task) => {
    const matchesText = `${task.title} ${task.course_name}`.toLocaleLowerCase("id-ID").includes(keyword);
    return matchesText && (selectedStatus === "Semua" || task.status === selectedStatus);
  });
  container.replaceChildren();
  if (!filtered.length) {
    container.appendChild(emptyState(tasks.length ? "Tugas tidak ditemukan." : "Belum ada tugas."));
    return;
  }

  filtered.forEach((task) => {
    const row = document.createElement("article");
    row.className = "task-row";
    const copy = document.createElement("div");
    copy.className = "task-copy";
    const title = document.createElement("h3");
    title.textContent = task.title;
    const course = document.createElement("p");
    course.textContent = task.course_name;
    if (task.description) {
      const description = document.createElement("small");
      description.textContent = task.description;
      copy.append(title, course, description);
    } else copy.append(title, course);

    const status = document.createElement("select");
    status.className = "task-status-select";
    status.setAttribute("aria-label", `Status ${task.title}`);
    ["Belum Dikerjakan", "Sedang Dikerjakan", "Selesai"].forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      status.appendChild(option);
    });
    status.value = task.status;
    status.addEventListener("change", () => updateTaskStatus(task, status.value));

    const deadline = document.createElement("time");
    deadline.className = "task-deadline";
    const deadlineDate = new Date(task.deadline);
    deadline.textContent = `${deadlineDate.toLocaleDateString("id-ID", { dateStyle: "medium" })}, ${formatTime(deadlineDate)}`;
    const actions = document.createElement("div");
    actions.className = "item-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary-action";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => openTaskDialog(task));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet-danger";
    remove.textContent = "Hapus";
    remove.addEventListener("click", () => deleteTask(task.id));
    actions.append(edit, remove);
    row.append(copy, status, deadline, actions);
    container.appendChild(row);
  });
}

function taskFields(task = null) {
  return [
    { name: "title", label: "Nama Tugas", value: task?.title || "", required: true },
    { name: "course_name", label: "Mata Kuliah", value: task?.course_name || "", required: true },
    { name: "description", label: "Deskripsi", type: "textarea", value: task?.description || "" },
    { name: "deadline", label: "Deadline", type: "datetime-local", value: task?.deadline?.slice(0, 16) || "", required: true },
    { name: "status", label: "Status", type: "select", value: task?.status || "Belum Dikerjakan", options: ["Belum Dikerjakan", "Sedang Dikerjakan", "Selesai"].map((value) => ({ value, label: value })) },
  ];
}

function openTaskDialog(task = null) {
  openRecordDialog(task ? "Edit Tugas" : "Tambah Tugas", taskFields(task), async (values) => {
    await api(task ? `/api/tasks/${task.id}` : "/api/tasks", { method: task ? "PUT" : "POST", body: JSON.stringify(values) });
    await Promise.all([loadTasksPage(), loadDashboard()]);
    await refreshActivity();
  });
}

async function deleteTask(id) {
  if (!confirm("Hapus tugas ini?")) return;
  try {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    await Promise.all([loadTasksPage(), loadDashboard()]);
    await refreshActivity();
  } catch (error) {
    alert(error.message);
  }
}

async function updateTaskStatus(task, status) {
  try {
    await api(`/api/tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...task, status }),
    });
    await Promise.all([loadTasksPage(), loadDashboard()]);
    await refreshActivity();
  } catch (error) {
    alert(error.message);
    await loadTasksPage();
  }
}

function renderTaskCalendar(data) {
  const container = document.getElementById("calendarGrid");
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  document.getElementById("calendarMonth").textContent = calendarDate.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  container.replaceChildren();
  ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"].forEach((day) => {
    const heading = document.createElement("span");
    heading.className = "calendar-day-name";
    heading.textContent = day;
    container.appendChild(heading);
  });
  const leadingDays = new Date(year, month, 1).getDay();
  for (let index = 0; index < leadingDays; index += 1) {
    const spacer = document.createElement("span");
    spacer.className = "calendar-date is-empty";
    container.appendChild(spacer);
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const cell = document.createElement("div");
    cell.className = "calendar-date";
    const dayTitle = document.createElement("strong");
    dayTitle.textContent = day;
    cell.appendChild(dayTitle);
    const dateKey = localDateKey(new Date(year, month, day));
    data.filter((task) => task.deadline.slice(0, 10) === dateKey).slice(0, 2).forEach((task) => {
      const deadline = document.createElement("span");
      deadline.className = "calendar-task";
      deadline.textContent = task.title;
      cell.appendChild(deadline);
    });
    container.appendChild(cell);
  }
}

function renderDeadlineNotifications(data) {
  const container = document.getElementById("deadlineNotifications");
  container.replaceChildren();
  const today = localDateKey(new Date());
  const upcoming = data.filter((task) => task.status !== "Selesai" && task.deadline.slice(0, 10) >= today).slice(0, 5);
  if (!upcoming.length) {
    container.appendChild(emptyState("Tidak ada deadline aktif dalam waktu dekat."));
    return;
  }
  upcoming.forEach((task) => {
    const item = document.createElement("p");
    item.textContent = `${task.title} · ${dateLabel(task.deadline.slice(0, 10), { day: "numeric", month: "short"})}`;
    container.appendChild(item);
  });
}

async function loadActivityPage() {
  const container = document.getElementById("activityLogList");
  setLoading(container, "Memuat aktivitas...");
  const selectedActivity = document.getElementById("filterActivity").value;
  const params = new URLSearchParams({ page: String(activityPage), limit: String(activityLimit) });
  if (selectedActivity !== "Semua") params.set("activity", selectedActivity);
  try {
    const result = await api(`/api/activity-logs?${params}`);
    activityPages = result.totalPages;
    document.getElementById("activityResultCount").textContent = `${result.total} aktivitas`;
    renderActivityList(result.data);
    document.getElementById("activityPageInfo").textContent = result.totalPages ? `Halaman ${result.page} dari ${result.totalPages}` : "Halaman 0";
    document.getElementById("prevActivityPage").disabled = result.page <= 1 || result.totalPages === 0;
    document.getElementById("nextActivityPage").disabled = result.page >= result.totalPages;
  } catch (error) {
    setError(container, error);
  }
}

function renderActivityList(data) {
  const container = document.getElementById("activityLogList");
  container.replaceChildren();
  if (!data.length) {
    container.appendChild(emptyState("Belum ada riwayat aktivitas."));
    return;
  }
  data.forEach((activity) => {
    const row = document.createElement("article");
    row.className = "activity-row";
    const mark = document.createElement("span");
    mark.className = "activity-mark";
    mark.textContent = "•";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = activity.activity;
    const description = document.createElement("p");
    description.textContent = activity.description || "-";
    content.append(title, description);
    const time = document.createElement("time");
    time.textContent = formatTimestamp(activity.created_at);
    row.append(mark, content, time);
    container.appendChild(row);
  });
}

async function refreshActivity() {
  activityPage = 1;
  if (activeRoute === "aktivitas") await loadActivityPage();
  if (activeRoute === "dashboard") {
    const result = await api("/api/activity-logs?page=1&limit=3");
    renderDashboardActivities(result.data);
  }
}

async function deleteAllActivities() {
  if (!confirm("Hapus seluruh riwayat aktivitas?")) return;
  try {
    await api("/api/activity-logs", { method: "DELETE" });
    activityPage = 1;
    await loadActivityPage();
    if (activeRoute !== "dashboard") {
      const dashboardActivity = document.getElementById("dashboardActivityList");
      if (dashboardActivity) dashboardActivity.replaceChildren(emptyState("Belum ada aktivitas."));
    }
  } catch (error) {
    alert(error.message);
  }
}

function userInitial(name) {
  return [...String(name || 'M').trim()][0]?.toLocaleUpperCase('id-ID') || 'M';
}

function renderUserMenu(user) {
  currentUser = user;
  const initial = userInitial(user.full_name);
  document.getElementById('navUserName').textContent = user.full_name;
  document.getElementById('navUserInitial').textContent = initial;
  document.querySelector('.profile-copy strong').textContent = user.full_name;
  document.querySelector('.profile-copy small').textContent = `@${user.username}`;
  document.getElementById('profileInitial').textContent = initial;

  const avatarElements = [document.getElementById('navUserAvatar'), document.getElementById('profileAvatar')];
  avatarElements.forEach((image) => {
    image.onerror = () => { image.hidden = true; };
    if (user.avatar) {
      image.src = `/api/account/avatar?v=${encodeURIComponent(user.updated_at || '')}`;
      image.hidden = false;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
    }
  });
}

function applyTheme(theme) {
  themePreference = theme;
  const selectedTheme = theme === 'system'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = selectedTheme;
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    const nextTheme = selectedTheme === 'dark' ? 'light' : 'dark';
    toggle.textContent = selectedTheme === 'dark' ? '☼' : '☾';
    toggle.setAttribute('aria-label', `Aktifkan tema ${nextTheme === 'dark' ? 'gelap' : 'terang'}`);
    toggle.title = `Aktifkan tema ${nextTheme === 'dark' ? 'gelap' : 'terang'}`;
    toggle.setAttribute('aria-pressed', String(selectedTheme === 'dark'));
  }
}

async function toggleTheme() {
  const button = document.getElementById('themeToggle');
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  button.disabled = true;
  applyTheme(nextTheme);
  try {
    const settings = await api('/api/account/settings');
    const result = await api('/api/account/settings', {
      method: 'PUT',
      body: JSON.stringify({
        theme: nextTheme,
        language: settings.language,
        timezone: settings.timezone,
        notifications: JSON.parse(settings.notifications_json),
      }),
    });
    applyTheme(result.settings.theme);
    const themeSelect = document.getElementById('settingTheme');
    if (themeSelect) themeSelect.value = result.settings.theme;
  } catch (error) {
    applyTheme(themePreference === nextTheme ? 'light' : 'dark');
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

async function loadProfilePage() {
  const logsContainer = document.getElementById('securityLogList');
  setLoading(logsContainer, 'Memuat riwayat keamanan...');
  try {
    const [profile, logs] = await Promise.all([
      api('/api/account/profile'),
      api('/api/account/security-logs'),
    ]);
    renderUserMenu(profile.user);
    document.getElementById('profileFullName').textContent = profile.user.full_name;
    document.getElementById('profileUsername').textContent = `@${profile.user.username}`;
    document.getElementById('profileEmail').textContent = profile.user.email;
    document.getElementById('profilePendingEmail').textContent = profile.user.pending_email || 'Tidak ada perubahan tertunda';
    document.getElementById('profileCreatedAt').textContent = formatTimestamp(profile.user.created_at);
    document.getElementById('profileStatus').textContent = profile.user.status === 'active' ? 'Aktif' : 'Nonaktif';
    document.getElementById('profileStatusDetail').textContent = profile.user.status === 'active' ? 'Aktif' : 'Nonaktif';
    renderSecurityLogs(logs);
  } catch (error) {
    setError(logsContainer, error);
  }
}

function renderSecurityLogs(logs) {
  const container = document.getElementById('securityLogList');
  container.replaceChildren();
  if (!logs.length) {
    container.appendChild(emptyState('Belum ada aktivitas keamanan.'));
    return;
  }
  const eventLabels = {
    login_success: 'Login berhasil',
    logout: 'Logout',
    profile_updated: 'Profil diperbarui',
    email_change_requested: 'Perubahan email diminta',
    email_changed: 'Email diverifikasi',
    avatar_updated: 'Foto profil diperbarui',
    settings_updated: 'Pengaturan diperbarui',
    password_changed: 'Password diganti',
    password_reset: 'Password direset',
    password_reset_requested: 'Reset password diminta',
  };
  logs.forEach((log) => {
    const row = document.createElement('article');
    row.className = 'activity-row';
    const mark = document.createElement('span');
    mark.className = 'activity-mark';
    mark.textContent = '•';
    const label = document.createElement('strong');
    label.textContent = eventLabels[log.event] || 'Aktivitas akun';
    const time = document.createElement('time');
    time.textContent = formatTimestamp(log.created_at);
    row.append(mark, label, time);
    container.appendChild(row);
  });
}

async function loadSettingsPage() {
  try {
    const settings = await api('/api/account/settings');
    document.getElementById('settingTheme').value = settings.theme;
    document.getElementById('settingLanguage').value = settings.language;
    document.getElementById('settingTimezone').value = settings.timezone;
    const notifications = JSON.parse(settings.notifications_json);
    document.getElementById('settingEmailNotifications').checked = notifications.email;
    document.getElementById('settingBrowserNotifications').checked = notifications.browser;
    applyTheme(settings.theme);
  } catch (error) {
    showAccountFeedback('settingsFeedback', error.message);
  }
}

function showAccountFeedback(id, message, success = false, linkUrl = '') {
  const feedback = document.getElementById(id);
  feedback.replaceChildren();
  feedback.textContent = message;
  feedback.classList.toggle('success', success);
  if (linkUrl) {
    const link = document.createElement('a');
    link.href = linkUrl;
    link.textContent = 'Verifikasi email (development)';
    feedback.append(' ', link);
  }
}

function openProfileDialog() {
  if (!currentUser) return;
  document.getElementById('editFullName').value = currentUser.full_name;
  document.getElementById('editUsername').value = currentUser.username;
  document.getElementById('editEmail').value = currentUser.email;
  document.getElementById('profileAvatarInput').value = '';
  document.getElementById('profileAvatarPreview').hidden = true;
  document.getElementById('profileFeedback').textContent = '';
  document.getElementById('profileDialog').showModal();
}

async function saveProfile(event) {
  event.preventDefault();
  const button = document.getElementById('saveProfileButton');
  const form = document.getElementById('profileForm');
  const file = document.getElementById('profileAvatarInput').files[0];
  button.disabled = true;
  showAccountFeedback('profileFeedback', '');
  try {
    const values = {
      full_name: form.elements.full_name.value.trim(),
      username: form.elements.username.value.trim(),
      email: form.elements.email.value.trim(),
    };
    const result = await api('/api/account/profile', { method: 'PUT', body: JSON.stringify(values) });
    if (file) {
      const upload = new FormData();
      upload.append('avatar', file);
      await api('/api/account/avatar', { method: 'POST', body: upload });
    }
    await loadProfilePage();
    document.getElementById('profileDialog').close();
    if (result.emailVerificationRequired) {
      showAccountFeedback('profilePendingEmail', `Perubahan email menunggu verifikasi ke ${values.email}.`, true, result.developmentVerificationUrl);
    }
  } catch (error) {
    showAccountFeedback('profileFeedback', error.message);
  } finally {
    button.disabled = false;
  }
}

async function saveSettings() {
  const button = document.getElementById('saveSettingsButton');
  button.disabled = true;
  showAccountFeedback('settingsFeedback', '');
  const values = {
    theme: document.getElementById('settingTheme').value,
    language: document.getElementById('settingLanguage').value,
    timezone: document.getElementById('settingTimezone').value,
    notifications: {
      email: document.getElementById('settingEmailNotifications').checked,
      browser: document.getElementById('settingBrowserNotifications').checked,
    },
  };
  try {
    const result = await api('/api/account/settings', { method: 'PUT', body: JSON.stringify(values) });
    applyTheme(result.settings.theme);
    showAccountFeedback('settingsFeedback', result.message, true);
  } catch (error) {
    showAccountFeedback('settingsFeedback', error.message);
  } finally {
    button.disabled = false;
  }
}

async function changeAccountPassword(event) {
  event.preventDefault();
  const form = document.getElementById('changePasswordForm');
  const button = document.getElementById('changePasswordButton');
  const values = Object.fromEntries(new FormData(form));
  if (values.new_password !== values.confirm_password) {
    showAccountFeedback('passwordFeedback', 'Konfirmasi password tidak sama.');
    return;
  }
  button.disabled = true;
  showAccountFeedback('passwordFeedback', '');
  try {
    const result = await api('/api/account/change-password', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    updateAccountPasswordStrength('');
    showAccountFeedback('passwordFeedback', result.message, true);
  } catch (error) {
    showAccountFeedback('passwordFeedback', error.message);
  } finally {
    button.disabled = false;
  }
}

function updateAccountPasswordStrength(value) {
  const score = [value.length >= 12, value.length >= 16, /[a-z]/.test(value) && /[A-Z]/.test(value), /\d/.test(value), /[^a-zA-Z0-9]/.test(value)].filter(Boolean).length;
  const bar = document.getElementById('accountPasswordStrength');
  bar.style.width = `${score * 20}%`;
  bar.style.background = score >= 4 ? '#2f8059' : score >= 3 ? '#b87929' : '#d97158';
  document.getElementById('accountPasswordStrengthLabel').textContent = score >= 4 ? 'Kekuatan password: baik.' : score >= 3 ? 'Kekuatan password: cukup.' : 'Minimal 12 karakter, huruf, dan angka.';
}

async function logout() {
  if (!confirm('Logout dari CampusPlus?')) return;
  try {
    await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
    location.replace('/login');
  } catch (error) {
    alert(error.message);
  }
}

function openRecordDialog(title, fields, onSave) {
  document.getElementById("recordDialogTitle").textContent = title;
  const fieldContainer = document.getElementById("recordDialogFields");
  fieldContainer.replaceChildren();
  document.getElementById("recordDialogMessage").textContent = "";
  saveRecordHandler = onSave;
  fields.forEach((field) => {
    const label = document.createElement("label");
    label.className = "dialog-field";
    label.textContent = field.label;
    const input = field.type === "textarea" ? document.createElement("textarea") : field.type === "select" ? document.createElement("select") : document.createElement("input");
    input.name = field.name;
    input.required = Boolean(field.required);
    if (field.pattern) input.pattern = field.pattern;
    if (field.inputMode) input.inputMode = field.inputMode;
    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.maxLength) input.maxLength = field.maxLength;
    if (field.type === "select") field.options.forEach((choice) => {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      input.appendChild(option);
    });
    else if (field.type !== "textarea") input.type = field.type || "text";
    if (field.value !== undefined) input.value = field.value;
    label.appendChild(input);
    fieldContainer.appendChild(label);
  });
  recordDialog.showModal();
  fieldContainer.querySelector("input, select, textarea")?.focus();
}

async function saveRecord(event) {
  event.preventDefault();
  const button = document.getElementById("saveRecordDialog");
  button.disabled = true;
  document.getElementById("recordDialogMessage").textContent = "";
  try {
    await saveRecordHandler(Object.fromEntries(new FormData(document.getElementById("recordDialogForm"))));
    recordDialog.close();
  } catch (error) {
    document.getElementById("recordDialogMessage").textContent = error.message || "Perubahan gagal disimpan.";
  } finally {
    button.disabled = false;
  }
}

function bindEvents() {
  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("show");
    document.getElementById("sidebarScrim").classList.toggle("show");
  });
  document.getElementById("sidebarScrim").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("show");
    document.getElementById("sidebarScrim").classList.remove("show");
  });
  document.getElementById("recordDialogForm").addEventListener("submit", saveRecord);
  document.getElementById("cancelRecordDialog").addEventListener("click", () => recordDialog.close());
  document.getElementById("closeRecordDialog").addEventListener("click", () => recordDialog.close());
  document.getElementById("occurrenceForm").addEventListener("submit", saveOccurrence);
  document.getElementById("cancelOccurrenceDialog").addEventListener("click", () => occurrenceDialog.close());
  document.getElementById("closeOccurrenceDialog").addEventListener("click", () => occurrenceDialog.close());
  document.getElementById("addAnnouncementButton").addEventListener("click", () => openAnnouncementDialog());
  document.getElementById("addScheduleButton").addEventListener("click", () => openScheduleDialog());
  document.getElementById("addTaskButton").addEventListener("click", () => openTaskDialog());
  document.getElementById("deleteAllActivities").addEventListener("click", deleteAllActivities);
  document.getElementById("searchAnnouncement").addEventListener("input", renderAnnouncementList);
  document.getElementById("searchTask").addEventListener("input", renderTasks);
  document.getElementById("filterTaskStatus").addEventListener("change", renderTasks);
  document.getElementById("filterActivity").addEventListener("change", () => { activityPage = 1; loadActivityPage(); });
  document.getElementById("prevActivityPage").addEventListener("click", () => { if (activityPage > 1) { activityPage -= 1; loadActivityPage(); } });
  document.getElementById("nextActivityPage").addEventListener("click", () => { if (activityPage < activityPages) { activityPage += 1; loadActivityPage(); } });
  document.getElementById("filterDay").addEventListener("change", loadSchedules);
  document.getElementById("scheduleDate").addEventListener("change", loadSchedules);
  document.getElementById("previousWeek").addEventListener("click", () => { const input = document.getElementById("scheduleDate"); input.value = shiftDate(input.value || localDateKey(new Date()), -7); loadSchedules(); });
  document.getElementById("nextWeek").addEventListener("click", () => { const input = document.getElementById("scheduleDate"); input.value = shiftDate(input.value || localDateKey(new Date()), 7); loadSchedules(); });
  document.getElementById("prevMonth").addEventListener("click", () => { calendarDate.setMonth(calendarDate.getMonth() - 1); renderTaskCalendar(tasks); });
  document.getElementById("nextMonth").addEventListener("click", () => { calendarDate.setMonth(calendarDate.getMonth() + 1); renderTaskCalendar(tasks); });
  document.getElementById("requestNotifications").addEventListener("click", requestNotificationPermission);
  document.getElementById('userMenuButton').addEventListener('click', () => {
    const dropdown = document.getElementById('userDropdown');
    dropdown.hidden = !dropdown.hidden;
    document.getElementById('userMenuButton').setAttribute('aria-expanded', String(!dropdown.hidden));
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.user-menu-wrap')) {
      document.getElementById('userDropdown').hidden = true;
      document.getElementById('userMenuButton').setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.getElementById('userDropdown').hidden = true;
      document.getElementById('userMenuButton').setAttribute('aria-expanded', 'false');
    }
  });
  document.getElementById('logoutButton').addEventListener('click', logout);
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('settingTheme').addEventListener('change', (event) => applyTheme(event.target.value));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (themePreference === 'system') applyTheme('system');
  });
  document.getElementById('editProfileButton').addEventListener('click', openProfileDialog);
  document.getElementById('profileForm').addEventListener('submit', saveProfile);
  document.getElementById('cancelProfileDialog').addEventListener('click', () => document.getElementById('profileDialog').close());
  document.getElementById('closeProfileDialog').addEventListener('click', () => document.getElementById('profileDialog').close());
  document.getElementById('profileAvatarInput').addEventListener('change', (event) => {
    const file = event.target.files[0];
    const preview = document.getElementById('profileAvatarPreview');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      event.target.value = '';
      showAccountFeedback('profileFeedback', 'Gunakan PNG, JPEG, atau WebP dengan ukuran maksimal 2 MB.');
      return;
    }
    if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    avatarPreviewUrl = URL.createObjectURL(file);
    preview.src = avatarPreviewUrl;
    preview.hidden = false;
    showAccountFeedback('profileFeedback', '');
  });
  document.getElementById('saveSettingsButton').addEventListener('click', saveSettings);
  document.getElementById('changePasswordForm').addEventListener('submit', changeAccountPassword);
  document.getElementById('newAccountPassword').addEventListener('input', (event) => updateAccountPasswordStrength(event.target.value));
  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      button.textContent = visible ? 'Lihat' : 'Sembunyi';
      button.setAttribute('aria-label', visible ? 'Tampilkan password' : 'Sembunyikan password');
    });
  });
  window.addEventListener("hashchange", renderRoute);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) api('/api/auth/me').catch(() => {});
  });
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    alert("Browser tidak mendukung notifikasi.");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;
  const upcoming = tasks.filter((task) => task.status !== "Selesai").slice(0, 5);
  upcoming.forEach((task) => new Notification("Pengingat CampusPlus", { body: `${task.title} · ${task.course_name}` }));
}

async function initializeApp() {
  bindEvents();
  updateDateLabels();
  try {
    const { user } = await api('/api/auth/me');
    renderUserMenu(user);
    const settings = await api('/api/account/settings');
    applyTheme(settings.theme);
    renderRoute();
  } catch {
    location.replace('/login');
  }
}

initializeApp();
