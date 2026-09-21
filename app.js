const DB_NAME = "mednote-local-mvp";
const DB_VERSION = 1;
const STORE = "state";
const STATE_KEY = "mednote-state";

const app = document.querySelector("#app");

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
    startedAt: visit.startedAt || visit.createdAt || nowISO()
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
      await mutate((state) => ({
        ...state,
        visits: state.visits.map((visit) => (visit.id === id ? normalizeVisit({ ...visit, ...input, updatedAt: nowISO() }) : visit))
      }));
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

let state = { patients: [], visits: [], attachments: [], query: "" };

async function hydrate() {
  state.patients = await dbRepository.getPatients();
  const allVisits = await Promise.all(state.patients.map((patient) => dbRepository.getVisits(patient.id)));
  const allAttachments = await Promise.all(state.patients.map((patient) => dbRepository.getAttachments(patient.id)));
  state.visits = allVisits.flat();
  state.attachments = allAttachments.flat();
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

function attachmentIcon(attachment) {
  if (attachment.mime.startsWith("image/")) {
    return `<img src="${attachment.dataUrl}" alt="">`;
  }
  return "PDF";
}

function renderAttachment(attachment, removable = false) {
  const openAction = attachment.mime.startsWith("image/")
    ? `<button class="text-button compact-action" type="button" data-view-image="${attachment.id}">Открыть</button>`
    : `<a class="text-button compact-action" href="${attachment.dataUrl}" target="_blank" rel="noopener">Открыть PDF</a>`;
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

function renderPatientList() {
  app.innerHTML = `
    <section class="page-head">
      <div>
        <h1>Пациенты</h1>
        <p class="eyebrow">${state.patients.length} пациентов</p>
      </div>
      <button class="button" type="button" data-open-patient-form>+ Добавить пациента</button>
    </section>
    <section class="toolbar" aria-label="Поиск пациентов">
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
    ? `<section class="grid">${patients.map(renderPatientCard).join("")}</section>`
    : `<section class="state-panel"><h2>Пациенты не найдены</h2><p>Проверьте написание ФИО или добавьте нового пациента.</p><button class="button" type="button" data-open-patient-form>Добавить пациента</button></section>`;
  bindPatientFormButtons(results);
}

function renderPatientCard(patient) {
  const visit = latestVisit(patient.id);
  return `
    <a class="patient-card" href="#/patient/${patient.id}">
      <div class="patient-avatar" aria-hidden="true">${escapeHtml(initials(patient.fullName))}</div>
      <div class="patient-card-main">
        <div class="patient-name">${escapeHtml(patient.fullName)}</div>
        <div class="patient-meta">${calculateAge(patient.birthDate)} лет · ${formatDate(patient.birthDate)}</div>
        <div class="patient-last">Последний прием: ${visit ? formatShortDate(visit.date) : "обращений нет"}</div>
      </div>
      <span class="chevron" aria-hidden="true">›</span>
    </a>
  `;
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
      <h2><span aria-hidden="true">✎</span>О пациенте</h2>
      <p>${escapeHtml(patient.about)}</p>
    </section>
  `;
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
    <section class="page-head">
      <div>
        <p class="eyebrow"><a href="#/">Пациенты</a> / карточка пациента</p>
        <h1>Карточка пациента</h1>
      </div>
      <button class="button" type="button" data-start-encounter="${patient.id}">${draft ? "Продолжить обращение" : "Новое обращение"}</button>
    </section>
    <section class="patient-hero">
      <div class="patient-identity">
        <div class="patient-avatar" aria-hidden="true">${escapeHtml(initials(patient.fullName))}</div>
        <div>
          <h1>${escapeHtml(patient.fullName)}</h1>
          <p class="patient-meta">${calculateAge(patient.birthDate)} лет · ${formatDate(patient.birthDate)}${patient.sex ? ` · ${sexLabel(patient.sex)}` : ""}</p>
          <p class="patient-last">Последний прием: ${latest ? formatShortDate(latest.date) : "обращений нет"}</p>
          ${renderContactLine(patient)}
        </div>
      </div>
      <button class="ghost-button" type="button" data-open-patient-form="${patient.id}">Редактировать данные</button>
    </section>
    <section class="profile-read" aria-label="Профиль пациента">
      ${renderMetricStrip(patient)}
      ${renderImportant(patient)}
      ${renderAbout(patient)}
      ${nextStep ? `<section class="profile-section next-step-card"><h2>Дальше</h2><p>${escapeHtml(nextStep)}</p></section>` : ""}
    </section>
    <section class="patient-layout">
      <aside class="panel patient-summary">
        <h2>Данные пациента</h2>
        <dl class="meta-list">
          <div class="meta-row"><dt>Возраст</dt><dd><strong>${calculateAge(patient.birthDate)} лет</strong></dd></div>
          <div class="meta-row"><dt>Дата рождения</dt><dd><strong>${formatDate(patient.birthDate)}</strong></dd></div>
          <div class="meta-row"><dt>Email</dt><dd><strong>${patient.email ? escapeHtml(patient.email) : "Не указан"}</strong></dd></div>
          <div class="meta-row"><dt>Последнее</dt><dd><strong>${latest ? formatDate(latest.date) : "Обращений нет"}</strong></dd></div>
        </dl>
        <button class="ghost-button" type="button" data-open-patient-form="${patient.id}">Редактировать</button>
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
  return `
    <article class="visit-card">
      <div class="visit-head">
        <div>
          <h3>${formatDate(visit.date)}</h3>
          <p class="eyebrow">Создано ${new Date(visit.createdAt).toLocaleDateString("ru-RU")}</p>
        </div>
        <span class="badge">${visitFormatLabel(visit.format)}</span>
      </div>
      <p class="note-text">${escapeHtml(visit.note || "Осмотр не заполнен")}</p>
      ${visit.decision ? `<div class="visit-detail"><span>Решение</span><p>${escapeHtml(visit.decision)}</p></div>` : ""}
      ${visit.nextStep ? `<div class="visit-detail"><span>Дальше</span><p>${escapeHtml(visit.nextStep)}${visit.nextStepTiming ? ` · ${escapeHtml(visit.nextStepTiming)}` : ""}</p></div>` : ""}
      <div class="attachments">
        ${attachments.length ? attachments.map((item) => renderAttachment(item, true)).join("") : `<p class="eyebrow">Вложений нет</p>`}
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
  app.innerHTML = `
    <section class="encounter-workspace">
      <header class="encounter-header">
        <div>
          <p class="eyebrow encounter-back"><a href="#/patient/${patient.id}">← Карточка пациента</a></p>
          <h1>${escapeHtml(patient.fullName)}</h1>
          <p class="patient-meta">${formatDate(visit.date)} · начато ${new Date(visit.startedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
        <div class="encounter-header-actions">
          <span class="save-state" data-save-state>Черновик сохранён</span>
          <button class="button" type="button" data-complete-encounter="${visit.id}">Завершить обращение</button>
        </div>
      </header>
      <section class="encounter-layout">
        <section class="encounter-main" aria-label="Текущее обращение">
          <div class="field">
            <span class="label">Тип контакта</span>
            <div class="segmented" role="radiogroup" aria-label="Тип контакта">
              ${["clinic", "online", "phone"].map((format) => `<label><input type="radio" name="encounterFormat" value="${format}" ${visit.format === format ? "checked" : ""}> <span><span class="desktop-label">${visitFormatLabel(format)}</span><span class="mobile-label">${format === "phone" ? "Телефон" : visitFormatLabel(format)}</span></span></label>`).join("")}
            </div>
          </div>
          <div class="form-grid">
            <div class="field full">
              <label for="encounterNote">Что происходит</label>
              <textarea id="encounterNote" data-encounter-field="note" placeholder="Жалобы, изменения, результаты, наблюдения">${escapeHtml(visit.note)}</textarea>
              <span class="hint"></span>
            </div>
            <div class="field full">
              <label for="encounterDecision">Решение</label>
              <textarea id="encounterDecision" data-encounter-field="decision" placeholder="Что решили / что сделал врач">${escapeHtml(visit.decision)}</textarea>
              <span class="hint"></span>
            </div>
            <div class="next-step-fields full">
              <div class="field">
                <label for="encounterNextStep">Дальше</label>
                <input id="encounterNextStep" data-encounter-field="nextStep" value="${escapeHtml(visit.nextStep)}" placeholder="Например: контроль ТТГ" />
                <span class="hint">Что должно произойти после обращения</span>
              </div>
              <div class="field">
                <label for="encounterNextTiming">Ориентир</label>
                <input id="encounterNextTiming" data-encounter-field="nextStepTiming" value="${escapeHtml(visit.nextStepTiming)}" placeholder="через 3 месяца, после результатов" />
                <span class="hint">Дата, срок или условие</span>
              </div>
            </div>
          </div>
          <section class="encounter-documents">
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
          <div class="mobile-complete-flow">
            <button class="button" type="button" data-complete-encounter="${visit.id}">Завершить обращение</button>
          </div>
        </section>
        <aside class="encounter-context">
          <details>
            <summary>Контекст пациента</summary>
            ${renderImportant(patient) || `<p class="eyebrow">Важный контекст не заполнен</p>`}
            ${
              lastVisit?.nextStep
                ? `<section class="context-block context-next-block"><h2>На чём остановились</h2><p>${escapeHtml(lastVisit.nextStep)}${lastVisit.nextStepTiming ? ` · ${escapeHtml(lastVisit.nextStepTiming)}` : ""}</p></section>`
                : ""
            }
            <section class="context-block">
              <h2>Последний контакт</h2>
              ${
                lastVisit
                  ? `<p><strong>${formatDate(lastVisit.date)} · ${visitFormatLabel(lastVisit.format)}</strong></p><p>${escapeHtml(lastVisit.note || "Без заметки")}</p>`
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

function modal(content) {
  const node = document.createElement("div");
  node.className = "modal open";
  node.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${content}</div>`;
  document.body.append(node);
  node.addEventListener("click", (event) => {
    if (event.target === node || event.target.matches("[data-close]")) node.remove();
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

function patientForm(patient = null) {
  const isEdit = Boolean(patient);
  patient = patient ? normalizePatient(patient) : normalizePatient({});
  const weight = latestWeight(patient);
  const node = modal(`
    <form>
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
            <div class="field">
              <label for="currentWeightKg">Вес, кг</label>
              <input id="currentWeightKg" name="currentWeightKg" type="number" min="0" step="0.1" value="${escapeHtml(String(weight?.valueKg || ""))}" />
              <span class="hint">Новая дата сохранит новое измерение</span>
            </div>
            <div class="field">
              <label for="weightMeasuredAt">Дата измерения веса</label>
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
  `);
  node.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
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
    const saved = isEdit ? await dbRepository.updatePatient(patient.id, input) : await dbRepository.createPatient(input);
    node.remove();
    showToast("Сохранено");
    await route(`#/patient/${saved.id}`);
  });
}

async function readFiles(fileList) {
  const files = Array.from(fileList);
  return Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              kind: file.type.includes("pdf") ? "pdf" : "analysis-photo",
              name: file.name,
              mime: file.type || "application/octet-stream",
              dataUrl: reader.result,
              size: file.size
            });
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        })
    )
  );
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
    const form = new FormData(event.currentTarget);
    const inputValue = {
      date: String(form.get("date")),
      format: String(form.get("format")),
      note: String(form.get("note")).trim()
    };
    node.querySelectorAll(".error").forEach((item) => (item.textContent = ""));
    if (!inputValue.date) return (node.querySelector('[data-error="date"]').textContent = "Укажите дату");
    if (!inputValue.note) return (node.querySelector('[data-error="note"]').textContent = "Добавьте текст осмотра или заметку");
    if (isEdit) await dbRepository.updateVisit(visit.id, inputValue);
    else await dbRepository.createVisit(patientId, inputValue, files);
    node.remove();
    await route(`#/patient/${patientId}`);
  });
}

function imageViewer(attachment) {
  modal(`
    <div class="dialog-head">
      <h2>${escapeHtml(attachment.name)}</h2>
      <button class="icon-button" type="button" data-close aria-label="Закрыть">×</button>
    </div>
    <div class="dialog-body">
      <img src="${attachment.dataUrl}" alt="${escapeHtml(attachment.name)}" style="width:100%;height:auto;border-radius:8px;border:1px solid var(--border)" />
    </div>
  `);
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
  await hydrate();
  const encounterMatch = location.hash.match(/^#\/patient\/([^/]+)\/encounter\/([^/]+)$/);
  const match = location.hash.match(/^#\/patient\/([^/]+)$/);
  if (encounterMatch) renderEncounterWorkspace(encounterMatch[1], encounterMatch[2]);
  else if (match) renderPatientPage(match[1]);
  else renderPatientList();
  bindActions();
  app.focus({ preventScroll: true });
}

function bindActions() {
  bindPatientFormButtons(document);
  document.querySelectorAll("[data-start-encounter]").forEach((button) => {
    button.addEventListener("click", async () => {
      const draft = await dbRepository.getOrCreateDraftVisit(button.dataset.startEncounter);
      await route(`#/patient/${button.dataset.startEncounter}/encounter/${draft.id}`);
    });
  });
  document.querySelectorAll("[data-open-visit-form]").forEach((button) => {
    button.addEventListener("click", () => visitForm(button.dataset.openVisitForm));
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
      for (const file of files) await dbRepository.addAttachment(visit.patientId, visit.id, file);
      await route(`#/patient/${visit.patientId}`);
    });
  });
  document.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Удалить это вложение из обращения?")) return;
      const visit = state.visits.find((item) =>
        state.attachments.some((attachment) => attachment.id === button.dataset.removeAttachment && attachment.visitId === item.id)
      );
      await dbRepository.removeAttachment(button.dataset.removeAttachment);
      await route(`#/patient/${visit?.patientId || ""}`);
    });
  });
  document.querySelectorAll("[data-view-image]").forEach((button) => {
    button.addEventListener("click", () => {
      const attachment = state.attachments.find((item) => item.id === button.dataset.viewImage);
      imageViewer(attachment);
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
  const saveState = document.querySelector("[data-save-state]");
  const contextDetails = document.querySelector(".encounter-context details");
  let saveTimer = null;

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

  const saveNow = async (status = "draft") => {
    if (saveTimer) window.clearTimeout(saveTimer);
    if (saveState) saveState.textContent = "Сохранение…";
    await dbRepository.updateVisit(visitId, { ...collect(), status });
    await hydrate();
    if (saveState) saveState.textContent = status === "completed" ? "Сохранено" : "Черновик сохранён";
  };

  const scheduleSave = () => {
    if (saveState) saveState.textContent = "Сохранение…";
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveNow("draft"), 700);
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
      for (const file of files) await dbRepository.addAttachment(patientId, visitId, file);
      await saveNow("draft");
      await route(`#/patient/${patientId}/encounter/${visitId}`);
    });
  });
  document.querySelectorAll("[data-complete-encounter]").forEach((button) => {
    button.addEventListener("click", async () => {
      await saveNow("draft");
      const data = collect();
      if (!data.note && !data.decision && !data.nextStep && !state.attachments.some((item) => item.visitId === visitId)) {
        if (saveState) saveState.textContent = "Добавьте запись, решение, следующий шаг или документ";
        return;
      }
      await dbRepository.updateVisit(visitId, { ...data, status: "completed", date: todayISO() });
      showToast("Обращение сохранено");
      await route(`#/patient/${patientId}`);
    });
  });
}

window.addEventListener("hashchange", () => route());
route().catch((error) => {
  app.innerHTML = `<section class="state-panel"><h2>Не удалось открыть локальное хранилище</h2><p>${escapeHtml(error.message)}</p></section>`;
});
