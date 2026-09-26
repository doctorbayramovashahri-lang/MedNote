const DB_NAME = "mednote-local-mvp";
const DB_VERSION = 1;
const STORE = "state";
const STATE_KEY = "mednote-state";
const SUPABASE_URL = "https://ddnhkwpdxcrvkfopkpmy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_2ZpBanYunxaZRXnPPkN08Q_gjGKjjK0";
const AUTH_TECHNICAL_DOMAIN = "mednote.local";
const LOGIN_PATTERN = /^[a-z0-9._-]+$/;
const STORAGE_ATTACHMENTS_BUCKET = "medical-attachments";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DOCUMENT_IMPORT_MAX_BYTES = MAX_ATTACHMENT_BYTES;
const SIGNED_ATTACHMENT_URL_TTL_SECONDS = 120;
const PATIENT_SELECT_COLUMNS =
  "id, full_name, birth_date, sex, phone, email, height_cm, allergies, conditions, therapy, context_notes, about, created_at, updated_at";
const VISIT_SELECT_COLUMNS =
  "id, patient_id, date, format, status, note, decision, next_step, next_step_timing, started_at, completed_at, created_at, updated_at, version";
const ATTACHMENT_SELECT_COLUMNS =
  "id, patient_id, visit_id, kind, original_filename, mime_type, size_bytes, storage_bucket, storage_path, added_at, created_at";
const MEDICAL_TEMPLATE_SELECT_COLUMNS =
  "id, title, indication, note, decision, next_step, next_step_timing, is_archived, created_at, updated_at";
const REPOSITORY_ERROR_TYPES = {
  AUTH: "AUTH",
  NETWORK: "NETWORK",
  PERMISSION: "PERMISSION",
  CONFLICT: "CONFLICT",
  UNKNOWN: "UNKNOWN"
};

const app = document.querySelector("#app");
const logoutButton = document.querySelector("#logoutButton");
const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const todayISO = () => new Date().toISOString().slice(0, 10);

function nowISO() {
  return new Date().toISOString();
}

function formatDate(value) {
  if (!value) return "Не указана";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(`${value}T00:00:00`)
  );
}

function formatShortDate(value) {
  if (!value) return "Обращений нет";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${value}T00:00:00`));
}

function initials(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function calculateAge(birthDate) {
  const birth = new Date(`${birthDate}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function fileSize(size) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shortTextPreview(value = "", limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

function visitFormatLabel(format) {
  if (format === "phone") return "Телефон / сообщение";
  return format === "online" ? "Онлайн" : "В клинике";
}

function normalizeVisit(visit) {
  return {
    status: "completed",
    decision: "",
    nextStep: "",
    nextStepTiming: "",
    startedAt: visit.createdAt || nowISO(),
    ...visit,
    format: visit.format || "clinic",
    note: visit.note || "",
    status: visit.status || "completed",
    decision: visit.decision || "",
    nextStep: visit.nextStep || "",
    nextStepTiming: visit.nextStepTiming || "",
    startedAt: visit.startedAt || visit.createdAt || nowISO(),
    version: Number.isInteger(Number(visit.version)) && Number(visit.version) > 0 ? Number(visit.version) : 1
  };
}

function normalizeMedicalTemplate(template) {
  return {
    id: template.id || "",
    title: String(template.title || "").trim(),
    indication: template.indication || "",
    note: template.note || "",
    decision: template.decision || "",
    nextStep: template.nextStep || "",
    nextStepTiming: template.nextStepTiming || "",
    isArchived: Boolean(template.isArchived),
    createdAt: template.createdAt || "",
    updatedAt: template.updatedAt || ""
  };
}

function normalizePatient(patient) {
  return {
    sex: "",
    phone: "",
    heightCm: "",
    weightHistory: [],
    medicalContext: {
      allergies: "",
      conditions: "",
      therapy: "",
      notes: ""
    },
    about: "",
    ...patient,
    medicalContext: {
      allergies: "",
      conditions: "",
      therapy: "",
      notes: "",
      ...(patient.medicalContext || {})
    },
    weightHistory: Array.isArray(patient.weightHistory) ? patient.weightHistory : []
  };
}

class RepositoryError extends Error {
  constructor(type, message, cause = null) {
    super(message);
    this.name = "RepositoryError";
    this.type = type;
    this.cause = cause;
  }
}

function classifySupabaseError(error) {
  if (!error) return REPOSITORY_ERROR_TYPES.UNKNOWN;
  const status = error.status || error.statusCode;
  const code = error.code || "";
  const message = `${error.message || ""}`.toLowerCase();
  if (status === 401 || message.includes("jwt") || message.includes("session")) return REPOSITORY_ERROR_TYPES.AUTH;
  if (status === 403 || code === "42501" || message.includes("permission") || message.includes("rls")) {
    return REPOSITORY_ERROR_TYPES.PERMISSION;
  }
  if (status === 409 || code === "23505" || code === "PGRST116") return REPOSITORY_ERROR_TYPES.CONFLICT;
  if (message.includes("failed to fetch") || message.includes("network") || message.includes("fetch")) {
    return REPOSITORY_ERROR_TYPES.NETWORK;
  }
  return REPOSITORY_ERROR_TYPES.UNKNOWN;
}

function throwRepositoryError(error, fallbackMessage = "Repository operation failed.") {
  throw new RepositoryError(classifySupabaseError(error), fallbackMessage, error);
}

function optionalText(value) {
  return value == null ? "" : String(value);
}

function optionalNumericText(value) {
  return value == null ? "" : String(value);
}

function nullableText(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function nullableNumber(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeStorageFilename(filename = "") {
  const normalized = String(filename || "attachment")
    .trim()
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "attachment";
}

function attachmentKindFromMime(mime = "") {
  if (mime.includes("pdf")) return "pdf";
  if (mime.startsWith("image/")) return "analysis-photo";
  return "document";
}

function storagePathForAttachment({ doctorId, patientId, visitId, attachmentId, filename }) {
  return [doctorId, patientId, visitId, attachmentId, safeStorageFilename(filename)].map(encodeURIComponent).join("/");
}

function mapPatientWeightRow(row = {}) {
  return {
    id: row.id,
    patientId: row.patient_id,
    valueKg: optionalNumericText(row.value_kg),
    measuredAt: optionalText(row.measured_at),
    createdAt: optionalText(row.created_at),
    updatedAt: row.updated_at || ""
  };
}

function mapPatientRow(row = {}, weightRows = []) {
  return normalizePatient({
    id: row.id,
    fullName: optionalText(row.full_name),
    birthDate: optionalText(row.birth_date),
    sex: row.sex || "",
    phone: row.phone || "",
    email: row.email || "",
    heightCm: optionalNumericText(row.height_cm),
    weightHistory: weightRows.map(mapPatientWeightRow),
    medicalContext: {
      allergies: row.allergies || "",
      conditions: row.conditions || "",
      therapy: row.therapy || "",
      notes: row.context_notes || ""
    },
    about: row.about || "",
    createdAt: optionalText(row.created_at),
    updatedAt: optionalText(row.updated_at)
  });
}

function mapPatientInputToSupabasePayload(input = {}, doctorId) {
  return {
    doctor_id: doctorId,
    full_name: String(input.fullName || "").trim(),
    birth_date: input.birthDate || null,
    sex: nullableText(input.sex),
    phone: nullableText(input.phone),
    email: nullableText(input.email),
    height_cm: nullableNumber(input.heightCm),
    allergies: nullableText(input.medicalContext?.allergies),
    conditions: nullableText(input.medicalContext?.conditions),
    therapy: nullableText(input.medicalContext?.therapy),
    context_notes: nullableText(input.medicalContext?.notes),
    about: nullableText(input.about)
  };
}

function mapPatientUpdateInputToSupabasePayload(input = {}) {
  const payload = {};
  if ("fullName" in input) payload.full_name = String(input.fullName || "").trim();
  if ("birthDate" in input) payload.birth_date = input.birthDate || null;
  if ("sex" in input) payload.sex = nullableText(input.sex);
  if ("phone" in input) payload.phone = nullableText(input.phone);
  if ("email" in input) payload.email = nullableText(input.email);
  if ("heightCm" in input) payload.height_cm = nullableNumber(input.heightCm);
  if ("medicalContext" in input) {
    payload.allergies = nullableText(input.medicalContext?.allergies);
    payload.conditions = nullableText(input.medicalContext?.conditions);
    payload.therapy = nullableText(input.medicalContext?.therapy);
    payload.context_notes = nullableText(input.medicalContext?.notes);
  }
  if ("about" in input) payload.about = nullableText(input.about);
  return payload;
}

function weightInputFromPatientForm(input = {}) {
  const valueKg = String(input.currentWeightKg || "").trim();
  const measuredAt = String(input.weightMeasuredAt || "").trim();
  return valueKg && measuredAt ? { valueKg, measuredAt } : null;
}

function mapWeightInputToSupabasePayload(input = {}, patientId, doctorId) {
  return {
    doctor_id: doctorId,
    patient_id: patientId,
    value_kg: nullableNumber(input.valueKg),
    measured_at: input.measuredAt || null
  };
}

function mapVisitRow(row = {}) {
  return normalizeVisit({
    id: row.id,
    patientId: row.patient_id,
    date: optionalText(row.date),
    format: row.format || "clinic",
    status: row.status || "draft",
    note: row.note || "",
    decision: row.decision || "",
    nextStep: row.next_step || "",
    nextStepTiming: row.next_step_timing || "",
    startedAt: optionalText(row.started_at || row.created_at),
    completedAt: row.completed_at || "",
    createdAt: optionalText(row.created_at),
    updatedAt: optionalText(row.updated_at),
    version: row.version || 1
  });
}

function mapVisitInputToSupabasePayload(input = {}, patientId, doctorId) {
  return {
    doctor_id: doctorId,
    patient_id: patientId,
    date: input.date || todayISO(),
    format: input.format || "clinic",
    status: input.status || "draft",
    note: input.note || "",
    decision: input.decision || "",
    next_step: input.nextStep || "",
    next_step_timing: input.nextStepTiming || "",
    started_at: input.startedAt || nowISO(),
    completed_at: input.completedAt || null
  };
}

function mapVisitUpdateInputToSupabasePayload(input = {}) {
  const payload = {};
  if ("date" in input) payload.date = input.date || todayISO();
  if ("format" in input) payload.format = input.format || "clinic";
  if ("status" in input) payload.status = input.status || "draft";
  if ("note" in input) payload.note = input.note || "";
  if ("decision" in input) payload.decision = input.decision || "";
  if ("nextStep" in input) payload.next_step = input.nextStep || "";
  if ("nextStepTiming" in input) payload.next_step_timing = input.nextStepTiming || "";
  if ("startedAt" in input) payload.started_at = input.startedAt || nowISO();
  if ("completedAt" in input) payload.completed_at = input.completedAt || null;
  if (payload.status === "completed" && !payload.completed_at) payload.completed_at = nowISO();
  return payload;
}

function validateMedicalTemplateTitle(title) {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) {
    throw new RepositoryError(REPOSITORY_ERROR_TYPES.UNKNOWN, "Template title is required.");
  }
  return normalizedTitle;
}

function mapMedicalTemplateRow(row = {}) {
  return normalizeMedicalTemplate({
    id: row.id,
    title: row.title,
    indication: row.indication || "",
    note: row.note || "",
    decision: row.decision || "",
    nextStep: row.next_step || "",
    nextStepTiming: row.next_step_timing || "",
    isArchived: Boolean(row.is_archived),
    createdAt: optionalText(row.created_at),
    updatedAt: optionalText(row.updated_at)
  });
}

function mapMedicalTemplateInputToSupabasePayload(input = {}, doctorId) {
  return {
    doctor_id: doctorId,
    title: validateMedicalTemplateTitle(input.title),
    indication: String(input.indication || ""),
    note: String(input.note || ""),
    decision: String(input.decision || ""),
    next_step: String(input.nextStep || ""),
    next_step_timing: String(input.nextStepTiming || ""),
    is_archived: Boolean(input.isArchived)
  };
}

function mapMedicalTemplateUpdateInputToSupabasePayload(input = {}) {
  const payload = {};
  if ("title" in input) payload.title = validateMedicalTemplateTitle(input.title);
  if ("indication" in input) payload.indication = String(input.indication || "");
  if ("note" in input) payload.note = String(input.note || "");
  if ("decision" in input) payload.decision = String(input.decision || "");
  if ("nextStep" in input) payload.next_step = String(input.nextStep || "");
  if ("nextStepTiming" in input) payload.next_step_timing = String(input.nextStepTiming || "");
  if ("isArchived" in input) payload.is_archived = Boolean(input.isArchived);
  return payload;
}

function visitExpectedVersion(input = {}) {
  const version = Number(input.expectedVersion ?? input.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new RepositoryError(REPOSITORY_ERROR_TYPES.CONFLICT, "Current visit version is required for cloud update.");
  }
  return version;
}

function mapAttachmentMetadataRow(row = {}) {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    kind: row.kind,
    name: row.original_filename,
    mime: row.mime_type,
    size: Number(row.size_bytes || 0),
    addedAt: optionalText(row.added_at),
    createdAt: optionalText(row.created_at),
    storageBucket: row.storage_bucket,
    storagePath: row.storage_path,
    hasBinaryUrl: false
  };
}

function mapAttachmentMetadataInputToSupabasePayload(input = {}, { doctorId, patientId, visitId, attachmentId }) {
  return {
    id: attachmentId,
    doctor_id: doctorId,
    patient_id: patientId,
    visit_id: visitId,
    kind: input.kind || attachmentKindFromMime(input.mime || input.type || ""),
    original_filename: input.name || "attachment",
    mime_type: input.mime || "application/octet-stream",
    size_bytes: Number(input.size || 0),
    storage_bucket: STORAGE_ATTACHMENTS_BUCKET,
    storage_path: storagePathForAttachment({ doctorId, patientId, visitId, attachmentId, filename: input.name })
  };
}

function blobFromDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const body = isBase64 ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(body.length);
  for (let index = 0; index < body.length; index += 1) bytes[index] = body.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function attachmentUploadBody(file = {}) {
  if (file instanceof Blob) return file;
  if (file.blob instanceof Blob) return file.blob;
  if (file.file instanceof Blob) return file.file;
  if (file.dataUrl) return blobFromDataUrl(file.dataUrl);
  return null;
}

function validateAttachmentFile(file = {}, body = null) {
  const size = Number(file.size || body?.size || 0);
  if (!body || !size) {
    throw new RepositoryError(REPOSITORY_ERROR_TYPES.CONFLICT, "Attachment file is empty or unavailable.");
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    throw new RepositoryError(REPOSITORY_ERROR_TYPES.CONFLICT, "Attachment file exceeds the configured upload size limit.");
  }
  return size;
}

function groupRowsBy(rows = [], key) {
  return rows.reduce((groups, row) => {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
    return groups;
  }, new Map());
}

async function requireSupabaseSession() {
  if (!supabaseClient) throw new RepositoryError(REPOSITORY_ERROR_TYPES.AUTH, "Supabase client is unavailable.");
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throwRepositoryError(error, "Unable to read Supabase session.");
  if (!data.session?.user?.id) throw new RepositoryError(REPOSITORY_ERROR_TYPES.AUTH, "Authenticated Supabase session is required.");
  return data.session;
}

function normalizeState(state) {
  return {
    seeded: Boolean(state.seeded),
    patients: (state.patients || []).map(normalizePatient),
    visits: (state.visits || []).map(normalizeVisit),
    attachments: state.attachments || []
  };
}

function sexLabel(value) {
  if (value === "male") return "Мужчина";
  if (value === "female") return "Женщина";
  return "";
}

function latestWeight(patient) {
  return [...(patient.weightHistory || [])].sort((a, b) => `${b.measuredAt || ""}`.localeCompare(`${a.measuredAt || ""}`))[0] || null;
}

function bmiValue(heightCm, weightKg) {
  const height = Number(heightCm);
  const weight = Number(weightKg);
  if (!height || !weight) return "";
  return (weight / (height / 100) ** 2).toFixed(1).replace(".", ",");
}

function splitItems(value = "") {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLogin(login = "") {
  return login.trim().toLowerCase();
}

function loginToTechnicalEmail(login = "") {
  const normalizedLogin = normalizeLogin(login);
  if (!LOGIN_PATTERN.test(normalizedLogin)) return null;
  return `${normalizedLogin}@${AUTH_TECHNICAL_DOMAIN}`;
}

function makeDemoFile(name, mime, content) {
  return {
    id: uid(),
    patientId: "",
    visitId: "",
    kind: mime.includes("pdf") ? "pdf" : "analysis-photo",
    name,
    mime,
    dataUrl: `data:${mime};base64,${btoa(unescape(encodeURIComponent(content)))}`,
    addedAt: nowISO(),
    size: content.length
  };
}

function demoState() {
  const p1 = uid();
  const p2 = uid();
  const p3 = uid();
  const p4 = uid();
  const v1 = uid();
  const v2 = uid();
  const v3 = uid();
  const a1 = makeDemoFile("analiz-krovi-obschiy-fiktivnyy-dokument-s-dlinnym-nazvaniem.jpg", "image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='420'><rect width='100%' height='100%' fill='#eef4f3'/><text x='32' y='70' font-size='30' fill='#16746a'>Фиктивное фото анализа</text><text x='32' y='130' font-size='22' fill='#33403d'>Демо-вложение</text></svg>");
  const a2 = makeDemoFile("consultation-summary.pdf", "application/pdf", "%PDF-1.4 demo placeholder");
  const a3 = makeDemoFile("photo-analysis-repeat-check.png", "image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='420'><rect width='100%' height='100%' fill='#f8faf9'/><circle cx='170' cy='180' r='80' fill='#d9e1de'/><text x='32' y='340' font-size='24' fill='#17211f'>Фиктивный снимок документа</text></svg>");
  a1.patientId = p2;
  a1.visitId = v1;
  a2.patientId = p2;
  a2.visitId = v1;
  a3.patientId = p4;
  a3.visitId = v3;
  return {
    seeded: true,
    patients: [
      normalizePatient({ id: p1, fullName: "Иван Петров", birthDate: "1987-04-16", sex: "male", phone: "", email: "", createdAt: nowISO(), updatedAt: nowISO() }),
      normalizePatient({
        id: p2,
        fullName: "Александра Константиновна Романова-Смирнова",
        birthDate: "1976-11-02",
        sex: "female",
        phone: "+7 900 123-45-67 доб. 204",
        email: "alexandra.romanova-smirnova.long.email@example-clinic.test",
        heightCm: "168",
        weightHistory: [
          { id: uid(), valueKg: "72", measuredAt: "2026-06-12", createdAt: nowISO() },
          { id: uid(), valueKg: "68", measuredAt: "2026-09-12", createdAt: nowISO() }
        ],
        medicalContext: {
          allergies: "Пенициллин, латекс",
          conditions: "Гипотиреоз; тревожность перед контрольными анализами",
          therapy: "Левотироксин 75 мкг, витамин D с очень длинным названием препарата для проверки переноса",
          notes: "Предпочитает онлайн-консультации, если не требуется осмотр."
        },
        about: "Работает бухгалтером. Часто в командировках. На прошлом приеме переживала из-за результатов анализов.",
        createdAt: nowISO(),
        updatedAt: nowISO()
      }),
      { id: p3, fullName: "Мария Сергеевна Соколова", birthDate: "1994-02-20", email: "m.sokolova@example.test", createdAt: nowISO(), updatedAt: nowISO() },
      { id: p4, fullName: "Олег Андреевич Ли", birthDate: "1962-08-07", email: "", createdAt: nowISO(), updatedAt: nowISO() }
    ].map(normalizePatient),
    visits: [
      { id: v1, patientId: p2, date: "2026-09-12", format: "clinic", note: "Первичный очный прием. Пациентка принесла результаты лабораторных исследований. Жалобы описаны подробно, требуется наблюдение динамики и повторная консультация после контрольных анализов.\n\nДлинная заметка добавлена специально для проверки переносов текста и устойчивости карточки истории.", createdAt: nowISO(), updatedAt: nowISO() },
      { id: v2, patientId: p2, date: "2026-09-18", format: "online", note: "Онлайн-контроль после очного приема. Обсуждены самочувствие и план следующего наблюдения.", createdAt: nowISO(), updatedAt: nowISO() },
      { id: v3, patientId: p4, date: "2026-08-30", format: "clinic", note: "Плановый осмотр. Вложена фотография анализа для демонстрации preview.", createdAt: nowISO(), updatedAt: nowISO() }
    ],
    attachments: [a1, a2, a3]
  };
}

const supabaseRepository = (() => {
  function from(table) {
    if (!supabaseClient) throw new RepositoryError(REPOSITORY_ERROR_TYPES.AUTH, "Supabase client is unavailable.");
    return supabaseClient.from(table);
  }

  async function readPatientWeights(patientIds) {
    if (!patientIds.length) return [];
    const { data, error } = await from("patient_weights")
      .select("id, patient_id, value_kg, measured_at, created_at, updated_at")
      .in("patient_id", patientIds)
      .order("measured_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throwRepositoryError(error, "Unable to read patient weights.");
    return data || [];
  }

  async function insertPatientWeight(patientId, doctorId, weightInput) {
    const payload = mapWeightInputToSupabasePayload(weightInput, patientId, doctorId);
    if (!payload.value_kg || !payload.measured_at) return null;
    const { error } = await from("patient_weights").insert(payload);
    if (error) throwRepositoryError(error, "Unable to save patient weight.");
    return payload;
  }

  async function readPatientsWithWeights(patientQuery) {
    await requireSupabaseSession();
    const { data: patients, error } = await patientQuery;
    if (error) throwRepositoryError(error, "Unable to read patients.");
    const rows = patients || [];
    const weights = await readPatientWeights(rows.map((patient) => patient.id));
    const weightsByPatient = groupRowsBy(weights, "patient_id");
    return rows.map((patient) => mapPatientRow(patient, weightsByPatient.get(patient.id) || []));
  }

  function selectPatientColumns(query) {
    return query.select(PATIENT_SELECT_COLUMNS);
  }

  function selectVisitColumns(query) {
    return query.select(VISIT_SELECT_COLUMNS);
  }

  function orderVisitsClinically(query) {
    return query
      .order("date", { ascending: false })
      .order("completed_at", { ascending: false, nullsFirst: false })
      .order("started_at", { ascending: false })
      .order("created_at", { ascending: false });
  }

  function selectAttachmentColumns(query) {
    return query.select(ATTACHMENT_SELECT_COLUMNS);
  }

  function selectMedicalTemplateColumns(query) {
    return query.select(MEDICAL_TEMPLATE_SELECT_COLUMNS);
  }

  function attachmentBucket() {
    if (!supabaseClient) throw new RepositoryError(REPOSITORY_ERROR_TYPES.AUTH, "Supabase client is unavailable.");
    return supabaseClient.storage.from(STORAGE_ATTACHMENTS_BUCKET);
  }

  async function readOwnedVisit(visitId, patientId = null) {
    const query = selectVisitColumns(from("visits")).eq("id", visitId);
    const { data, error } = await (patientId ? query.eq("patient_id", patientId) : query).maybeSingle();
    if (error) throwRepositoryError(error, "Unable to read visit.");
    if (!data) throw new RepositoryError(REPOSITORY_ERROR_TYPES.PERMISSION, "Visit is not available for the current doctor.");
    return mapVisitRow(data);
  }

  async function readAttachmentMetadata(id) {
    const { data, error } = await selectAttachmentColumns(from("attachments")).eq("id", id).maybeSingle();
    if (error) throwRepositoryError(error, "Unable to read attachment.");
    if (!data) throw new RepositoryError(REPOSITORY_ERROR_TYPES.PERMISSION, "Attachment is not available for the current doctor.");
    return mapAttachmentMetadataRow(data);
  }

  return {
    async getPatients() {
      return readPatientsWithWeights(selectPatientColumns(from("patients")));
    },
    async listMedicalTemplates(options = {}) {
      await requireSupabaseSession();
      let query = selectMedicalTemplateColumns(from("medical_templates")).order("updated_at", { ascending: false });
      if (!options.includeArchived) query = query.eq("is_archived", false);
      const { data, error } = await query;
      if (error) throwRepositoryError(error, "Unable to read medical templates.");
      return (data || []).map(mapMedicalTemplateRow);
    },
    async getMedicalTemplate(id) {
      await requireSupabaseSession();
      const { data, error } = await selectMedicalTemplateColumns(from("medical_templates")).eq("id", id).maybeSingle();
      if (error) throwRepositoryError(error, "Unable to read medical template.");
      return data ? mapMedicalTemplateRow(data) : null;
    },
    async createMedicalTemplate(input) {
      const session = await requireSupabaseSession();
      const { data, error } = await from("medical_templates")
        .insert(mapMedicalTemplateInputToSupabasePayload(input, session.user.id))
        .select(MEDICAL_TEMPLATE_SELECT_COLUMNS)
        .single();
      if (error) throwRepositoryError(error, "Unable to create medical template.");
      return mapMedicalTemplateRow(data);
    },
    async updateMedicalTemplate(id, patch) {
      await requireSupabaseSession();
      const payload = mapMedicalTemplateUpdateInputToSupabasePayload(patch);
      if (!Object.keys(payload).length) return this.getMedicalTemplate(id);
      const { data, error } = await from("medical_templates")
        .update(payload)
        .eq("id", id)
        .select(MEDICAL_TEMPLATE_SELECT_COLUMNS)
        .single();
      if (error) throwRepositoryError(error, "Unable to update medical template.");
      return mapMedicalTemplateRow(data);
    },
    async archiveMedicalTemplate(id) {
      return this.updateMedicalTemplate(id, { isArchived: true });
    },
    async getPatient(id) {
      const patients = await readPatientsWithWeights(selectPatientColumns(from("patients")).eq("id", id));
      return patients[0] || null;
    },
    async createPatient(input) {
      const session = await requireSupabaseSession();
      const doctorId = session.user.id;
      const { data: patient, error } = await from("patients")
        .insert(mapPatientInputToSupabasePayload(input, doctorId))
        .select(PATIENT_SELECT_COLUMNS)
        .single();
      if (error) throwRepositoryError(error, "Unable to create patient.");
      const weightInput = weightInputFromPatientForm(input);
      if (weightInput) {
        try {
          await insertPatientWeight(patient.id, doctorId, weightInput);
        } catch (error) {
          try {
            await from("patients").delete().eq("id", patient.id);
          } catch {
            // The original weight error is the operation result; cleanup failure is a residual risk.
          }
          throw error;
        }
      }
      return this.getPatient(patient.id);
    },
    async updatePatient(id, input) {
      const session = await requireSupabaseSession();
      const doctorId = session.user.id;
      const currentPatient = await this.getPatient(id);
      if (!currentPatient) throw new RepositoryError(REPOSITORY_ERROR_TYPES.PERMISSION, "Patient is not available for the current doctor.");
      const payload = mapPatientUpdateInputToSupabasePayload(input);
      if (Object.keys(payload).length) {
        const { error } = await from("patients").update(payload).eq("id", id);
        if (error) throwRepositoryError(error, "Unable to update patient.");
      }
      const weightInput = weightInputFromPatientForm(input);
      const currentWeight = latestWeight(currentPatient);
      if (
        weightInput &&
        (!currentWeight || currentWeight.valueKg !== weightInput.valueKg || currentWeight.measuredAt !== weightInput.measuredAt)
      ) {
        await insertPatientWeight(id, doctorId, weightInput);
      }
      return this.getPatient(id);
    },
    async deletePatient(id) {
      const session = await requireSupabaseSession();
      const doctorId = session.user.id;
      const currentPatient = await this.getPatient(id);
      if (!currentPatient) throw new RepositoryError(REPOSITORY_ERROR_TYPES.PERMISSION, "Patient is not available for the current doctor.");

      const { data: attachmentRows, error: readAttachmentsError } = await selectAttachmentColumns(from("attachments")).eq("patient_id", id);
      if (readAttachmentsError) throwRepositoryError(readAttachmentsError, "Unable to read patient attachments.");

      const patientPathPrefix = `${encodeURIComponent(doctorId)}/${encodeURIComponent(id)}/`;
      const storagePaths = [...new Set((attachmentRows || []).map((row) => row.storage_path).filter(Boolean))];
      const unsafePath = storagePaths.find((storagePath) => !storagePath.startsWith(patientPathPrefix));
      if (unsafePath) {
        throw new RepositoryError(REPOSITORY_ERROR_TYPES.PERMISSION, "Attachment path is outside the patient namespace.");
      }
      if (storagePaths.length) {
        const { error: removeError } = await attachmentBucket().remove(storagePaths);
        if (removeError) throwRepositoryError(removeError, "Unable to remove patient attachment objects.");
      }

      const orderedDeletes = [
        ["attachments", "Unable to remove patient attachment metadata."],
        ["visits", "Unable to remove patient visits."],
        ["patient_weights", "Unable to remove patient weight history."]
      ];
      for (const [table, message] of orderedDeletes) {
        const { error } = await from(table).delete().eq("patient_id", id).eq("doctor_id", doctorId);
        if (error) throwRepositoryError(error, message);
      }
      const { data: deletedRows, error } = await from("patients").delete().eq("id", id).eq("doctor_id", doctorId).select("id");
      if (error) throwRepositoryError(error, "Unable to remove patient.");
      if (!deletedRows?.length) throw new RepositoryError(REPOSITORY_ERROR_TYPES.PERMISSION, "Patient is not available for the current doctor.");
      return currentPatient;
    },
    async getVisits(patientId) {
      await requireSupabaseSession();
      const query = orderVisitsClinically(selectVisitColumns(from("visits")).eq("patient_id", patientId));
      const { data, error } = await query;
      if (error) throwRepositoryError(error, "Unable to read visits.");
      return (data || []).map(mapVisitRow);
    },
    async getVisit(id) {
      await requireSupabaseSession();
      const { data, error } = await selectVisitColumns(from("visits")).eq("id", id).maybeSingle();
      if (error) throwRepositoryError(error, "Unable to read visit.");
      return data ? mapVisitRow(data) : null;
    },
    async createVisit(patientId, input = {}, files = []) {
      const session = await requireSupabaseSession();
      const visitInput = {
        ...input,
        status: input.status || "completed",
        completedAt: input.completedAt || (input.status === "draft" ? null : nowISO())
      };
      const { data, error } = await from("visits")
        .insert(mapVisitInputToSupabasePayload(visitInput, patientId, session.user.id))
        .select(VISIT_SELECT_COLUMNS)
        .single();
      if (error) throwRepositoryError(error, "Unable to create visit.");
      const visit = mapVisitRow(data);
      const savedAttachments = [];
      try {
        for (const file of Array.from(files || [])) savedAttachments.push(await this.addAttachment(patientId, visit.id, file));
      } catch (attachmentError) {
        for (const attachment of savedAttachments.reverse()) {
          try {
            await this.removeAttachment(attachment.id);
          } catch {
            // Preserve the original attachment error; cleanup failures are recoverable by cloud audit.
          }
        }
        try {
          await from("visits").delete().eq("id", visit.id);
        } catch {
          // Preserve the original attachment error; created-visit cleanup can be retried through cloud audit.
        }
        throw attachmentError;
      }
      return visit;
    },
    async getOrCreateDraftVisit(patientId) {
      const session = await requireSupabaseSession();
      const readDraft = async () => {
        const { data, error } = await selectVisitColumns(from("visits"))
          .eq("patient_id", patientId)
          .eq("status", "draft")
          .maybeSingle();
        if (error) throwRepositoryError(error, "Unable to read draft visit.");
        return data ? mapVisitRow(data) : null;
      };
      const existingDraft = await readDraft();
      if (existingDraft) return existingDraft;
      const { data, error } = await from("visits")
        .insert(
          mapVisitInputToSupabasePayload(
            {
              date: todayISO(),
              format: "clinic",
              status: "draft",
              note: "",
              decision: "",
              nextStep: "",
              nextStepTiming: "",
              startedAt: nowISO(),
              completedAt: null
            },
            patientId,
            session.user.id
          )
        )
        .select(VISIT_SELECT_COLUMNS)
        .single();
      if (!error) return mapVisitRow(data);
      if (classifySupabaseError(error) === REPOSITORY_ERROR_TYPES.CONFLICT) {
        const racedDraft = await readDraft();
        if (racedDraft) return racedDraft;
      }
      throwRepositoryError(error, "Unable to create draft visit.");
    },
    async updateVisit(id, input = {}) {
      const session = await requireSupabaseSession();
      const expectedVersion = visitExpectedVersion(input);
      const payload = {
        ...mapVisitUpdateInputToSupabasePayload(input),
        version: expectedVersion + 1
      };
      delete payload.expectedVersion;
      const { data, error } = await from("visits")
        .update(payload)
        .eq("id", id)
        .eq("doctor_id", session.user.id)
        .eq("version", expectedVersion)
        .select(VISIT_SELECT_COLUMNS);
      if (error) throwRepositoryError(error, "Unable to update visit.");
      if (!data?.length) {
        throw new RepositoryError(REPOSITORY_ERROR_TYPES.CONFLICT, "Visit was changed by another session.");
      }
      return mapVisitRow(data[0]);
    },
    async getAttachments(patientId, visitId = null) {
      await requireSupabaseSession();
      let query = selectAttachmentColumns(from("attachments")).eq("patient_id", patientId);
      if (visitId) query = query.eq("visit_id", visitId);
      const { data, error } = await query.order("added_at", { ascending: false });
      if (error) throwRepositoryError(error, "Unable to read attachments.");
      return (data || []).map(mapAttachmentMetadataRow);
    },
    async addAttachment(patientId, visitId, file = {}) {
      const session = await requireSupabaseSession();
      const doctorId = session.user.id;
      await readOwnedVisit(visitId, patientId);
      const attachmentId = uid();
      const body = attachmentUploadBody(file);
      const size = validateAttachmentFile(file, body);
      const payload = mapAttachmentMetadataInputToSupabasePayload(
        {
          ...file,
          size,
          mime: file.mime || file.type || body.type || "application/octet-stream"
        },
        { doctorId, patientId, visitId, attachmentId }
      );
      const { error: uploadError } = await attachmentBucket().upload(payload.storage_path, body, {
        cacheControl: "3600",
        contentType: payload.mime_type,
        upsert: false
      });
      if (uploadError) throwRepositoryError(uploadError, "Unable to upload attachment.");
      const { data, error } = await from("attachments").insert(payload).select(ATTACHMENT_SELECT_COLUMNS).single();
      if (error) {
        try {
          await attachmentBucket().remove([payload.storage_path]);
        } catch {
          // The metadata insert error remains authoritative; the failed cleanup is recoverable by storage audit.
        }
        throwRepositoryError(error, "Unable to save attachment metadata.");
      }
      return mapAttachmentMetadataRow(data);
    },
    async getAttachmentSignedUrl(id, expiresIn = SIGNED_ATTACHMENT_URL_TTL_SECONDS) {
      await requireSupabaseSession();
      const attachment = await readAttachmentMetadata(id);
      const { data, error } = await attachmentBucket().createSignedUrl(attachment.storagePath, expiresIn);
      if (error) throwRepositoryError(error, "Unable to create attachment access URL.");
      return data.signedUrl;
    },
    async removeAttachment(id) {
      await requireSupabaseSession();
      const attachment = await readAttachmentMetadata(id);
      const { error: removeError } = await attachmentBucket().remove([attachment.storagePath]);
      if (removeError) throwRepositoryError(removeError, "Unable to remove attachment object.");
      const { error } = await from("attachments").delete().eq("id", id);
      if (error) throwRepositoryError(error, "Unable to remove attachment metadata.");
      return attachment;
    }
  };
})();

const dbRepository = (() => {
  let dbPromise;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function readState() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function writeState(state) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state, STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function ensureState() {
    const existing = await readState();
    if (existing) {
      const normalized = normalizeState(existing);
      if (JSON.stringify(existing) !== JSON.stringify(normalized)) await writeState(normalized);
      return normalized;
    }
    const seeded = demoState();
    await writeState(seeded);
    return seeded;
  }

  async function mutate(updater) {
    const state = await ensureState();
    const next = updater(structuredClone(state));
    await writeState(next);
    return next;
  }

  return {
    async getPatients() {
      return (await ensureState()).patients;
    },
    async getPatient(id) {
      return (await ensureState()).patients.find((patient) => patient.id === id) || null;
    },
    async createPatient(input) {
      const nextWeight = String(input.currentWeightKg || "").trim();
      const nextDate = String(input.weightMeasuredAt || "").trim();
      const { currentWeightKg, weightMeasuredAt, ...patientInput } = input;
      const patient = normalizePatient({
        id: uid(),
        ...patientInput,
        weightHistory: nextWeight && nextDate ? [{ id: uid(), valueKg: nextWeight, measuredAt: nextDate, createdAt: nowISO() }] : [],
        createdAt: nowISO(),
        updatedAt: nowISO()
      });
      await mutate((state) => ({ ...state, patients: [...state.patients, patient] }));
      return patient;
    },
    async updatePatient(id, input) {
      await mutate((state) => ({
        ...state,
        patients: state.patients.map((patient) => {
          if (patient.id !== id) return patient;
          const current = normalizePatient(patient);
          const nextWeight = String(input.currentWeightKg || "").trim();
          const nextDate = String(input.weightMeasuredAt || "").trim();
          const weightHistory = [...current.weightHistory];
          const currentWeight = latestWeight(current);
          if (nextWeight && nextDate && (!currentWeight || currentWeight.valueKg !== nextWeight || currentWeight.measuredAt !== nextDate)) {
            weightHistory.push({ id: uid(), valueKg: nextWeight, measuredAt: nextDate, createdAt: nowISO() });
          }
          const { currentWeightKg, weightMeasuredAt, ...patientInput } = input;
          return normalizePatient({ ...current, ...patientInput, weightHistory, updatedAt: nowISO() });
        })
      }));
      return this.getPatient(id);
    },
    async deletePatient(id) {
      let deletedPatient = null;
      await mutate((state) => {
        deletedPatient = state.patients.find((patient) => patient.id === id) || null;
        return {
          ...state,
          patients: state.patients.filter((patient) => patient.id !== id),
          visits: state.visits.filter((visit) => visit.patientId !== id),
          attachments: state.attachments.filter((attachment) => attachment.patientId !== id)
        };
      });
      return deletedPatient;
    },
    async getVisits(patientId) {
      return (await ensureState()).visits.filter((visit) => visit.patientId === patientId);
    },
    async createVisit(patientId, input, files) {
      const visit = normalizeVisit({ id: uid(), patientId, status: "completed", ...input, createdAt: nowISO(), updatedAt: nowISO() });
      const attachments = files.map((file) => ({ ...file, id: uid(), patientId, visitId: visit.id, addedAt: nowISO() }));
      await mutate((state) => ({
        ...state,
        visits: [...state.visits, visit],
        attachments: [...state.attachments, ...attachments]
      }));
      return visit;
    },
    async getVisit(id) {
      return (await ensureState()).visits.find((visit) => visit.id === id) || null;
    },
    async getOrCreateDraftVisit(patientId) {
      const existing = (await ensureState()).visits.find((visit) => visit.patientId === patientId && visit.status === "draft");
      if (existing) return existing;
      const draft = normalizeVisit({
        id: uid(),
        patientId,
        date: todayISO(),
        format: "clinic",
        status: "draft",
        note: "",
        decision: "",
        nextStep: "",
        nextStepTiming: "",
        startedAt: nowISO(),
        createdAt: nowISO(),
        updatedAt: nowISO()
      });
      await mutate((state) => ({ ...state, visits: [...state.visits, draft] }));
      return draft;
    },
    async updateVisit(id, input) {
      let savedVisit = null;
      const { expectedVersion, ...visitInput } = input;
      await mutate((state) => ({
        ...state,
        visits: state.visits.map((visit) => {
          if (visit.id !== id) return visit;
          savedVisit = normalizeVisit({
            ...visit,
            ...visitInput,
            version: Number(visit.version || 1) + 1,
            updatedAt: nowISO()
          });
          return savedVisit;
        })
      }));
      return savedVisit;
    },
    async addAttachment(patientId, visitId, file) {
      const attachment = { ...file, id: uid(), patientId, visitId, addedAt: nowISO() };
      await mutate((state) => ({ ...state, attachments: [...state.attachments, attachment] }));
      return attachment;
    },
    async removeAttachment(id) {
      await mutate((state) => ({ ...state, attachments: state.attachments.filter((item) => item.id !== id) }));
    },
    async getAttachments(patientId, visitId = null) {
      const state = await ensureState();
      return state.attachments.filter((item) => item.patientId === patientId && (!visitId || item.visitId === visitId));
    }
  };
})();

const repository = supabaseRepository;

let state = { patients: [], visits: [], attachments: [], query: "", medicalTemplates: [], templateQuery: "" };
let authState = { status: "auth-loading", session: null, error: "" };

async function hydrate() {
  state.patients = await repository.getPatients();
  const allVisits = await Promise.all(state.patients.map((patient) => repository.getVisits(patient.id)));
  const allAttachments = await Promise.all(state.patients.map((patient) => repository.getAttachments(patient.id)));
  state.visits = allVisits.flat();
  state.attachments = allAttachments.flat();
}

function resetUiState() {
  state = { patients: [], visits: [], attachments: [], query: "", medicalTemplates: [], templateQuery: "" };
}

function setAuthState(nextState) {
  authState = { ...authState, ...nextState };
  if (logoutButton) logoutButton.hidden = authState.status !== "authenticated";
}

function renderAuthLoading() {
  app.innerHTML = `
    <section class="state-panel auth-panel">
      <div class="spinner" aria-hidden="true"></div>
      <p>Проверяем сессию...</p>
    </section>
  `;
}

function renderLogin(message = "") {
  if (logoutButton) logoutButton.hidden = true;
  app.innerHTML = `
    <section class="login-layout" aria-labelledby="loginTitle">
      <form class="panel login-panel" data-login-form novalidate>
        <div>
          <p class="eyebrow">MedNote</p>
          <h1 id="loginTitle">Вход врача</h1>
        </div>
        <div class="field">
          <label for="loginName">Логин</label>
          <input id="loginName" name="login" type="text" inputmode="text" autocomplete="username" autocapitalize="none" spellcheck="false" required />
        </div>
        <div class="field">
          <label for="loginPassword">Пароль</label>
          <input id="loginPassword" name="password" type="password" autocomplete="current-password" required />
        </div>
        <p class="form-message" data-login-message>${escapeHtml(message)}</p>
        <button class="button" type="submit">Войти</button>
      </form>
    </section>
  `;
  bindLoginForm();
}

function renderAuthError(message) {
  app.innerHTML = `
    <section class="state-panel auth-panel">
      <h2>Не удалось подготовить вход</h2>
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

function renderCloudError(error) {
  resetUiState();
  const type = error instanceof RepositoryError ? error.type : REPOSITORY_ERROR_TYPES.UNKNOWN;
  const messages = {
    [REPOSITORY_ERROR_TYPES.AUTH]: "Сессия истекла. Войдите снова.",
    [REPOSITORY_ERROR_TYPES.NETWORK]: "Не удалось связаться с MedNote Cloud. Проверьте соединение и обновите страницу.",
    [REPOSITORY_ERROR_TYPES.PERMISSION]: "Нет доступа к этим данным.",
    [REPOSITORY_ERROR_TYPES.CONFLICT]: "Данные изменились в другом окне. Обновите страницу перед продолжением.",
    [REPOSITORY_ERROR_TYPES.UNKNOWN]: "Не удалось загрузить данные из MedNote Cloud."
  };
  app.innerHTML = `
    <section class="state-panel auth-panel">
      <h2>MedNote Cloud временно недоступен</h2>
      <p>${escapeHtml(messages[type] || messages[REPOSITORY_ERROR_TYPES.UNKNOWN])}</p>
      <button class="button" type="button" data-retry-cloud>Повторить</button>
    </section>
  `;
  document.querySelector("[data-retry-cloud]")?.addEventListener("click", () => route(location.hash || "#/"));
}

function bindLoginForm() {
  const form = document.querySelector("[data-login-form]");
  if (!form) return;
  const message = form.querySelector("[data-login-message]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabaseClient) {
      if (message) message.textContent = "Клиент Supabase не загружен. Проверьте соединение и обновите страницу.";
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const login = String(formData.get("login") || "");
    const technicalEmail = loginToTechnicalEmail(login);
    const password = String(formData.get("password") || "");
    if (message) message.textContent = "";
    if (!technicalEmail) {
      if (message) message.textContent = "Проверьте логин.";
      return;
    }
    if (submit) submit.disabled = true;
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email: technicalEmail, password });
    if (error) {
      if (message) message.textContent = "Не удалось войти. Проверьте логин и пароль.";
      if (submit) submit.disabled = false;
      return;
    }
    setAuthState({ status: "authenticated", session: data.session, error: "" });
    await route(location.hash || "#/");
  });
}

async function initializeAuth() {
  renderAuthLoading();
  if (!supabaseClient) {
    setAuthState({ status: "unauthenticated", session: null, error: "Supabase JS не загружен." });
    renderAuthError("Supabase JS не загружен. Проверьте сетевой доступ к CDN и обновите страницу.");
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setAuthState({ status: "unauthenticated", session: null, error: error.message });
    renderLogin("Сессия недействительна. Войдите снова.");
  } else {
    setAuthState({
      status: data.session ? "authenticated" : "unauthenticated",
      session: data.session,
      error: ""
    });
    await route(location.hash || "#/");
  }

  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      resetUiState();
      setAuthState({ status: "unauthenticated", session: null, error: "" });
      renderLogin();
      return;
    }
    setAuthState({ status: "authenticated", session, error: "" });
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") await route(location.hash || "#/");
  });
}

function latestVisit(patientId) {
  return state.visits
    .filter((visit) => visit.patientId === patientId && visit.status !== "draft")
    .sort(compareVisitsDesc)[0];
}

function compareVisitsDesc(a, b) {
  const dateCompare = `${b.date || ""}`.localeCompare(`${a.date || ""}`);
  if (dateCompare) return dateCompare;
  return `${b.updatedAt || b.createdAt || ""}`.localeCompare(`${a.updatedAt || a.createdAt || ""}`);
}

function clinicalVisitTimestamp(visit = {}) {
  return visit.date || visit.completedAt || visit.startedAt || visit.createdAt || "";
}

function patientById(patientId) {
  return state.patients.find((patient) => patient.id === patientId) || null;
}

function attachmentIcon(attachment) {
  if (attachment.mime.startsWith("image/") && attachment.dataUrl) {
    return `<img src="${attachment.dataUrl}" alt="">`;
  }
  if (attachment.mime.includes("pdf")) return "PDF";
  return "DOC";
}

function renderAttachment(attachment, removable = false) {
  const openAction = attachment.mime.startsWith("image/")
    ? `<button class="text-button compact-action" type="button" data-view-image="${attachment.id}">Открыть</button>`
    : `<button class="text-button compact-action" type="button" data-open-attachment="${attachment.id}">Открыть</button>`;
  return `
    <div class="attachment-row">
      <div class="attachment-thumb">${attachmentIcon(attachment)}</div>
      <div class="attachment-meta">
        <strong title="${escapeHtml(attachment.name)}">${escapeHtml(attachment.name)}</strong>
        <span>${escapeHtml(attachment.mime)} ${fileSize(attachment.size)}</span>
      </div>
      <div class="action-row">
        ${openAction}
        ${removable ? `<button class="icon-button danger" type="button" data-remove-attachment="${attachment.id}" aria-label="Удалить вложение">×</button>` : ""}
      </div>
    </div>
  `;
}

async function resolveAttachmentUrl(attachment) {
  if (attachment?.dataUrl) return attachment.dataUrl;
  if (attachment?.storagePath) return supabaseRepository.getAttachmentSignedUrl(attachment.id);
  throw new RepositoryError(REPOSITORY_ERROR_TYPES.UNKNOWN, "Attachment file is unavailable.");
}

async function openAttachment(attachment) {
  try {
    const url = await resolveAttachmentUrl(attachment);
    window.open(url, "_blank", "noopener");
  } catch {
    showToast("Файл временно не удалось открыть");
  }
}

function dashboardDraftVisits() {
  return state.visits
    .filter((visit) => visit.status === "draft")
    .sort(compareVisitsDesc);
}

function dashboardRecentPatients(limit = 5) {
  return state.patients
    .map((patient) => ({ patient, visit: latestVisit(patient.id) }))
    .sort((a, b) => {
      const visitCompare = `${clinicalVisitTimestamp(b.visit)}`.localeCompare(`${clinicalVisitTimestamp(a.visit)}`);
      if (visitCompare) return visitCompare;
      return a.patient.fullName.localeCompare(b.patient.fullName, "ru");
    })
    .slice(0, limit);
}

function renderDashboardDraft(visit) {
  const patient = patientById(visit.patientId);
  if (!patient) return "";
  const context = shortTextPreview(visit.note || visit.decision || visit.nextStep || "", 110);
  return `
    <a class="dashboard-row dashboard-draft-row" href="#/patient/${patient.id}/encounter/${visit.id}">
      <div class="dashboard-row-main">
        <strong>${escapeHtml(patient.fullName)}</strong>
        <span>${formatDate(visit.date)} · ${visitFormatLabel(visit.format)}</span>
      </div>
      <div class="dashboard-row-context">${context ? escapeHtml(context) : "Черновик без заметки"}</div>
      <span class="dashboard-row-action">Продолжить</span>
    </a>
  `;
}

function renderDashboardRecentPatient({ patient, visit }) {
  const birth = patient.birthDate ? `${calculateAge(patient.birthDate)} лет · ${formatDate(patient.birthDate)}` : "дата рождения не указана";
  const lastVisit = visit ? `${formatShortDate(visit.date)} · ${visitFormatLabel(visit.format)}` : "обращений нет";
  return `
    <a class="dashboard-row dashboard-patient-row" href="#/patient/${patient.id}">
      <div class="patient-avatar" aria-hidden="true">${escapeHtml(initials(patient.fullName))}</div>
      <div class="dashboard-row-main">
        <strong>${escapeHtml(patient.fullName)}</strong>
        <span>${escapeHtml(birth)}</span>
      </div>
      <div class="dashboard-row-context">${escapeHtml(lastVisit)}</div>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  `;
}

function renderHomeDashboard() {
  const drafts = dashboardDraftVisits();
  const recentPatients = dashboardRecentPatients();
  const completedVisits = state.visits.filter((visit) => visit.status !== "draft");
  app.innerHTML = `
    <section class="page-head dashboard-head">
      <div>
        <h1>Главная</h1>
        <p class="eyebrow">Рабочее пространство врача</p>
      </div>
      <div class="page-actions">
        <button class="ghost-button" type="button" data-open-document-import>Импорт документа</button>
        <a class="ghost-button" href="#/patients">Новый приём</a>
        <button class="button" type="button" data-open-patient-form>+ Добавить пациента</button>
      </div>
    </section>

    <section class="dashboard-summary" aria-label="Краткая сводка">
      <div>
        <span>Пациентов</span>
        <strong>${state.patients.length}</strong>
      </div>
      <div>
        <span>Черновиков</span>
        <strong>${drafts.length}</strong>
      </div>
      <div>
        <span>Завершённых обращений</span>
        <strong>${completedVisits.length}</strong>
      </div>
    </section>

    <section class="dashboard-grid">
      <section class="dashboard-panel dashboard-panel-primary">
        <div class="dashboard-panel-head">
          <div>
            <h2>Незавершённые обращения</h2>
            <p>Черновики, к которым можно вернуться</p>
          </div>
        </div>
        ${
          drafts.length
            ? `<div class="dashboard-rows">${drafts.map(renderDashboardDraft).join("")}</div>`
            : `<div class="dashboard-empty"><strong>Незавершённых обращений нет</strong><span>Новые черновики появятся здесь после начала приёма.</span></div>`
        }
      </section>

      <section class="dashboard-panel">
        <div class="dashboard-panel-head">
          <div>
            <h2>Последние пациенты</h2>
            <p>По последним завершённым обращениям</p>
          </div>
          <a class="text-button compact-action" href="#/patients">Все пациенты →</a>
        </div>
        ${
          recentPatients.length
            ? `<div class="dashboard-rows">${recentPatients.map(renderDashboardRecentPatient).join("")}</div>`
            : `<div class="dashboard-empty"><strong>Пациентов пока нет</strong><span>Добавьте первого пациента, чтобы начать работу.</span><button class="button" type="button" data-open-patient-form>+ Добавить пациента</button></div>`
        }
      </section>
    </section>
  `;
}

function updateNavigationState() {
  const section = location.hash.startsWith("#/templates")
    ? "templates"
    : location.hash.startsWith("#/patients") || location.hash.startsWith("#/patient/")
      ? "patients"
      : "home";
  document.querySelectorAll("[data-nav-section]").forEach((item) => {
    const isActive = item.dataset.navSection === section;
    item.classList.toggle("active", isActive);
    if (isActive) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
}

function renderPatientList() {
  app.innerHTML = `
    <section class="page-head patient-list-head">
      <div>
        <h1>Пациенты</h1>
        <p class="eyebrow">${state.patients.length} пациентов</p>
      </div>
      <div class="page-actions">
        <button class="ghost-button" type="button" data-open-document-import>Импорт документа</button>
        <button class="button" type="button" data-open-patient-form>+ Добавить пациента</button>
      </div>
    </section>
    <section class="toolbar patient-directory-toolbar" aria-label="Поиск пациентов">
      <div class="field search-field">
        <label for="patientSearch">Поиск пациента по ФИО</label>
        <input id="patientSearch" type="search" value="${escapeHtml(state.query)}" placeholder="Поиск пациента по ФИО" autocomplete="off" />
        <span class="hint" id="searchHint"></span>
      </div>
    </section>
    <div id="patientResults"></div>
  `;
  renderPatientResults();
  document.querySelector("#patientSearch").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderPatientResults();
  });
}

function fieldValue(item) {
  return window.MedNoteDocumentParser?.fieldValue(item) || null;
}

function normalizeMatchName(value = "") {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findPatientImportMatches(draft) {
  const fullName = fieldValue(draft.patient.fullName) || "";
  const birthDate = fieldValue(draft.patient.birthDate) || "";
  const normalizedName = normalizeMatchName(fullName);
  const sameName = state.patients.filter((patient) => normalizeMatchName(patient.fullName) === normalizedName);
  const exact = birthDate ? sameName.filter((patient) => patient.birthDate === birthDate) : [];
  const warnings = [...draft.warnings];
  if (sameName.length && !exact.length) warnings.push("Найден пациент с таким ФИО, но другой или отсутствующей датой рождения");
  if (exact.length > 1) warnings.push("Найдено несколько пациентов с тем же ФИО и датой рождения");
  return { exact, sameName, warnings };
}

function formatImportDateSource(item) {
  const value = fieldValue(item);
  if (!value) return "";
  const [year, month, day] = String(value).split("-");
  const displayDate = year && month && day ? `${day}.${month}.${year}` : String(value);
  const source = item?.sourceText || "";
  const sourceDate = displayDate.replace(/\./g, "[./-]");
  const match = source.match(new RegExp(`(${sourceDate}(?:\\s*\\([^)]*\\))?)`, "i"));
  return match?.[1] || displayDate;
}

function importFieldSource(item, options = {}) {
  if (!item?.sourceText && !fieldValue(item)) return `<span class="hint"></span>`;
  let source = item.sourceText || "";
  if (options.kind === "identity-name") {
    source = fieldValue(item) || source;
  } else if (options.kind === "identity-date") {
    source = formatImportDateSource(item) || source;
  }
  return source ? `<span class="hint import-source">Источник: ${escapeHtml(source)}</span>` : `<span class="hint"></span>`;
}

function formatInvestigationDraft(item) {
  if (!item) return "";
  const bits = [];
  if (item.value) bits.push(item.value);
  if (item.unit) bits.push(item.unit);
  if (item.referenceRange) bits.push(`(${item.referenceRange})`);
  return bits.length ? bits.join(" ") : item.rawText || "";
}

function buildVisitNoteFromDraft(draft) {
  const parts = [
    ["Анамнез", fieldValue(draft.clinical.anamnesis)],
    ["Жалобы", fieldValue(draft.clinical.complaints)],
    ["Объективно", fieldValue(draft.clinical.objectiveStatus)]
  ].filter(([, value]) => value);
  const investigations = draft.investigations?.length
    ? `Обследования:\n${draft.investigations.map((item) => `- ${item.name}: ${formatInvestigationDraft(item)}`).join("\n")}`
    : "";
  return [...parts.map(([label, value]) => `${label}:\n${value}`), investigations].filter(Boolean).join("\n\n");
}

function buildVisitDecisionFromDraft(draft) {
  const parts = [
    fieldValue(draft.clinical.icdCode) ? `МКБ: ${fieldValue(draft.clinical.icdCode)}` : "",
    fieldValue(draft.clinical.clinicalDiagnosis) ? `Диагноз:\n${fieldValue(draft.clinical.clinicalDiagnosis)}` : "",
    fieldValue(draft.clinical.treatment) ? `Лечение:\n${fieldValue(draft.clinical.treatment)}` : "",
    fieldValue(draft.clinical.recommendations) ? `Рекомендации:\n${fieldValue(draft.clinical.recommendations)}` : ""
  ];
  return parts.filter(Boolean).join("\n\n");
}

const ICD_LABELS = {
  "E78.4": "Другие гиперлипидемии"
};

function getIcdLabel(code) {
  return ICD_LABELS[String(code || "").trim().toUpperCase()] || "";
}

function buildDisplayedClinicalSummary(draft) {
  return [
    ["Анамнез", fieldValue(draft.clinical.anamnesis)],
    ["Жалобы", fieldValue(draft.clinical.complaints)],
    ["Объективно", fieldValue(draft.clinical.objectiveStatus)]
  ].filter(([, value]) => value);
}

function calculateImportBmi(height, weight) {
  const heightMeters = Number(String(height || "").replace(",", ".")) / 100;
  const weightKg = Number(String(weight || "").replace(",", "."));
  if (!heightMeters || !weightKg) return "";
  const bmi = weightKg / (heightMeters * heightMeters);
  return Number.isFinite(bmi) ? bmi.toFixed(1).replace(".", ",") : "";
}

function importReviewSection(title, body) {
  return `
    <section class="import-data-section">
      <div class="import-data-section-head">
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${body}
    </section>
  `;
}

function renderImportReview({ file, draft, extraction }) {
  const { exact, warnings } = findPatientImportMatches(draft);
  const patientName = fieldValue(draft.patient.fullName) || "";
  const birthDate = fieldValue(draft.patient.birthDate) || "";
  const height = fieldValue(draft.anthropometry.heightCm) || "";
  const weight = fieldValue(draft.anthropometry.weightKg) || "";
  const date = fieldValue(draft.document.date) || todayISO();
  const note = buildVisitNoteFromDraft(draft);
  const decision = buildVisitDecisionFromDraft(draft);
  const displayedClinical = buildDisplayedClinicalSummary(draft);
  const icdCode = fieldValue(draft.clinical.icdCode) || "";
  const icdLabel = fieldValue(draft.clinical.icdDiagnosis) || getIcdLabel(icdCode);
  const diagnosis = fieldValue(draft.clinical.clinicalDiagnosis) || "";
  const treatment = fieldValue(draft.clinical.treatment) || "";
  const recommendations = fieldValue(draft.clinical.recommendations) || "";
  const nextStep = fieldValue(draft.clinical.nextStep) || "";
  const rawNextTiming = fieldValue(draft.clinical.nextVisitTiming) || "";
  const nextTiming = normalizeMatchName(rawNextTiming) === normalizeMatchName(nextStep) ? "" : rawNextTiming;
  const createChecked = exact.length === 1 ? "" : "checked";
  const patientBadge = exact.length ? "Найден пациент" : "Новый пациент";
  const matchNotice = exact.length
    ? "Найдено совпадение. Проверьте пациента перед импортом."
    : "Совпадение не найдено · будет создан новый пациент";
  const bmi = calculateImportBmi(height, weight);
  const node = modal(`
    <form class="import-review-form">
      <div class="dialog-head">
        <div>
          <p class="eyebrow">Импорт документа</p>
          <h2>${escapeHtml(file.name)}</h2>
        </div>
        <div class="import-header-actions">
          <button class="ghost-button import-original-button" type="button" data-open-original ${window.pdfjsLib ? "" : "disabled"}>Оригинал</button>
          <span class="badge">${extraction.method === "ocr" ? "OCR" : "PDF text"}</span>
          <span class="badge">${patientBadge}</span>
        </div>
        <button class="icon-button" type="button" data-close aria-label="Закрыть">×</button>
      </div>
      <div class="dialog-body import-review-body">
        ${
          warnings.length
            ? `<section class="import-section import-warnings"><h3>Проверьте внимательно</h3><ul>${warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`
            : ""
        }
        <div class="import-review-workspace">
          <main class="import-data-panel">
            <textarea id="importNote" name="note" hidden>${escapeHtml(note)}</textarea>
            <textarea id="importDecision" name="decision" hidden>${escapeHtml(decision)}</textarea>
            <section class="import-patient-panel">
              <div>
                <input class="import-patient-name" id="importFullName" name="fullName" aria-label="ФИО" value="${escapeHtml(patientName)}" required />
                <div class="import-patient-meta">
                  <input id="importBirthDate" name="birthDate" type="date" aria-label="Дата рождения" value="${escapeHtml(birthDate)}" required />
                </div>
                <p class="import-match-notice">${escapeHtml(matchNotice)}</p>
                <details class="import-evidence">
                  <summary>Источник</summary>
                  <p>${importFieldSource(draft.patient.fullName, { kind: "identity-name" })}</p>
                  <p>${importFieldSource(draft.patient.birthDate, { kind: "identity-date" })}</p>
                  <p>${importFieldSource(draft.document.date)}</p>
                </details>
                <span class="error" data-error="fullName"></span>
                <span class="error" data-error="birthDate"></span>
              </div>
              ${
                exact.length === 1
                  ? `<div class="import-patient-match-control">
                      <label class="import-choice"><input type="radio" name="patientMode" value="existing" data-import-existing-patient="${exact[0].id}" /> <span>Использовать найденного пациента</span></label>
                      <label class="import-choice"><input type="radio" name="patientMode" value="create" ${createChecked} /> <span>Создать нового</span></label>
                    </div>`
                  : `<input type="hidden" name="patientMode" value="create" />`
              }
            </section>
            ${importReviewSection("Обращение", `
              <div class="import-encounter-strip">
                <label><input id="importVisitDate" name="visitDate" type="date" aria-label="Дата обращения" value="${escapeHtml(date)}" required /></label>
                <span class="import-summary-dot">·</span>
                <label><select id="importFormat" name="format" aria-label="Формат">
                  <option value="clinic">В клинике</option>
                  <option value="online">Онлайн</option>
                  <option value="phone">Телефон / сообщение</option>
                </select></label>
                ${height ? `<span class="import-summary-dot">·</span><label><input id="importHeight" name="heightCm" type="number" min="0" step="1" value="${escapeHtml(height)}" /><em>см</em></label>` : `<input id="importHeight" name="heightCm" type="hidden" value="" />`}
                ${weight ? `<span class="import-summary-dot">·</span><label><input id="importWeight" name="currentWeightKg" type="number" min="0" step="0.1" value="${escapeHtml(weight)}" /><em>кг</em></label>` : `<input id="importWeight" name="currentWeightKg" type="hidden" value="" />`}
                ${bmi ? `<span class="import-summary-dot">·</span><label class="import-bmi-summary"><span>ИМТ</span><output data-import-bmi>${escapeHtml(bmi)}</output></label>` : `<output data-import-bmi hidden>—</output>`}
                <input id="importWeightDate" name="weightMeasuredAt" type="hidden" value="${escapeHtml(date)}" />
              </div>
              <label class="import-choice import-metrics-choice" data-existing-metrics-option ${exact.length ? "" : "hidden"}>
                <input type="checkbox" name="updateExistingMetrics" ${height || weight ? "checked" : ""} />
                <span>Добавить найденные параметры в карточку существующего пациента</span>
              </label>
              <span class="error" data-error="visitDate"></span>
            `)}
            ${displayedClinical.map(([label, value]) => importReviewSection(label, `
              <textarea class="auto-grow document-editable" data-import-note-section="${escapeHtml(label)}">${escapeHtml(value)}</textarea>
            `)).join("") || importReviewSection("Анамнез", `
              <textarea class="auto-grow document-editable" data-import-note-section="Клиническая запись"></textarea>
            `)}
            ${importReviewSection(`Обследования (${draft.investigations?.length || 0})`, `
              ${
                draft.investigations?.length
                  ? `<div class="investigation-list import-main-investigations">${draft.investigations.map((item) => `
                    <label>
                      <input data-investigation-name value="${escapeHtml(item.name)}" aria-label="Название обследования" />
                      <textarea class="auto-grow document-editable compact-auto-grow" rows="1" data-investigation-result aria-label="Результат обследования">${escapeHtml(formatInvestigationDraft(item))}</textarea>
                    </label>
                  `).join("")}</div>`
                  : `<p class="eyebrow">Структурированные обследования не найдены</p>`
              }
            `)}
            ${importReviewSection("Диагноз", `
              <div class="import-diagnosis-line">
                <div class="import-icd-row">
                  <span class="import-icd-chip">
                    <input data-import-decision-field="icd" value="${escapeHtml(icdCode)}" aria-label="МКБ" placeholder="МКБ" />
                    ${icdLabel ? `<span class="import-icd-label">${escapeHtml(icdLabel)}</span>` : ""}
                  </span>
                </div>
                <label class="import-clinical-diagnosis">
                  <span>Клинический диагноз</span>
                  <textarea class="auto-grow document-editable compact-auto-grow" rows="1" data-import-decision-field="diagnosis" aria-label="Диагноз" placeholder="Диагноз">${escapeHtml(diagnosis)}</textarea>
                </label>
              </div>
            `)}
            ${importReviewSection("Лечение и рекомендации", `
              <textarea class="auto-grow document-editable import-long-text" data-import-decision-field="treatment" aria-label="Лечение">${escapeHtml(treatment)}</textarea>
              ${recommendations ? `<textarea class="auto-grow document-editable compact-auto-grow" rows="1" data-import-decision-field="recommendations" aria-label="Рекомендации">${escapeHtml(recommendations)}</textarea>` : ""}
            `)}
            ${importReviewSection("Дальше", `
              <textarea class="auto-grow compact-auto-grow" rows="1" id="importNextStep" name="nextStep">${escapeHtml(nextStep)}</textarea>
              ${
                nextTiming
                  ? `<div class="field">
                      <label for="importNextTiming">Ориентир</label>
                      <input id="importNextTiming" name="nextStepTiming" value="${escapeHtml(nextTiming)}" />
                      ${importFieldSource(draft.clinical.nextVisitTiming)}
                    </div>`
                  : `<input id="importNextTiming" name="nextStepTiming" type="hidden" value="" />`
              }
            `)}
            <details class="import-source-text">
              <summary>Посмотреть исходный текст PDF</summary>
              <pre>${escapeHtml(extraction.fullText)}</pre>
            </details>
          </main>
        </div>
        <div class="import-pdf-overlay" data-pdf-overlay hidden>
          <section class="import-pdf-lightbox" data-pdf-lightbox role="dialog" aria-modal="true" aria-label="Оригинал PDF">
            <div class="import-pdf-lightbox-head">
              <div>
                <p class="eyebrow">Оригинал PDF</p>
                <h3>${escapeHtml(file.name)}</h3>
              </div>
              <button class="icon-button" type="button" data-close-original aria-label="Закрыть оригинал">×</button>
            </div>
            <div class="import-pdf-lightbox-body">
              <div class="import-pdf-thumbnails" data-pdf-thumbnails></div>
              <div class="import-pdf-viewer">
                <div class="import-pdf-toolbar">
                  <button class="icon-button" type="button" data-pdf-prev aria-label="Предыдущая страница">‹</button>
                  <span><strong data-pdf-current>1</strong> / <span data-pdf-total>${escapeHtml(String(extraction.pageCount || 1))}</span></span>
                  <button class="icon-button" type="button" data-pdf-next aria-label="Следующая страница">›</button>
                  <span class="import-pdf-divider"></span>
                  <button class="icon-button" type="button" data-pdf-zoom-out aria-label="Уменьшить">−</button>
                  <span data-pdf-zoom>100%</span>
                  <button class="icon-button" type="button" data-pdf-zoom-in aria-label="Увеличить">+</button>
                </div>
                <div class="import-pdf-page-wrap">
                  <canvas data-pdf-canvas aria-label="PDF preview"></canvas>
                  <p class="hint" data-pdf-message>Готовим предпросмотр PDF...</p>
                </div>
              </div>
            </div>
          </section>
        </div>
        <p class="form-message" data-import-message></p>
      </div>
      <div class="dialog-actions">
        <p class="import-completeness">Все обязательные данные заполнены</p>
        <button class="ghost-button" type="button" data-close>Отмена</button>
        <button class="button" type="submit">Подтвердить импорт</button>
      </div>
    </form>
  `, "import-dialog");
  bindImportReviewForm(node, file);
  bindImportPdfPreview(node, file, extraction.pageCount || 1);
  bindImportOriginalOverlay(node);
}

async function bindImportPdfPreview(node, file, pageCount) {
  const canvas = node.querySelector("[data-pdf-canvas]");
  const thumbnails = node.querySelector("[data-pdf-thumbnails]");
  const message = node.querySelector("[data-pdf-message]");
  const currentLabel = node.querySelector("[data-pdf-current]");
  const totalLabel = node.querySelector("[data-pdf-total]");
  const zoomLabel = node.querySelector("[data-pdf-zoom]");
  const prevButton = node.querySelector("[data-pdf-prev]");
  const nextButton = node.querySelector("[data-pdf-next]");
  const zoomOutButton = node.querySelector("[data-pdf-zoom-out]");
  const zoomInButton = node.querySelector("[data-pdf-zoom-in]");
  if (!canvas || !window.pdfjsLib) {
    if (message) message.textContent = "Предпросмотр PDF недоступен.";
    return;
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  let pdf;
  let currentPage = 1;
  let zoom = 1;
  const context = canvas.getContext("2d", { alpha: false });
  const renderPage = async () => {
    if (!pdf || !context) return;
    if (message) message.textContent = "";
    const page = await pdf.getPage(currentPage);
    const viewport = page.getViewport({ scale: zoom });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.maxWidth = "none";
    await page.render({ canvasContext: context, viewport }).promise;
    if (currentLabel) currentLabel.textContent = String(currentPage);
    if (totalLabel) totalLabel.textContent = String(pdf.numPages);
    if (zoomLabel) zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    prevButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= pdf.numPages;
    thumbnails?.querySelectorAll("[data-pdf-thumb]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.pdfThumb) === currentPage);
    });
  };
  const renderThumbnail = async (pageNumber) => {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 0.18 });
    const thumbCanvas = document.createElement("canvas");
    const thumbContext = thumbCanvas.getContext("2d", { alpha: false });
    thumbCanvas.width = Math.ceil(viewport.width);
    thumbCanvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: thumbContext, viewport }).promise;
    const button = document.createElement("button");
    button.className = "import-pdf-thumb";
    button.type = "button";
    button.dataset.pdfThumb = String(pageNumber);
    button.append(thumbCanvas);
    button.insertAdjacentHTML("beforeend", `<span>${pageNumber}</span>`);
    button.addEventListener("click", async () => {
      currentPage = pageNumber;
      await renderPage();
    });
    thumbnails?.append(button);
  };
  try {
    const data = await file.arrayBuffer();
    pdf = await window.pdfjsLib.getDocument({ data }).promise;
    if (totalLabel) totalLabel.textContent = String(pdf.numPages || pageCount);
    if (thumbnails) {
      thumbnails.innerHTML = "";
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        await renderThumbnail(pageNumber);
      }
    }
    prevButton?.addEventListener("click", async () => {
      currentPage = Math.max(1, currentPage - 1);
      await renderPage();
    });
    nextButton?.addEventListener("click", async () => {
      currentPage = Math.min(pdf.numPages, currentPage + 1);
      await renderPage();
    });
    zoomOutButton?.addEventListener("click", async () => {
      zoom = Math.max(0.75, zoom - 0.15);
      await renderPage();
    });
    zoomInButton?.addEventListener("click", async () => {
      zoom = Math.min(1.6, zoom + 0.15);
      await renderPage();
    });
    await renderPage();
  } catch (error) {
    if (message) message.textContent = "Не удалось показать предпросмотр PDF.";
  }
}

function bindImportOriginalOverlay(node) {
  const openButton = node.querySelector("[data-open-original]");
  const overlay = node.querySelector("[data-pdf-overlay]");
  const lightbox = node.querySelector("[data-pdf-lightbox]");
  const closeButton = node.querySelector("[data-close-original]");
  if (!openButton || !overlay || !lightbox) return;
  let returnFocusTo = null;
  const close = () => {
    overlay.hidden = true;
    node.classList.remove("import-original-open");
    const focusTarget = returnFocusTo?.isConnected ? returnFocusTo : openButton;
    focusTarget?.focus();
  };
  const open = () => {
    returnFocusTo = document.activeElement;
    overlay.hidden = false;
    node.classList.add("import-original-open");
    closeButton?.focus();
  };
  openButton.addEventListener("click", open);
  closeButton?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (!event.target.closest("[data-pdf-lightbox]")) close();
  });
  lightbox.addEventListener("click", (event) => event.stopPropagation());
  node.addEventListener("keydown", (event) => {
    if (!overlay.hidden && event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
}

async function confirmDocumentImport(form, file) {
  const formData = new FormData(form);
  const patientMode = String(formData.get("patientMode") || "");
  const existingRadio = form.querySelector("[data-import-existing-patient]:checked");
  const patientInput = {
    fullName: String(formData.get("fullName") || "").trim(),
    birthDate: String(formData.get("birthDate") || ""),
    sex: "",
    phone: "",
    email: "",
    heightCm: String(formData.get("heightCm") || "").trim(),
    currentWeightKg: String(formData.get("currentWeightKg") || "").trim(),
    weightMeasuredAt: String(formData.get("weightMeasuredAt") || "").trim(),
    medicalContext: { allergies: "", conditions: "", therapy: "", notes: "" },
    about: ""
  };
  const visitInput = {
    date: String(formData.get("visitDate") || ""),
    format: String(formData.get("format") || "clinic"),
    status: "completed",
    note: String(formData.get("note") || "").trim(),
    decision: String(formData.get("decision") || "").trim(),
    nextStep: String(formData.get("nextStep") || "").trim(),
    nextStepTiming: String(formData.get("nextStepTiming") || "").trim()
  };
  if (!patientInput.fullName) throw new Error("Введите ФИО пациента.");
  if (!patientInput.birthDate) throw new Error("Укажите дату рождения.");
  if (!visitInput.date) throw new Error("Укажите дату обращения.");
  if (!visitInput.note && !visitInput.decision && !visitInput.nextStep) throw new Error("Добавьте содержимое обращения.");
  const attachment = {
    kind: "pdf",
    name: file.name,
    mime: file.type || "application/pdf",
    file,
    size: file.size
  };
  let patient;
  if (patientMode === "existing") {
    const patientId = existingRadio?.dataset.importExistingPatient;
    patient = state.patients.find((item) => item.id === patientId);
    if (!patient) throw new Error("Выберите найденного пациента или создание нового.");
    if (formData.get("updateExistingMetrics") && (patientInput.heightCm || patientInput.currentWeightKg)) {
      patient = await repository.updatePatient(patient.id, {
        ...normalizePatient(patient),
        heightCm: patientInput.heightCm || normalizePatient(patient).heightCm || "",
        currentWeightKg: patientInput.currentWeightKg,
        weightMeasuredAt: patientInput.weightMeasuredAt || visitInput.date
      });
    }
  } else {
    patient = await repository.createPatient(patientInput);
  }
  try {
    const visit = await repository.createVisit(patient.id, visitInput, [attachment]);
    return { patient, visit };
  } catch (error) {
    if (patientMode === "create") {
      throw new Error("Пациент создан, но обращение или PDF не удалось сохранить. Откройте карточку пациента и повторите добавление документа вручную.");
    }
    throw error;
  }
}

function bindImportReviewForm(node, file) {
  const form = node.querySelector("form");
  const message = node.querySelector("[data-import-message]");
  const resizeTextarea = (textarea) => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  };
  const syncDocumentFields = () => {
    const noteInput = form.querySelector("#importNote");
    const decisionInput = form.querySelector("#importDecision");
    if (noteInput) {
      const clinicalParts = Array.from(form.querySelectorAll("[data-import-note-section]"))
        .map((field) => [field.dataset.importNoteSection, field.value.trim()])
        .filter(([, value]) => value)
        .map(([label, value]) => `${label}:\n${value}`);
      const investigationParts = Array.from(form.querySelectorAll(".import-main-investigations label"))
        .map((row) => {
          const name = row.querySelector("[data-investigation-name]")?.value.trim();
          const result = row.querySelector("[data-investigation-result]")?.value.trim();
          return name && result ? `- ${name}: ${result}` : "";
        })
        .filter(Boolean);
      const investigations = investigationParts.length ? `Обследования:\n${investigationParts.join("\n")}` : "";
      noteInput.value = [...clinicalParts, investigations].filter(Boolean).join("\n\n");
    }
    if (decisionInput) {
      const icd = form.querySelector('[data-import-decision-field="icd"]')?.value.trim();
      const diagnosis = form.querySelector('[data-import-decision-field="diagnosis"]')?.value.trim();
      const treatment = form.querySelector('[data-import-decision-field="treatment"]')?.value.trim();
      const recommendations = form.querySelector('[data-import-decision-field="recommendations"]')?.value.trim();
      decisionInput.value = [
        icd ? `МКБ: ${icd}` : "",
        diagnosis ? `Диагноз:\n${diagnosis}` : "",
        treatment ? `Лечение:\n${treatment}` : "",
        recommendations ? `Рекомендации:\n${recommendations}` : ""
      ].filter(Boolean).join("\n\n");
    }
  };
  const syncBmi = () => {
    const bmi = calculateImportBmi(form.querySelector("#importHeight")?.value, form.querySelector("#importWeight")?.value);
    const output = form.querySelector("[data-import-bmi]");
    if (output) output.textContent = bmi || "—";
  };
  form.querySelectorAll("textarea.auto-grow").forEach((textarea) => {
    resizeTextarea(textarea);
    requestAnimationFrame(() => resizeTextarea(textarea));
    textarea.addEventListener("input", () => {
      resizeTextarea(textarea);
      syncDocumentFields();
    });
  });
  form.querySelectorAll("[data-investigation-name], [data-import-decision-field], #importHeight, #importWeight").forEach((field) => {
    field.addEventListener("input", () => {
      syncDocumentFields();
      syncBmi();
    });
  });
  syncDocumentFields();
  syncBmi();
  const metricsOption = form.querySelector("[data-existing-metrics-option]");
  const syncMetricsOption = () => {
    if (!metricsOption) return;
    const selectedExisting = Boolean(form.querySelector("[data-import-existing-patient]:checked"));
    metricsOption.hidden = !selectedExisting;
  };
  form.querySelectorAll('input[name="patientMode"]').forEach((radio) => {
    radio.addEventListener("change", syncMetricsOption);
  });
  syncMetricsOption();
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    syncDocumentFields();
    const submit = form.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    if (message) message.textContent = "";
    if (submit) submit.disabled = true;
    try {
      const { patient } = await confirmDocumentImport(form, file);
      node.remove();
      showToast("Документ импортирован");
      await route(`#/patient/${patient.id}`);
    } catch (error) {
      if (submit) submit.disabled = false;
      if (message) message.textContent = error instanceof RepositoryError ? repositoryMessage(error, "Не удалось импортировать документ") : error.message;
    }
  });
}

function openDocumentImport() {
  const node = modal(`
    <div class="dialog-head">
      <div>
        <p class="eyebrow">PDF → черновик</p>
        <h2>Импорт документа</h2>
      </div>
      <button class="icon-button" type="button" data-close aria-label="Закрыть">×</button>
    </div>
    <div class="dialog-body import-start-body">
      <div class="dropzone import-dropzone">
        <label class="button">
          Выбрать PDF
          <input class="visually-hidden" type="file" accept="application/pdf" data-import-file />
        </label>
        <span class="hint">PDF до 25 МБ. Сначала извлекаем text layer локально, OCR запускается только для сканов.</span>
      </div>
      <div class="import-progress" data-import-progress hidden>
        <div>
          <strong data-import-progress-label>Готовим документ...</strong>
          <span data-import-progress-page></span>
        </div>
        <progress max="100" value="0" data-import-progress-value></progress>
      </div>
      <p class="form-message" data-import-message></p>
    </div>
  `, "import-dialog import-start-dialog");
  const input = node.querySelector("[data-import-file]");
  const message = node.querySelector("[data-import-message]");
  const progressBox = node.querySelector("[data-import-progress]");
  const progressLabel = node.querySelector("[data-import-progress-label]");
  const progressPage = node.querySelector("[data-import-progress-page]");
  const progressValue = node.querySelector("[data-import-progress-value]");
  input.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      if (message) message.textContent = "Выберите PDF-документ.";
      return;
    }
    if (file.size > DOCUMENT_IMPORT_MAX_BYTES) {
      if (message) message.textContent = "PDF больше 25 МБ. Выберите документ меньшего размера.";
      return;
    }
    if (message) message.textContent = "";
    input.disabled = true;
    progressBox.hidden = false;
    try {
      const result = await window.MedNoteDocumentImport.analyzePdfFile(file, (progress) => {
        progressLabel.textContent = progress.label || "Обрабатываем документ";
        progressPage.textContent = progress.pageNumber ? `Страница ${progress.pageNumber} из ${progress.pageCount}` : "";
        progressValue.value = Math.max(0, Math.min(100, progress.percent || 0));
      });
      node.remove();
      renderImportReview({ file, ...result });
    } catch (error) {
      input.disabled = false;
      progressBox.hidden = true;
      if (message) message.textContent = error.message.includes("надёжно") ? "Не удалось надёжно распознать документ. Можно попробовать другой PDF или внести данные вручную." : error.message;
    }
  });
}

function filteredPatients() {
  const query = state.query.trim().toLowerCase();
  return state.patients
    .filter((patient) => patient.fullName.toLowerCase().includes(query))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
}

function renderPatientResults() {
  const query = state.query.trim();
  const patients = filteredPatients();
  const hint = document.querySelector("#searchHint");
  const results = document.querySelector("#patientResults");
  if (!hint || !results) return;
  hint.textContent = query ? (patients.length ? `Найдено: ${patients.length}` : "Совпадений нет") : "";
  results.innerHTML = patients.length
    ? `<section class="patient-directory" aria-label="Список пациентов">
        <div class="patient-directory-header" aria-hidden="true">
          <span>Пациент</span>
          <span>Возраст / дата рождения</span>
          <span>Последний приём</span>
          <span></span>
        </div>
        <div class="patient-directory-rows">${patients.map(renderPatientCard).join("")}</div>
      </section>`
    : `<section class="state-panel patient-empty-state"><h2>${query ? "Пациенты не найдены" : "Пациентов пока нет"}</h2><p>${query ? "Проверьте написание ФИО или добавьте нового пациента." : "Добавьте первого пациента, чтобы начать вести картотеку."}</p><button class="button" type="button" data-open-patient-form>+ Добавить пациента</button></section>`;
  bindPatientFormButtons(results);
}

function renderPatientCard(patient) {
  const visit = latestVisit(patient.id);
  const birth = patient.birthDate ? formatDate(patient.birthDate) : "дата рождения не указана";
  const age = patient.birthDate ? `${calculateAge(patient.birthDate)} лет` : "возраст не указан";
  const lastVisit = visit ? formatShortDate(visit.date) : "обращений нет";
  return `
    <a class="patient-card" href="#/patient/${patient.id}">
      <div class="patient-avatar" aria-hidden="true">${escapeHtml(initials(patient.fullName))}</div>
      <div class="patient-card-main">
        <div class="patient-name">${escapeHtml(patient.fullName)}</div>
        <div class="patient-meta mobile-only">${escapeHtml(age)} · ${escapeHtml(birth)}</div>
      </div>
      <div class="patient-meta patient-age">${escapeHtml(age)} · ${escapeHtml(birth)}</div>
      <div class="patient-last">Последний приём: ${escapeHtml(lastVisit)}</div>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  `;
}

async function loadMedicalTemplates() {
  state.medicalTemplates = await repository.listMedicalTemplates();
}

function filteredMedicalTemplates() {
  const query = state.templateQuery.trim().toLowerCase();
  return state.medicalTemplates
    .filter((template) => template.title.toLowerCase().includes(query))
    .sort((a, b) => `${b.updatedAt || ""}`.localeCompare(`${a.updatedAt || ""}`) || a.title.localeCompare(b.title, "ru"));
}

async function renderTemplatesPage() {
  app.innerHTML = `
    <section class="page-head templates-head">
      <div>
        <h1>Шаблоны</h1>
        <p class="eyebrow">Заготовки для повторяющихся сценариев приёма</p>
      </div>
      <div class="page-actions">
        <button class="button" type="button" data-open-template-form>+ Новый шаблон</button>
      </div>
    </section>
    <section class="toolbar template-toolbar" aria-label="Поиск шаблонов">
      <div class="field search-field">
        <label for="templateSearch">Найти шаблон</label>
        <input id="templateSearch" type="search" value="${escapeHtml(state.templateQuery)}" placeholder="Найти шаблон" autocomplete="off" />
        <span class="hint" id="templateSearchHint"></span>
      </div>
    </section>
    <div id="templateResults">
      <section class="state-panel"><div class="spinner" aria-hidden="true"></div><p>Загружаем шаблоны...</p></section>
    </div>
  `;
  try {
    await loadMedicalTemplates();
    renderTemplateResults();
  } catch (error) {
    document.querySelector("#templateResults").innerHTML = `
      <section class="state-panel">
        <h2>Не удалось загрузить шаблоны</h2>
        <p>${escapeHtml(repositoryMessage(error, "Проверьте соединение и попробуйте ещё раз."))}</p>
        <button class="button" type="button" data-retry-templates>Повторить</button>
      </section>
    `;
    document.querySelector("[data-retry-templates]")?.addEventListener("click", () => renderTemplatesPage());
  }
  document.querySelector("#templateSearch")?.addEventListener("input", (event) => {
    state.templateQuery = event.target.value;
    renderTemplateResults();
  });
}

function renderTemplateResults() {
  const query = state.templateQuery.trim();
  const templates = filteredMedicalTemplates();
  const hint = document.querySelector("#templateSearchHint");
  const results = document.querySelector("#templateResults");
  if (!hint || !results) return;
  hint.textContent = query ? (templates.length ? `Найдено: ${templates.length}` : "Совпадений нет") : "";
  if (!state.medicalTemplates.length && !query) {
    results.innerHTML = `
      <section class="state-panel template-empty-state">
        <h2>Шаблонов пока нет</h2>
        <p>Создайте заготовку для повторяющегося сценария приёма.</p>
        <button class="button" type="button" data-open-template-form>+ Новый шаблон</button>
      </section>
    `;
  } else if (templates.length) {
    results.innerHTML = `
      <section class="template-directory" aria-label="Список шаблонов">
        <div class="template-directory-header" aria-hidden="true">
          <span>Название</span>
          <span>Когда использовать</span>
          <span>Обновлён</span>
          <span></span>
        </div>
        <div class="template-directory-rows">${templates.map(renderTemplateRow).join("")}</div>
      </section>
    `;
  } else {
    results.innerHTML = `
      <section class="state-panel template-empty-state">
        <h2>Шаблоны не найдены</h2>
        <p>Проверьте название или создайте новый шаблон.</p>
        <button class="button" type="button" data-open-template-form>+ Новый шаблон</button>
      </section>
    `;
  }
  bindTemplateActions(results);
}

function renderTemplateRow(template) {
  const indication = template.indication ? template.indication : "—";
  const updated = template.updatedAt ? formatDate(template.updatedAt.slice(0, 10)) : "Не указано";
  return `
    <div class="template-row" role="button" tabindex="0" data-edit-template="${template.id}">
      <div class="template-title-cell">
        <strong>${escapeHtml(template.title)}</strong>
        <span class="mobile-only">${escapeHtml(indication)}</span>
      </div>
      <div class="template-indication">${escapeHtml(indication)}</div>
      <div class="template-updated">${escapeHtml(updated)}</div>
      <details class="patient-action-menu template-row-menu" data-template-menu>
        <summary aria-label="Действия шаблона"><span aria-hidden="true">...</span></summary>
        <div class="patient-action-menu-popover template-action-popover">
          <button type="button" data-menu-edit-template="${template.id}">Редактировать</button>
          <button class="danger-menu-button" type="button" data-confirm-delete-template="${template.id}">Удалить шаблон</button>
        </div>
      </details>
    </div>
  `;
}

function bindTemplateActions(root = document) {
  root.querySelectorAll("[data-open-template-form]").forEach((button) => {
    if (button.dataset.templateBound === "true") return;
    button.dataset.templateBound = "true";
    button.addEventListener("click", () => templateForm());
  });
  root.querySelectorAll("[data-edit-template]").forEach((row) => {
    if (row.dataset.templateBound === "true") return;
    row.dataset.templateBound = "true";
    row.addEventListener("click", (event) => {
      if (event.target.closest("[data-template-menu]")) return;
      const template = state.medicalTemplates.find((item) => item.id === row.dataset.editTemplate);
      templateForm(template);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (event.target.closest("[data-template-menu]")) return;
      event.preventDefault();
      const template = state.medicalTemplates.find((item) => item.id === row.dataset.editTemplate);
      templateForm(template);
    });
  });
  root.querySelectorAll("[data-confirm-delete-template]").forEach((button) => {
    if (button.dataset.templateBound === "true") return;
    button.dataset.templateBound = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const template = state.medicalTemplates.find((item) => item.id === button.dataset.confirmDeleteTemplate);
      templateDeleteConfirmation(template);
    });
  });
  root.querySelectorAll("[data-menu-edit-template]").forEach((button) => {
    if (button.dataset.templateBound === "true") return;
    button.dataset.templateBound = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const template = state.medicalTemplates.find((item) => item.id === button.dataset.menuEditTemplate);
      templateForm(template);
    });
  });
}

function renderContactLine(patient) {
  const contacts = [];
  if (patient.phone) contacts.push(`<span class="contact-item"><span aria-hidden="true">☎</span>${escapeHtml(patient.phone)}</span>`);
  if (patient.email) contacts.push(`<span class="contact-item"><span aria-hidden="true">@</span>${escapeHtml(patient.email)}</span>`);
  return contacts.length ? `<div class="contact-line">${contacts.join("")}</div>` : "";
}

function renderMetricStrip(patient) {
  const weight = latestWeight(patient);
  const bmi = bmiValue(patient.heightCm, weight?.valueKg);
  const weightHistory = [...(patient.weightHistory || [])].sort((a, b) => `${b.measuredAt || ""}`.localeCompare(`${a.measuredAt || ""}`));
  const weightMeta = weight
    ? `<button class="metric-meta metric-history-trigger" type="button" data-weight-history="${patient.id}">${formatDate(weight.measuredAt)}${weightHistory.length > 1 ? ` · История ${weightHistory.length}` : ""}</button>`
    : "";
  const metrics = [
    patient.heightCm ? `<div class="metric-item"><span>Рост</span><strong>${escapeHtml(String(patient.heightCm))} см</strong></div>` : "",
    weight ? `<div class="metric-item"><span>Вес</span><strong>${escapeHtml(String(weight.valueKg))} кг</strong>${weightMeta}</div>` : "",
    bmi ? `<div class="metric-item"><span>ИМТ</span><strong>${bmi}</strong></div>` : ""
  ].filter(Boolean);
  if (!metrics.length) return "";
  return `<div class="metric-strip">${metrics.join("")}</div>`;
}

function renderImportant(patient) {
  const groups = [
    { label: "Аллергии", value: patient.medicalContext.allergies, kind: "entities", role: "allergy" },
    { label: "Состояния", value: patient.medicalContext.conditions, kind: "text", role: "condition" },
    { label: "Постоянная терапия", value: patient.medicalContext.therapy, kind: "text", role: "therapy" },
    { label: "Особенности", value: patient.medicalContext.notes, kind: "text", role: "notes" }
  ].filter(({ value }) => value && value.trim());
  if (!groups.length) return "";
  return `
    <section class="profile-section important-section">
      <h2>Важное</h2>
      <div class="important-summary">
        ${groups
          .map(
            ({ label, value, kind, role }) => `
              <div class="important-group important-${role}">
                <span class="important-label">${role === "allergy" ? `<span class="important-icon" aria-hidden="true">•</span>` : ""}${label}</span>
                ${
                  kind === "entities"
                    ? `<div class="important-entities">${splitItems(value).map((item) => `<span class="important-entity">${escapeHtml(item)}</span>`).join("")}</div>`
                    : `<p class="important-text">${escapeHtml(value)}</p>`
                }
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderAbout(patient) {
  if (!patient.about?.trim()) return "";
  return `
    <section class="profile-section about-note">
      <h2>О пациенте</h2>
      <p>${escapeHtml(patient.about)}</p>
    </section>
  `;
}

function parseVisitNoteSections(note = "") {
  const labels = new Map([
    ["анамнез", ["anamnesis", "Что происходит / анамнез"]],
    ["объективно", ["objective", "Объективно"]],
    ["обследования", ["investigations", "Обследования"]],
    ["диагноз", ["diagnosis", "Диагноз"]],
    ["решение", ["decision", "Решение / лечение"]],
    ["дальше", ["next", "Дальше"]]
  ]);
  const sections = [];
  let current = null;
  let hasMarker = false;
  note.split(/\n/).forEach((line) => {
    const trimmed = line.trim();
    const marker = trimmed.match(/^([А-Яа-яЁё ]+):$/);
    const match = marker ? labels.get(marker[1].trim().toLowerCase()) : null;
    if (match) {
      hasMarker = true;
      current = { key: match[0], label: match[1], lines: [] };
      sections.push(current);
      return;
    }
    if (!current) {
      current = { key: "raw", label: "Что происходит", lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  });
  return hasMarker ? sections.filter((section) => section.lines.some((line) => line.trim())) : [];
}

function renderRawVisitNote(visit) {
  return `
    <section class="visit-clinical-section">
      <h4>Что происходит</h4>
      <p>${escapeHtml(visit.note || "Осмотр не заполнен")}</p>
    </section>
  `;
}

function renderDecisionContent(decision) {
  if (!decision?.trim()) return "";
  const icdMatch = decision.match(/\b([A-ZА-Я]\d{2}(?:\.\d+)?)\b/i);
  return `
    <div class="visit-diagnosis-line">
      ${icdMatch ? `<span class="icd-chip">${escapeHtml(icdMatch[1])}</span>` : ""}
      <p>${escapeHtml(decision)}</p>
    </div>
  `;
}

function hasVisitNoteMarker(note = "", markers = []) {
  const normalized = new Set(markers.map((marker) => marker.toLowerCase()));
  return note.split(/\n/).some((line) => {
    const match = line.trim().match(/^([А-Яа-яЁё ]+):$/);
    return match ? normalized.has(match[1].trim().toLowerCase()) : false;
  });
}

function renderVisitSections(visit) {
  const sections = parseVisitNoteSections(visit.note || "");
  if (!sections.length) return renderRawVisitNote(visit);
  return sections
    .map((section) => {
      const text = section.lines.join("\n").trim();
      if (!text) return "";
      if (section.key === "investigations") {
        return `<section class="visit-clinical-section"><h4>${section.label}</h4>${renderInvestigationLines(section.lines)}</section>`;
      }
      return `<section class="visit-clinical-section"><h4>${section.label}</h4><p>${escapeHtml(text)}</p></section>`;
    })
    .join("");
}

function renderInvestigationLines(lines) {
  const rows = lines
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      const name = separator > 0 ? line.slice(0, separator).trim() : line;
      const value = separator > 0 ? line.slice(separator + 1).trim() : "";
      return `
        <div class="visit-investigation-row">
          <span>${escapeHtml(name)}</span>
          <strong>${escapeHtml(value || "см. описание")}</strong>
        </div>
      `;
    });
  return rows.length ? `<div class="visit-investigation-list">${rows.join("")}</div>` : "";
}
function renderPatientPage(patientId) {
  const foundPatient = state.patients.find((item) => item.id === patientId);
  if (!foundPatient) {
    app.innerHTML = `<section class="state-panel"><h2>Пациент не найден</h2><a class="button" href="#/">Вернуться к картотеке</a></section>`;
    return;
  }
  const patient = normalizePatient(foundPatient);
  const visits = state.visits.filter((visit) => visit.patientId === patientId && visit.status !== "draft").sort(compareVisitsDesc);
  const draft = state.visits.find((visit) => visit.patientId === patientId && visit.status === "draft");
  const latest = visits[0];
  const nextStep = latest?.nextStep ? `${latest.nextStep}${latest.nextStepTiming ? ` · ${latest.nextStepTiming}` : ""}` : "";
  app.innerHTML = `
    <section class="page-head patient-card-head">
      <div>
        <p class="eyebrow"><a href="#/">Пациенты</a> / карточка пациента</p>
        <h1>Карточка пациента</h1>
        <p>${calculateAge(patient.birthDate)} лет · ${formatDate(patient.birthDate)}${patient.sex ? ` · ${sexLabel(patient.sex)}` : ""}</p>
      </div>
      <button class="button" type="button" data-start-encounter="${patient.id}">${draft ? "Продолжить обращение" : "Новое обращение"}</button>
    </section>
    <section class="patient-hero">
      <div class="patient-identity">
        <div class="patient-avatar" aria-hidden="true">${escapeHtml(initials(patient.fullName))}</div>
        <div>
          <p class="patient-meta">${calculateAge(patient.birthDate)} лет · ${formatDate(patient.birthDate)}${patient.sex ? ` · ${sexLabel(patient.sex)}` : ""}</p>
          <h2>${escapeHtml(patient.fullName)}</h2>
          <p class="patient-last">Последний приём: ${latest ? formatShortDate(latest.date) : "обращений нет"}</p>
          ${renderContactLine(patient)}
        </div>
      </div>
      <div class="patient-actions">
        <button class="ghost-button" type="button" data-open-patient-form="${patient.id}">Редактировать данные</button>
        <details class="patient-action-menu">
          <summary aria-label="Действия пациента">…</summary>
          <div class="patient-action-menu-popover">
            <button class="danger-menu-button" type="button" data-confirm-delete-patient="${patient.id}">Удалить пациента</button>
          </div>
        </details>
      </div>
    </section>
    <section class="patient-layout patient-card-layout">
      <aside class="profile-read" aria-label="Профиль пациента">
        ${renderMetricStrip(patient)}
        ${renderImportant(patient)}
        ${nextStep ? `<section class="profile-section next-step-card"><h2>Дальше</h2><p>${escapeHtml(nextStep)}</p></section>` : ""}
        ${renderAbout(patient)}
      </aside>
      <section class="history">
        <div class="section-head">
          <h2>История обращений</h2>
          <p class="caption">${visits.length ? `${visits.length} записей` : "История пуста"}</p>
        </div>
        ${
          visits.length
            ? visits.map(renderVisitCard).join("")
            : `<section class="state-panel"><h2>У пациента пока нет обращений</h2><p>Добавьте первое обращение, чтобы зафиксировать осмотр и вложения.</p><button class="button" type="button" data-start-encounter="${patient.id}">Добавить первое обращение</button></section>`
        }
      </section>
    </section>
  `;
}

function renderVisitCard(visit) {
  const attachments = state.attachments.filter((item) => item.visitId === visit.id);
  const nextStep = visit.nextStep ? `${visit.nextStep}${visit.nextStepTiming ? ` · ${visit.nextStepTiming}` : ""}` : "";
  return `
    <article class="visit-card">
      <div class="visit-head">
        <div>
          <h3>${formatDate(visit.date)}</h3>
          <p class="eyebrow">Создано ${new Date(visit.createdAt).toLocaleDateString("ru-RU")}</p>
        </div>
        <div class="visit-badges">
          <span class="badge">${visitFormatLabel(visit.format)}</span>
          ${visit.status ? `<span class="badge muted">${visit.status === "completed" ? "Завершено" : escapeHtml(visit.status)}</span>` : ""}
        </div>
      </div>
      <div class="visit-clinical-grid">
        ${renderVisitSections(visit)}
        ${visit.decision && !hasVisitNoteMarker(visit.note, ["Диагноз", "Решение"]) ? `<section class="visit-clinical-section"><h4>Решение / лечение</h4>${renderDecisionContent(visit.decision)}</section>` : ""}
        ${nextStep && !hasVisitNoteMarker(visit.note, ["Дальше"]) ? `<section class="visit-clinical-section visit-next"><h4>Дальше</h4><p>${escapeHtml(nextStep)}</p></section>` : ""}
        <section class="visit-clinical-section visit-attachments">
          <h4>Вложения</h4>
          <div class="attachments">
            ${attachments.length ? attachments.map((item) => renderAttachment(item, true)).join("") : `<p class="eyebrow">Вложений нет</p>`}
          </div>
        </section>
      </div>
      <div class="action-row">
        <button class="ghost-button" type="button" data-edit-visit="${visit.id}">Редактировать обращение</button>
        <label class="ghost-button">
          Добавить документ
          <input class="visually-hidden" type="file" data-add-file="${visit.id}" accept="image/*,application/pdf" capture="environment" />
        </label>
      </div>
    </article>
  `;
}

function renderEncounterWorkspace(patientId, visitId) {
  const patient = normalizePatient(state.patients.find((item) => item.id === patientId) || {});
  const visit = normalizeVisit(state.visits.find((item) => item.id === visitId) || {});
  if (!patient.id || !visit.id) {
    app.innerHTML = `<section class="state-panel"><h2>Черновик не найден</h2><a class="button" href="#/patient/${patientId}">Вернуться к пациенту</a></section>`;
    return;
  }
  const completedVisits = state.visits
    .filter((item) => item.patientId === patientId && item.status !== "draft" && item.id !== visitId)
    .sort(compareVisitsDesc);
  const lastVisit = completedVisits[0];
  const attachments = state.attachments.filter((item) => item.visitId === visit.id);
  const importantSummary = renderImportant(patient);
  const allergiesSummary = patient.medicalContext.allergies ? escapeHtml(patient.medicalContext.allergies) : "Не указано";
  const lastVisitPreview = shortTextPreview(lastVisit?.note || lastVisit?.decision || "", 220);
  const draftLabel = visit.status === "draft" ? "Черновик обращения" : visit.status === "completed" ? "Завершённое обращение" : escapeHtml(visit.status);
  app.innerHTML = `
    <section class="encounter-workspace">
      <header class="encounter-header">
        <div>
          <p class="eyebrow encounter-back"><a href="#/patient/${patient.id}">← Карточка пациента</a></p>
          <h1>${escapeHtml(patient.fullName)}</h1>
          <p class="patient-meta">${calculateAge(patient.birthDate)} лет · ${formatDate(patient.birthDate)} · ${draftLabel}</p>
        </div>
      </header>
      <section class="encounter-patient-context" aria-label="Контекст пациента">
        <div>
          <span>Приём</span>
          <strong>${formatDate(visit.date)}</strong>
          <small>начато ${new Date(visit.startedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</small>
        </div>
        <div>
          <span>Важное</span>
          <strong>${allergiesSummary}</strong>
          <small>${patient.medicalContext.conditions ? escapeHtml(patient.medicalContext.conditions) : "состояния не указаны"}</small>
        </div>
        <div>
          <span>Последний контекст</span>
          <strong>${lastVisit ? `${formatDate(lastVisit.date)} · ${visitFormatLabel(lastVisit.format)}` : "Нет завершённых обращений"}</strong>
          <small>${lastVisit?.nextStep ? escapeHtml(lastVisit.nextStep) : "следующий шаг не указан"}</small>
        </div>
      </section>
      <section class="encounter-layout">
        <section class="encounter-main" aria-label="Текущее обращение">
          <section class="encounter-section encounter-format-section">
            <div>
              <h2>Формат</h2>
              <p>Как проходит текущий контакт</p>
            </div>
            <div class="segmented" role="radiogroup" aria-label="Тип контакта">
              ${["clinic", "online", "phone"].map((format) => `<label><input type="radio" name="encounterFormat" value="${format}" ${visit.format === format ? "checked" : ""}> <span><span class="desktop-label">${visitFormatLabel(format)}</span><span class="mobile-label">${format === "phone" ? "Телефон" : visitFormatLabel(format)}</span></span></label>`).join("")}
            </div>
          </section>
          <section class="encounter-section encounter-note-section">
            <div class="field full">
              <label for="encounterNote">Что происходит</label>
              <textarea id="encounterNote" data-encounter-field="note" placeholder="Жалобы, изменения, результаты, наблюдения">${escapeHtml(visit.note)}</textarea>
              <span class="hint"></span>
            </div>
          </section>
          <section class="encounter-section encounter-decision-section">
            <div class="field full">
              <label for="encounterDecision">Решение / лечение</label>
              <textarea id="encounterDecision" data-encounter-field="decision" placeholder="Что решили / что сделал врач">${escapeHtml(visit.decision)}</textarea>
              <span class="hint"></span>
            </div>
          </section>
          <section class="encounter-section encounter-next-section">
            <div>
              <h2>Дальше</h2>
              <p>Что должно произойти после приёма</p>
            </div>
            <div class="next-step-fields full">
              <div class="field">
                <label for="encounterNextStep">Дальше</label>
                <input id="encounterNextStep" data-encounter-field="nextStep" value="${escapeHtml(visit.nextStep)}" placeholder="Например: контроль ТТГ" />
                <span class="hint">Действие, контроль или повторный контакт</span>
              </div>
              <div class="field">
                <label for="encounterNextTiming">Ориентир</label>
                <input id="encounterNextTiming" data-encounter-field="nextStepTiming" value="${escapeHtml(visit.nextStepTiming)}" placeholder="через 3 месяца, после результатов" />
                <span class="hint">Дата, срок или условие</span>
              </div>
            </div>
          </section>
          <section class="encounter-section encounter-documents">
            <div class="section-head">
              <h2>Документы</h2>
              <label class="ghost-button">
                + Фото / документ
                <input class="visually-hidden" type="file" data-encounter-add-file="${visit.id}" accept="image/*,application/pdf" multiple capture="environment" />
              </label>
            </div>
            <div class="attachments" data-encounter-attachments>
              ${attachments.length ? attachments.map((item) => renderAttachment(item, true)).join("") : `<p class="eyebrow">Документы пока не добавлены</p>`}
            </div>
          </section>
          <div class="encounter-footer-actions">
            <span class="save-state" data-save-state-mirror>Черновик сохранён</span>
            <button class="button" type="button" data-complete-encounter="${visit.id}">Завершить обращение</button>
          </div>
          <div class="mobile-complete-flow">
            <button class="button" type="button" data-complete-encounter="${visit.id}">Завершить обращение</button>
          </div>
        </section>
        <aside class="encounter-context">
          <details>
            <summary>Контекст пациента</summary>
            ${importantSummary || `<p class="eyebrow">Важный контекст не заполнен</p>`}
            ${
              lastVisit?.nextStep
                ? `<section class="context-block context-next-block"><h2>На чём остановились</h2><p>${escapeHtml(lastVisit.nextStep)}${lastVisit.nextStepTiming ? ` · ${escapeHtml(lastVisit.nextStepTiming)}` : ""}</p></section>`
                : ""
            }
            <section class="context-block">
              <h2>Последний контакт</h2>
              ${
                lastVisit
                  ? `<p><strong>${formatDate(lastVisit.date)} · ${visitFormatLabel(lastVisit.format)}</strong></p>${lastVisitPreview ? `<p class="context-preview">${escapeHtml(lastVisitPreview)}</p>` : `<p class="eyebrow">Краткая заметка не заполнена</p>`}`
                  : `<p class="eyebrow">Завершённых обращений пока нет</p>`
              }
            </section>
            ${patient.about ? `<section class="context-block"><h2>О пациенте</h2><p>${escapeHtml(patient.about)}</p></section>` : ""}
            <a class="text-button compact-action" href="#/patient/${patient.id}">История пациента →</a>
          </details>
        </aside>
      </section>
    </section>
  `;
  bindEncounterWorkspace(patient.id, visit.id);
}

function modal(content, dialogClass = "") {
  const node = document.createElement("div");
  node.className = "modal open";
  const className = ["dialog", dialogClass].filter(Boolean).join(" ");
  node.innerHTML = `<div class="${className}" role="dialog" aria-modal="true">${content}</div>`;
  document.body.append(node);
  node.addEventListener("click", (event) => {
    if (node.dataset.modalBusy === "true") return;
    if (event.target === node || event.target.matches("[data-close]")) node.remove();
  });
  node.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || node.dataset.modalBusy === "true") return;
    node.remove();
  });
  const first = node.querySelector("input, textarea, select, button");
  if (first) first.focus();
  return node;
}

function showToast(message) {
  document.querySelectorAll(".toast").forEach((item) => item.remove());
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = `✓ ${message}`;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 1800);
}

function repositoryMessage(error, fallback = "Операция временно недоступна. Попробуйте ещё раз.") {
  if (!(error instanceof RepositoryError)) return fallback;
  const messages = {
    [REPOSITORY_ERROR_TYPES.AUTH]: "Сессия истекла. Войдите снова.",
    [REPOSITORY_ERROR_TYPES.NETWORK]: "Не удалось связаться с MedNote Cloud. Проверьте соединение.",
    [REPOSITORY_ERROR_TYPES.PERMISSION]: "Нет доступа к этим данным.",
    [REPOSITORY_ERROR_TYPES.CONFLICT]: "Данные изменились в другом окне. Обновите страницу перед продолжением.",
    [REPOSITORY_ERROR_TYPES.UNKNOWN]: fallback
  };
  return messages[error.type] || fallback;
}

function patientDeleteConfirmation(patient) {
  if (!patient) return;
  const node = modal(`
    <div class="dialog-head compact-dialog-head">
      <div>
        <p class="eyebrow">Необратимое действие</p>
        <h2>Удалить пациента?</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Закрыть" data-close>×</button>
    </div>
    <div class="dialog-body delete-dialog-body">
      <h3>${escapeHtml(patient.fullName)}</h3>
      <p>Будут удалены:</p>
      <ul>
        <li>карточка пациента;</li>
        <li>история обращений;</li>
        <li>данные веса;</li>
        <li>вложения и связанные файлы.</li>
      </ul>
      <p class="danger-note">Это действие нельзя отменить.</p>
      <p class="form-error" data-delete-error hidden></p>
    </div>
    <div class="dialog-actions">
      <button class="ghost-button" type="button" data-close>Отмена</button>
      <button class="button danger-button" type="button" data-delete-patient="${patient.id}">Удалить пациента</button>
    </div>
  `, "delete-dialog");
  const deleteButton = node.querySelector("[data-delete-patient]");
  const errorNode = node.querySelector("[data-delete-error]");
  deleteButton.addEventListener("click", async () => {
    if (deleteButton.disabled) return;
    deleteButton.disabled = true;
    node.dataset.modalBusy = "true";
    deleteButton.textContent = "Удаление...";
    errorNode.hidden = true;
    try {
      await repository.deletePatient(patient.id);
      node.remove();
      showToast("Пациент удалён");
      await route("#/");
    } catch (error) {
      delete node.dataset.modalBusy;
      deleteButton.disabled = false;
      deleteButton.textContent = "Удалить пациента";
      errorNode.textContent = repositoryMessage(error, "Не удалось удалить пациента. Проверьте связанные файлы и попробуйте ещё раз.");
      errorNode.hidden = false;
    }
  });
}

function templateForm(template = null) {
  const isEdit = Boolean(template);
  template = template ? normalizeMedicalTemplate(template) : normalizeMedicalTemplate({});
  const node = modal(`
    <form class="template-dialog-form">
      <div class="dialog-head">
        <div>
          <p class="eyebrow">${isEdit ? "Редактирование шаблона" : "Новый шаблон"}</p>
          <h2>${isEdit ? "Редактировать шаблон" : "Новый шаблон"}</h2>
        </div>
        <button class="icon-button" type="button" data-close aria-label="Закрыть">×</button>
      </div>
      <div class="dialog-body edit-form">
        <section class="form-section">
          <h3>Основное</h3>
          <div class="form-grid">
            <div class="field">
              <label for="templateTitle">Название</label>
              <input id="templateTitle" name="title" required value="${escapeHtml(template.title)}" />
              <span class="error" data-error="title"></span>
            </div>
            <div class="field">
              <label for="templateIndication">Когда использовать</label>
              <input id="templateIndication" name="indication" value="${escapeHtml(template.indication)}" />
              <span class="hint">Не добавляйте персональные данные пациента в шаблон.</span>
            </div>
          </div>
        </section>
        <section class="form-section">
          <h3>Содержимое шаблона</h3>
          <div class="form-grid template-content-grid">
            <div class="field">
              <label for="templateNote">Что происходит</label>
              <textarea id="templateNote" name="note">${escapeHtml(template.note)}</textarea>
            </div>
            <div class="field">
              <label for="templateDecision">Решение / лечение</label>
              <textarea id="templateDecision" name="decision">${escapeHtml(template.decision)}</textarea>
            </div>
            <div class="field">
              <label for="templateNextStep">Дальше</label>
              <input id="templateNextStep" name="nextStep" value="${escapeHtml(template.nextStep)}" />
            </div>
            <div class="field">
              <label for="templateNextTiming">Когда</label>
              <input id="templateNextTiming" name="nextStepTiming" value="${escapeHtml(template.nextStepTiming)}" />
            </div>
          </div>
        </section>
      </div>
      <div class="dialog-actions">
        <button class="ghost-button" type="button" data-close>Отмена</button>
        <button class="button" type="submit">Сохранить шаблон</button>
      </div>
    </form>
  `, "template-dialog");
  node.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formNode = event.currentTarget;
    const submit = formNode.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    const form = new FormData(formNode);
    const input = {
      title: String(form.get("title") || "").trim(),
      indication: String(form.get("indication") || "").trim(),
      note: String(form.get("note") || "").trim(),
      decision: String(form.get("decision") || "").trim(),
      nextStep: String(form.get("nextStep") || "").trim(),
      nextStepTiming: String(form.get("nextStepTiming") || "").trim()
    };
    node.querySelectorAll(".error").forEach((item) => (item.textContent = ""));
    if (!input.title) return (node.querySelector('[data-error="title"]').textContent = "Введите название шаблона");
    if (submit) {
      submit.disabled = true;
      submit.textContent = "Сохраняем...";
    }
    try {
      const saved = isEdit
        ? await repository.updateMedicalTemplate(template.id, input)
        : await repository.createMedicalTemplate(input);
      node.remove();
      await loadMedicalTemplates();
      renderTemplateResults();
      showToast(isEdit ? "Шаблон сохранён" : "Шаблон создан");
      return saved;
    } catch (error) {
      if (submit) {
        submit.disabled = false;
        submit.textContent = "Сохранить шаблон";
      }
      const target = node.querySelector('[data-error="title"]');
      if (target) target.textContent = repositoryMessage(error, "Не удалось сохранить шаблон. Попробуйте ещё раз.");
    }
  });
}

function templateDeleteConfirmation(template) {
  if (!template) return;
  const node = modal(`
    <div class="dialog-head compact-dialog-head">
      <div>
        <p class="eyebrow">Архивация шаблона</p>
        <h2>Удалить шаблон?</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Закрыть" data-close>×</button>
    </div>
    <div class="dialog-body delete-dialog-body">
      <h3>${escapeHtml(template.title)}</h3>
      <p>Шаблон исчезнет из рабочего списка. Это не изменит уже существующие обращения.</p>
      <p class="form-error" data-template-delete-error hidden></p>
    </div>
    <div class="dialog-actions">
      <button class="ghost-button" type="button" data-close>Отмена</button>
      <button class="button danger-button" type="button" data-delete-template="${template.id}">Удалить</button>
    </div>
  `, "delete-dialog");
  const deleteButton = node.querySelector("[data-delete-template]");
  const errorNode = node.querySelector("[data-template-delete-error]");
  deleteButton.addEventListener("click", async () => {
    if (deleteButton.disabled) return;
    deleteButton.disabled = true;
    node.dataset.modalBusy = "true";
    deleteButton.textContent = "Удаляем...";
    errorNode.hidden = true;
    try {
      await repository.archiveMedicalTemplate(template.id);
      node.remove();
      await loadMedicalTemplates();
      renderTemplateResults();
      showToast("Шаблон удалён");
    } catch (error) {
      delete node.dataset.modalBusy;
      deleteButton.disabled = false;
      deleteButton.textContent = "Удалить";
      errorNode.textContent = repositoryMessage(error, "Не удалось удалить шаблон. Попробуйте ещё раз.");
      errorNode.hidden = false;
    }
  });
}

function patientForm(patient = null) {
  const isEdit = Boolean(patient);
  patient = patient ? normalizePatient(patient) : normalizePatient({});
  const weight = latestWeight(patient);
  const node = modal(`
    <form class="patient-dialog-form">
      <div class="dialog-head">
        <h2>${isEdit ? "Редактировать пациента" : "Новый пациент"}</h2>
        <button class="icon-button" type="button" data-close aria-label="Закрыть">×</button>
      </div>
      <div class="dialog-body edit-form">
        <section class="form-section">
          <h3>Основное</h3>
          <div class="form-grid">
            <div class="field full">
              <label for="fullName">ФИО</label>
              <input id="fullName" name="fullName" required value="${escapeHtml(patient.fullName || "")}" />
              <span class="error" data-error="fullName"></span>
            </div>
            <div class="field">
              <label for="birthDate">Дата рождения</label>
              <input id="birthDate" name="birthDate" type="date" required value="${escapeHtml(patient.birthDate || "")}" />
              <span class="error" data-error="birthDate"></span>
            </div>
            <div class="field">
              <label for="sex">Пол</label>
              <select id="sex" name="sex">
                <option value="">Не указан</option>
                <option value="female" ${patient.sex === "female" ? "selected" : ""}>Женский</option>
                <option value="male" ${patient.sex === "male" ? "selected" : ""}>Мужской</option>
              </select>
              <span class="hint"></span>
            </div>
          </div>
        </section>
        <section class="form-section">
          <h3>Контакты</h3>
          <div class="form-grid">
            <div class="field">
              <label for="phone">Телефон <span class="hint">необязательно</span></label>
              <input id="phone" name="phone" type="tel" value="${escapeHtml(patient.phone || "")}" />
              <span class="hint"></span>
            </div>
            <div class="field">
              <label for="email">Email <span class="hint">необязательно</span></label>
              <input id="email" name="email" type="email" value="${escapeHtml(patient.email || "")}" />
              <span class="error" data-error="email"></span>
            </div>
          </div>
        </section>
        <section class="form-section">
          <h3>Параметры</h3>
          <div class="form-grid">
            <div class="field">
              <label for="heightCm">Рост, см</label>
              <input id="heightCm" name="heightCm" type="number" min="0" step="1" value="${escapeHtml(String(patient.heightCm || ""))}" />
              <span class="hint"></span>
            </div>
            <div class="field parameter-weight-field">
              <label for="currentWeightKg">Вес, кг</label>
              <input id="currentWeightKg" name="currentWeightKg" type="number" min="0" step="0.1" value="${escapeHtml(String(weight?.valueKg || ""))}" />
              <span class="hint"></span>
            </div>
            <div class="field">
              <label for="weightMeasuredAt">Дата измерения</label>
              <input id="weightMeasuredAt" name="weightMeasuredAt" type="date" value="${escapeHtml(weight?.measuredAt || todayISO())}" />
              <span class="hint"></span>
            </div>
          </div>
        </section>
        <section class="form-section">
          <h3>Медицинский контекст</h3>
          <div class="form-grid">
            <div class="field">
              <label for="allergies">Аллергии</label>
              <textarea id="allergies" name="allergies">${escapeHtml(patient.medicalContext.allergies)}</textarea>
              <span class="hint"></span>
            </div>
            <div class="field">
              <label for="conditions">Важные заболевания / состояния</label>
              <textarea id="conditions" name="conditions">${escapeHtml(patient.medicalContext.conditions)}</textarea>
              <span class="hint"></span>
            </div>
            <div class="field">
              <label for="therapy">Постоянная терапия</label>
              <textarea id="therapy" name="therapy">${escapeHtml(patient.medicalContext.therapy)}</textarea>
              <span class="hint"></span>
            </div>
            <div class="field">
              <label for="contextNotes">Другие важные особенности</label>
              <textarea id="contextNotes" name="contextNotes">${escapeHtml(patient.medicalContext.notes)}</textarea>
              <span class="hint"></span>
            </div>
          </div>
        </section>
        <section class="form-section">
          <h3>О пациенте</h3>
          <div class="field">
            <label for="about">Короткая человеческая заметка врача</label>
            <textarea id="about" name="about">${escapeHtml(patient.about || "")}</textarea>
            <span class="hint"></span>
          </div>
        </section>
      </div>
      <div class="dialog-actions">
        <button class="ghost-button" type="button" data-close>Отмена</button>
        <button class="button" type="submit">${isEdit ? "Сохранить" : "Добавить"}</button>
      </div>
    </form>
  `, "patient-dialog");
  node.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    const form = new FormData(event.currentTarget);
    const input = {
      fullName: String(form.get("fullName")).trim(),
      birthDate: String(form.get("birthDate")),
      sex: String(form.get("sex")),
      phone: String(form.get("phone")).trim(),
      email: String(form.get("email")).trim(),
      heightCm: String(form.get("heightCm")).trim(),
      currentWeightKg: String(form.get("currentWeightKg")).trim(),
      weightMeasuredAt: String(form.get("weightMeasuredAt")).trim(),
      medicalContext: {
        allergies: String(form.get("allergies")).trim(),
        conditions: String(form.get("conditions")).trim(),
        therapy: String(form.get("therapy")).trim(),
        notes: String(form.get("contextNotes")).trim()
      },
      about: String(form.get("about")).trim()
    };
    node.querySelectorAll(".error").forEach((item) => (item.textContent = ""));
    if (!input.fullName) return (node.querySelector('[data-error="fullName"]').textContent = "Введите ФИО");
    if (!input.birthDate) return (node.querySelector('[data-error="birthDate"]').textContent = "Укажите дату рождения");
    if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      return (node.querySelector('[data-error="email"]').textContent = "Проверьте email");
    }
    if (submit) submit.disabled = true;
    try {
      const saved = isEdit ? await repository.updatePatient(patient.id, input) : await repository.createPatient(input);
      node.remove();
      showToast("Сохранено");
      await route(`#/patient/${saved.id}`);
    } catch (error) {
      if (submit) submit.disabled = false;
      const target = node.querySelector('[data-error="fullName"]');
      if (target) target.textContent = repositoryMessage(error, "Не удалось сохранить пациента. Попробуйте ещё раз.");
    }
  });
}

async function readFiles(fileList) {
  return Array.from(fileList).map((file) => ({
    kind: file.type.includes("pdf") ? "pdf" : "analysis-photo",
    name: file.name,
    mime: file.type || "application/octet-stream",
    file,
    size: file.size
  }));
}

function visitForm(patientId, visit = null) {
  const files = [];
  const isEdit = Boolean(visit);
  const node = modal(`
    <form>
      <div class="dialog-head">
        <h2>${isEdit ? "Редактировать обращение" : "Новое обращение"}</h2>
        <button class="icon-button" type="button" data-close aria-label="Закрыть">×</button>
      </div>
      <div class="dialog-body form-grid">
        <div class="field">
          <label for="visitDate">Дата обращения</label>
          <input id="visitDate" name="date" type="date" required value="${escapeHtml(visit?.date || todayISO())}" />
          <span class="error" data-error="date"></span>
        </div>
        <div class="field">
          <label for="format">Формат консультации</label>
          <select id="format" name="format">
            <option value="clinic" ${visit?.format === "clinic" ? "selected" : ""}>В клинике</option>
            <option value="online" ${visit?.format === "online" ? "selected" : ""}>Онлайн</option>
          </select>
          <span class="hint">Формат относится только к этому обращению</span>
        </div>
        <div class="field full">
          <label for="note">Осмотр / заметка</label>
          <textarea id="note" name="note" placeholder="Запишите осмотр, жалобы, динамику и договоренности">${escapeHtml(visit?.note || "")}</textarea>
          <span class="error" data-error="note"></span>
        </div>
        ${
          isEdit
            ? ""
            : `<div class="field full">
                <span class="label">Вложения</span>
                <div class="dropzone">
                  <label class="ghost-button">
                    Сканировать / сфотографировать документ
                    <input class="visually-hidden" type="file" name="files" accept="image/*,application/pdf" multiple capture="environment" />
                  </label>
                  <span class="hint">Поддерживаются изображения, фото анализов и PDF. Перед сохранением файлы появятся ниже.</span>
                  <div class="attachments" data-selected-files></div>
                </div>
              </div>`
        }
      </div>
      <div class="dialog-actions">
        <button class="ghost-button" type="button" data-close>Отмена</button>
        <button class="button" type="submit">Сохранить</button>
      </div>
    </form>
  `);
  const preview = node.querySelector("[data-selected-files]");
  const input = node.querySelector('input[type="file"]');
  if (input) {
    input.addEventListener("change", async (event) => {
      files.push(...(await readFiles(event.target.files)));
      preview.innerHTML = files
        .map((file, index) => renderAttachment({ ...file, id: String(index), addedAt: nowISO() }, true))
        .join("");
      preview.querySelectorAll("[data-remove-attachment]").forEach((button) => {
        button.addEventListener("click", () => {
          files.splice(Number(button.dataset.removeAttachment), 1);
          button.closest(".attachment-row").remove();
        });
      });
    });
  }
  node.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    const form = new FormData(event.currentTarget);
    const inputValue = {
      date: String(form.get("date")),
      format: String(form.get("format")),
      note: String(form.get("note")).trim()
    };
    node.querySelectorAll(".error").forEach((item) => (item.textContent = ""));
    if (!inputValue.date) return (node.querySelector('[data-error="date"]').textContent = "Укажите дату");
    if (!inputValue.note) return (node.querySelector('[data-error="note"]').textContent = "Добавьте текст осмотра или заметку");
    if (submit) submit.disabled = true;
    try {
      if (isEdit) await repository.updateVisit(visit.id, { ...inputValue, expectedVersion: normalizeVisit(visit).version });
      else await repository.createVisit(patientId, inputValue, files);
      node.remove();
      await route(`#/patient/${patientId}`);
    } catch (error) {
      if (submit) submit.disabled = false;
      const target = node.querySelector('[data-error="note"]');
      if (target) target.textContent = repositoryMessage(error, "Не удалось сохранить обращение. Попробуйте ещё раз.");
    }
  });
}

async function imageViewer(attachment) {
  if (!attachment) {
    showToast("Файл временно не удалось открыть");
    return;
  }
  const node = modal(`
    <div class="dialog-head">
      <h2>${escapeHtml(attachment.name)}</h2>
      <button class="icon-button" type="button" data-close aria-label="Закрыть">×</button>
    </div>
    <div class="dialog-body">
      <p class="eyebrow" data-attachment-loading>Загружаем файл...</p>
    </div>
  `);
  const body = node.querySelector(".dialog-body");
  try {
    const url = await resolveAttachmentUrl(attachment);
    body.innerHTML = `<img src="${url}" alt="${escapeHtml(attachment.name)}" style="width:100%;height:auto;border-radius:8px;border:1px solid var(--border)" />`;
  } catch {
    body.innerHTML = `<p class="eyebrow">Файл временно не удалось открыть</p>`;
  }
}

function weightHistoryViewer(patient) {
  const history = [...(patient.weightHistory || [])].sort((a, b) => `${b.measuredAt || ""}`.localeCompare(`${a.measuredAt || ""}`));
  modal(`
    <div class="dialog-head compact-dialog-head">
      <div>
        <h2>История веса</h2>
        <p class="eyebrow">${escapeHtml(patient.fullName)}</p>
      </div>
      <button class="icon-button" type="button" data-close aria-label="Закрыть">×</button>
    </div>
    <div class="dialog-body">
      <div class="weight-history-list">
        ${
          history.length
            ? history.map((item) => `<div class="weight-history-row"><span>${formatDate(item.measuredAt)}</span><strong>${escapeHtml(String(item.valueKg))} кг</strong></div>`).join("")
            : `<p class="eyebrow">Измерений веса пока нет</p>`
        }
      </div>
    </div>
  `);
}

async function route(targetHash = location.hash || "#/") {
  if (targetHash !== location.hash) location.hash = targetHash;
  const activeHash = targetHash || location.hash || "#/";
  updateNavigationState();
  if (authState.status === "auth-loading") {
    renderAuthLoading();
    return;
  }
  if (authState.status !== "authenticated") {
    renderLogin(authState.error);
    return;
  }
  try {
    await hydrate();
  } catch (error) {
    renderCloudError(error);
    return;
  }
  const encounterMatch = activeHash.match(/^#\/patient\/([^/]+)\/encounter\/([^/]+)$/);
  const match = activeHash.match(/^#\/patient\/([^/]+)$/);
  if (encounterMatch) renderEncounterWorkspace(encounterMatch[1], encounterMatch[2]);
  else if (match) renderPatientPage(match[1]);
  else if (activeHash === "#/templates") await renderTemplatesPage();
  else if (activeHash === "#/patients") renderPatientList();
  else renderHomeDashboard();
  bindActions();
  app.focus({ preventScroll: true });
}

function bindActions() {
  bindPatientFormButtons(document);
  bindTemplateActions(document);
  document.querySelectorAll("[data-open-document-import]").forEach((button) => {
    button.addEventListener("click", openDocumentImport);
  });
  document.querySelectorAll("[data-start-encounter]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const draft = await repository.getOrCreateDraftVisit(button.dataset.startEncounter);
        await route(`#/patient/${button.dataset.startEncounter}/encounter/${draft.id}`);
      } catch (error) {
        button.disabled = false;
        showToast(repositoryMessage(error, "Не удалось открыть обращение"));
      }
    });
  });
  document.querySelectorAll("[data-open-visit-form]").forEach((button) => {
    button.addEventListener("click", () => visitForm(button.dataset.openVisitForm));
  });
  document.querySelectorAll("[data-confirm-delete-patient]").forEach((button) => {
    button.addEventListener("click", () => {
      const patient = state.patients.find((item) => item.id === button.dataset.confirmDeletePatient);
      patientDeleteConfirmation(patient);
    });
  });
  document.querySelectorAll("[data-edit-visit]").forEach((button) => {
    button.addEventListener("click", () => {
      const visit = state.visits.find((item) => item.id === button.dataset.editVisit);
      visitForm(visit.patientId, visit);
    });
  });
  document.querySelectorAll("[data-add-file]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const visit = state.visits.find((item) => item.id === input.dataset.addFile);
      const files = await readFiles(event.target.files);
      input.disabled = true;
      try {
        for (const file of files) await repository.addAttachment(visit.patientId, visit.id, file);
        await route(`#/patient/${visit.patientId}`);
      } catch (error) {
        input.disabled = false;
        input.value = "";
        showToast(repositoryMessage(error, "Не удалось добавить документ"));
      }
    });
  });
  document.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      if (!confirm("Удалить это вложение из обращения?")) return;
      const visit = state.visits.find((item) =>
        state.attachments.some((attachment) => attachment.id === button.dataset.removeAttachment && attachment.visitId === item.id)
      );
      button.disabled = true;
      try {
        await repository.removeAttachment(button.dataset.removeAttachment);
        await route(`#/patient/${visit?.patientId || ""}`);
      } catch (error) {
        button.disabled = false;
        showToast(repositoryMessage(error, "Не удалось удалить документ"));
      }
    });
  });
  document.querySelectorAll("[data-view-image]").forEach((button) => {
    button.addEventListener("click", () => {
      const attachment = state.attachments.find((item) => item.id === button.dataset.viewImage);
      imageViewer(attachment);
    });
  });
  document.querySelectorAll("[data-open-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      const attachment = state.attachments.find((item) => item.id === button.dataset.openAttachment);
      openAttachment(attachment);
    });
  });
  document.querySelectorAll("[data-weight-history]").forEach((button) => {
    button.addEventListener("click", () => {
      const patient = state.patients.find((item) => item.id === button.dataset.weightHistory);
      if (patient) weightHistoryViewer(normalizePatient(patient));
    });
  });
}

function bindPatientFormButtons(root) {
  root.querySelectorAll("[data-open-patient-form]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.openPatientForm;
      patientForm(id ? state.patients.find((patient) => patient.id === id) : null);
    });
  });
}

function bindEncounterWorkspace(patientId, visitId) {
  const saveStateTargets = document.querySelectorAll("[data-save-state], [data-save-state-mirror]");
  const contextDetails = document.querySelector(".encounter-context details");
  let currentVisit = normalizeVisit(state.visits.find((item) => item.id === visitId) || {});
  let saveTimer = null;
  let saveChain = Promise.resolve();
  let conflictLocked = false;

  if (contextDetails && window.matchMedia("(min-width: 721px)").matches) {
    contextDetails.open = true;
  }

  const growTextarea = (textarea) => {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  const collect = () => ({
    date: todayISO(),
    format: document.querySelector('input[name="encounterFormat"]:checked')?.value || "clinic",
    note: document.querySelector('[data-encounter-field="note"]')?.value.trim() || "",
    decision: document.querySelector('[data-encounter-field="decision"]')?.value.trim() || "",
    nextStep: document.querySelector('[data-encounter-field="nextStep"]')?.value.trim() || "",
    nextStepTiming: document.querySelector('[data-encounter-field="nextStepTiming"]')?.value.trim() || "",
    status: "draft"
  });

  const applySavedVisit = (savedVisit) => {
    if (!savedVisit) return;
    currentVisit = normalizeVisit(savedVisit);
    state.visits = state.visits.map((item) => (item.id === visitId ? currentVisit : item));
  };

  const setSaveStateText = (text) => {
    saveStateTargets.forEach((target) => {
      target.textContent = text;
    });
  };

  const setConflictState = () => {
    conflictLocked = true;
    if (saveTimer) window.clearTimeout(saveTimer);
    setSaveStateText("Запись изменилась в другой вкладке или на другом устройстве. Обновите данные перед продолжением.");
  };

  const setSaveErrorState = () => {
    setSaveStateText("Не удалось сохранить. Проверьте соединение и попробуйте ещё раз.");
  };

  const saveNow = async (status = "draft") => {
    if (saveTimer) window.clearTimeout(saveTimer);
    if (conflictLocked) return null;
    setSaveStateText("Сохранение…");
    try {
      const savedVisit = await repository.updateVisit(visitId, {
        ...collect(),
        status,
        expectedVersion: currentVisit.version
      });
      applySavedVisit(savedVisit);
    } catch (error) {
      if (error instanceof RepositoryError && error.type === REPOSITORY_ERROR_TYPES.CONFLICT) {
        setConflictState();
        return null;
      }
      setSaveErrorState();
      throw error;
    }
    setSaveStateText(status === "completed" ? "Сохранено" : "Черновик сохранён");
    return currentVisit;
  };

  const queueSave = (status = "draft") => {
    saveChain = saveChain.catch(() => null).then(() => saveNow(status));
    return saveChain;
  };

  const scheduleSave = () => {
    if (conflictLocked) return;
    setSaveStateText("Сохранение…");
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => queueSave("draft").catch(() => null), 700);
  };

  document.querySelectorAll("[data-encounter-field]").forEach((field) => {
    if (field.tagName === "TEXTAREA") growTextarea(field);
    field.addEventListener("input", () => {
      if (field.tagName === "TEXTAREA") growTextarea(field);
      scheduleSave();
    });
  });
  document.querySelectorAll('input[name="encounterFormat"]').forEach((field) => {
    field.addEventListener("change", scheduleSave);
  });
  document.querySelectorAll("[data-encounter-add-file]").forEach((input) => {
    input.addEventListener("change", async (event) => {
      const files = await readFiles(event.target.files);
      input.disabled = true;
      try {
        for (const file of files) await repository.addAttachment(patientId, visitId, file);
        await queueSave("draft");
        await route(`#/patient/${patientId}/encounter/${visitId}`);
      } catch (error) {
        input.disabled = false;
        input.value = "";
        setSaveStateText(repositoryMessage(error, "Не удалось добавить документ"));
      }
    });
  });
  document.querySelectorAll("[data-complete-encounter]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (saveTimer) window.clearTimeout(saveTimer);
      button.disabled = true;
      try {
        await saveChain.catch(() => null);
        await queueSave("draft");
        if (conflictLocked) return;
        const data = collect();
        if (!data.note && !data.decision && !data.nextStep && !state.attachments.some((item) => item.visitId === visitId)) {
          setSaveStateText("Добавьте запись, решение, следующий шаг или документ");
          return;
        }
        const completedVisit = await queueSave("completed");
        if (!completedVisit) return;
        showToast("Обращение сохранено");
        await route(`#/patient/${patientId}`);
      } catch (error) {
        if (error instanceof RepositoryError && error.type === REPOSITORY_ERROR_TYPES.CONFLICT) {
          setConflictState();
        } else {
          setSaveErrorState();
        }
      } finally {
        button.disabled = false;
      }
    });
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    if (!supabaseClient) return;
    logoutButton.disabled = true;
    await supabaseClient.auth.signOut();
    logoutButton.disabled = false;
  });
}

window.addEventListener("hashchange", () => route());
initializeAuth().catch((error) => {
  app.innerHTML = `<section class="state-panel"><h2>Не удалось открыть локальное хранилище</h2><p>${escapeHtml(error.message)}</p></section>`;
});
