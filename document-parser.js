(function () {
  function emptyField(metadata = {}) {
    return { value: null, sourceText: "", confidence: "low", ...metadata };
  }

  function field(value, sourceText = "", metadata = {}) {
    const normalized = typeof value === "string" ? value.trim() : value;
    return {
      value: normalized === "" ? null : normalized,
      sourceText: sourceText.trim(),
      ...metadata
    };
  }

  function normalizeWhitespace(value = "") {
    return value
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function restoreLabelBoundaries(value = "") {
    const labels = [
      "Клиника",
      "ПРОТОКОЛ",
      "Протокол",
      "ФИО",
      "Пациент",
      "Дата рождения",
      "Медкарта",
      "Врач",
      "Специальность",
      "Жалобы",
      "Анамнез заболевания",
      "Анамнез",
      "Объективный статус",
      "По данным обследования",
      "Жизненные показатели",
      "Диагноз по МКБ",
      "Клинический диагноз",
      "Лечение на приеме",
      "Лечение",
      "Назначения",
      "Рекомендации",
      "Следующий визит",
      "С планом лечения ознакомлен"
    ];
    let result = value;
    labels.forEach((label) => {
      result = result.replace(new RegExp(`\\s+(${label}\\s*:)`, "gi"), "\n$1");
    });
    result = result.replace(/\s+(ПРОТОКОЛ\s+от\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/gi, "\n$1");
    result = result.replace(/\s+(Объективный статус)(?=\s+Жизненные показатели|\s+рост|\s*$)/gi, "\n$1");
    result = result.replace(/\s+(Жизненные показатели)(?=\s+рост|\s+масса|\s*$)/gi, "\n$1");
    result = result.replace(/\s+(С планом лечения ознакомлен(?:\(а\))?\s*:)/gi, "\n$1");
    result = result.replace(/\s+(Врач\s*:)/gi, "\n$1");
    result = result.replace(/\s+(м\.?\s*п\.?)/gi, "\n$1");
    result = result.replace(/\s+((?:ТТГ)\s+от\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*:?\s*[0-9]+(?:[,.][0-9]+)?)/gi, "\n$1");
    result = result.replace(/\s+((?:СвТ4|св\.?\s*Т4|свободн(?:ый|ого)?\s+Т4)\s+от\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*:?\s*[0-9]+(?:[,.][0-9]+)?)/gi, "\n$1");
    result = result.replace(/\s+((?:АТ[-\s]?ТПО|антител[ао]\s+к\s+ТПО)[^\n]*?(?=\s+(?:Б\/х анализ крови|биохимия крови|ОАК|Узи|УЗИ|Объективный статус|Диагноз|$)))/gi, "\n$1");
    result = result.replace(/\s+((?:А\s*т\s+к\s+рецеп|антител[ао]\s+к\s+рецептор)[^\n]*?\s+[0-9]+(?:[,.][0-9]+)?)/gi, "\n$1");
    result = result.replace(/\s+((?:Б\/х анализ крови|биохимия крови)[^\n]*?)(?=\s+(?:ОАК|Пролактин|Узи|Объективный статус|Диагноз|$))/gi, "\n$1");
    result = result.replace(/\s+((?:ОАК|общий анализ крови)[^\n]*?)(?=\s+(?:Пролактин|Узи|Объективный статус|Диагноз|$))/gi, "\n$1");
    result = result.replace(/\s+((?:Пролактин)[^\n]*?\s+[0-9]+(?:[,.][0-9]+)?)/gi, "\n$1");
    result = result.replace(/\s+((?:Узи|УЗИ)\s+щитовидной железы[^\n]*?)(?=\s+(?:Узи|УЗИ)\s+обп|\s+Объективный статус|\s+Диагноз|$)/gi, "\n$1");
    result = result.replace(/\s+((?:Узи|УЗИ)\s+обп\s*\+?\s*почек[^\n]*?)(?=\s+Объективный статус|\s+Диагноз|$)/gi, "\n$1");
    result = result.replace(/\s+((?:ТТГ|СвТ4|св\.?\s*Т4|HbA1c|Глюкоза|Холестерин)\s+[0-9]+(?:[,.][0-9]+)?)/gi, "\n$1");
    return normalizeWhitespace(result);
  }

  function normalizeDocumentText(value = "") {
    return restoreLabelBoundaries(normalizeWhitespace(value))
      .replace(/\s*[:：]\s*/g, ": ")
      .replace(/[‐‑‒–—]\s*/g, "– ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function stripFooter(value = "") {
    return normalizeWhitespace(String(value).split(/\s*(?:С планом лечения ознакомлен|Врач\s*:|м\.?\s*п\.?|Подпись\b)/i)[0] || "");
  }

  function firstMeaningfulLine(value = "") {
    return normalizeWhitespace(String(value).split("\n").find((line) => line.trim()) || "");
  }

  function normalizeDate(value = "") {
    const match = String(value).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!match) return null;
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${month}-${day}`;
  }

  function firstMatch(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return { value: match[1] || match[0], sourceText: match[0] };
    }
    return null;
  }

  function sectionText(text, labels, stopLabels) {
    const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const stopPattern = stopLabels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:${labelPattern})\\s*[:\\-–]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stopPattern})\\s*[:\\-–]?|$)`, "i");
    const match = text.match(pattern);
    return match ? field(normalizeWhitespace(match[1]), match[0]) : emptyField();
  }

  const SECTION_DEFINITIONS = [
    { key: "anamnesis", labels: ["Анамнез заболевания", "Анамнез", "Жалобы"] },
    { key: "investigations", labels: ["По данным обследования", "Обследования", "Лабораторные исследования"] },
    { key: "objective", labels: ["Объективный статус", "Жизненные показатели", "Осмотр"] },
    { key: "diagnosis", labels: ["Диагноз по МКБ", "Клинический диагноз", "Диагноз"] },
    { key: "treatment", labels: ["Лечение на приеме", "Лечение", "Назначения", "Терапия", "Рекомендации", "План"] },
    { key: "next", labels: ["Следующий визит", "Повторный прием", "Контроль"] },
    { key: "footer", labels: ["С планом лечения ознакомлен", "Врач", "м.п.", "Подпись"] }
  ];

  function detectSections(text, pages = []) {
    const normalized = normalizeDocumentText(text);
    const markers = [];
    SECTION_DEFINITIONS.forEach((definition) => {
      definition.labels.forEach((label) => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(?:^|\\n)\\s*(${escaped})\\s*[:\\-–]?`, "gi");
        let match;
        while ((match = pattern.exec(normalized))) {
          markers.push({ key: definition.key, label: match[1], index: match.index });
        }
      });
    });
    markers.sort((a, b) => a.index - b.index);
    const sections = {
      header: { text: normalized.slice(0, markers[0]?.index ?? normalized.length), sourceText: normalized.slice(0, markers[0]?.index ?? normalized.length), page: 1 },
      identity: { text: normalized.split(/ПРОТОКОЛ/i)[0] || normalized, sourceText: normalized.split(/ПРОТОКОЛ/i)[0] || normalized, page: 1 },
      metadata: { text: normalized.slice(0, Math.min(normalized.length, (markers[0]?.index ?? 600) + 600)), sourceText: normalized, page: 1 }
    };
    markers.forEach((marker, index) => {
      const nextIndex = markers[index + 1]?.index ?? normalized.length;
      const sourceText = normalizeWhitespace(normalized.slice(marker.index, nextIndex));
      if (!sections[marker.key]) {
        sections[marker.key] = { text: sourceText, sourceText, label: marker.label, page: 1 };
      }
    });
    return {
      sections,
      markers,
      pages: pages.map((page, index) => ({ page: page.pageNumber || index + 1, text: page.text || page.fullText || "" }))
    };
  }

  function parsePatientIdentity(text, sections = null) {
    const beforeProtocol = text.split(/ПРОТОКОЛ/i)[0] || text;
    const fullName = firstMatch(text, [
      /(?:ФИО|Пациент(?:ка)?|Пациент)\s*[:\-–]\s*([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z .'-]+)(?=\n|$)/i
    ]);
    const birthDate = firstMatch(text, [
      /(?:Дата рождения|Д\.?\s*р\.?|Рожд(?:ение|\.))\s*[:\-–]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i
    ]);
    const organizationTokens = /^(?:ооо|ип|ао|зао|мед(?:ицинск(?:ий|ая|ое))?|клиника|центр|лайн|line|г|ул|улица|проспект|пр|д|дом|тел|mail|email|example|test|пн|вт|ср|чт|пт|сб|вс)$/i;
    const looksLikePersonName = (value = "") => {
      const tokens = normalizeWhitespace(value).split(/\s+/);
      return tokens.length === 3 && tokens.every((token) => /^[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?$/.test(token)) && !tokens.some((token) => organizationTokens.test(token));
    };
    const diagnostics = [];
    const candidateTexts = [sections?.identity?.text || "", beforeProtocol].filter(Boolean);
    const candidateMap = new Map();
    const negativeContext = /(?:ооо|ип|ао|зао|клиника|центр|г\.|город|ул\.|улица|проспект|тел\.?|e-?mail|@|врач\s*:|эндокринолог|специальность)/i;
    const positiveContext = /(?:дата рождения|медкарта|мед(?:ицинская)?\s*карта|карта\s*№|\(\s*\d{1,3}\s*(?:лет|год|года)\s*\))/i;
    const addCandidate = (candidate) => {
      if (!candidate.fullName || !looksLikePersonName(candidate.fullName)) return;
      const key = normalizeWhitespace(`${candidate.fullName}|${candidate.birthDate || ""}`).toLowerCase();
      if (candidateMap.has(key)) return;
      let score = 0;
      const reasons = [];
      if (candidate.rule === "labeled_name") {
        score += 3;
        reasons.push("explicit name label");
      }
      if (candidate.birthDate) {
        score += 3;
        reasons.push("near birth date");
      }
      if (positiveContext.test(candidate.sourceText)) {
        score += 2;
        reasons.push("patient identity context");
      }
      if ((candidate.index ?? 0) < text.search(/ПРОТОКОЛ/i) || !/ПРОТОКОЛ/i.test(text)) {
        score += 1;
        reasons.push("before protocol");
      }
      if (negativeContext.test(candidate.sourceText)) {
        score -= 3;
        reasons.push("organization/doctor/address context");
      }
      if (/врач\s*:/i.test(text.slice(Math.max(0, candidate.index - 20), candidate.index + 20))) {
        score -= 4;
        reasons.push("near doctor marker");
      }
      const confidence = score >= 6 ? "high" : score >= 4 ? "medium" : "low";
      candidateMap.set(key, { ...candidate, score, confidence, reasons });
    };
    if (fullName) {
      const labeledDate = birthDate?.value || text.slice(text.indexOf(fullName.sourceText), text.indexOf(fullName.sourceText) + 180).match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/)?.[0];
      addCandidate({
        fullName: fullName.value,
        birthDate: labeledDate,
        sourceText: fullName.sourceText,
        index: text.indexOf(fullName.sourceText),
        rule: "labeled_name"
      });
    }
    candidateTexts.forEach((candidateText) => {
      const compact = normalizeWhitespace(candidateText.replace(/\n/g, " "));
      const identityPattern = /([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?:\s*\([^)]+(?:лет|год|года)[^)]*\))?(?:\s+(?:Медкарта|Мед(?:ицинская)?\s*карта|Карта)[^\n]{0,40})?/gi;
      let compactMatch;
      while ((compactMatch = identityPattern.exec(compact))) {
        const index = text.indexOf(compactMatch[0]);
        addCandidate({
          fullName: compactMatch[1],
          birthDate: compactMatch[2],
          sourceText: compactMatch[0],
          index,
          rule: "identity_candidate_with_dob"
        });
      }
      const lines = candidateText.split("\n").map((line) => line.trim()).filter(Boolean);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const localDate = line.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
        const nextDate = lines[index + 1]?.match(/\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/);
        if (!localDate && !nextDate) continue;
        const sourceBeforeDate = localDate ? line.slice(0, localDate.index).trim() : line;
        const trailingName = sourceBeforeDate.match(/([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?)\s*$/);
        const nameTokens = sourceBeforeDate.match(/[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?/g) || [];
        const nameCandidate = trailingName?.[1] || nameTokens.slice(-3).join(" ");
        const sourceText = [line, !localDate && lines[index + 1] ? lines[index + 1] : ""].filter(Boolean).join("\n");
        addCandidate({
          fullName: nameCandidate,
          birthDate: localDate?.[1] || nextDate?.[1],
          sourceText,
          index: text.indexOf(line),
          rule: "line_candidate_with_dob"
        });
      }
    });
    const candidates = [...candidateMap.values()].sort((a, b) => b.score - a.score);
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    const ambiguous = Boolean(best && second && best.score - second.score < 2 && second.score >= 4);
    if (ambiguous) diagnostics.push({ field: "patient.fullName", rule: "identity_candidate_scoring", confidence: "low", reason: "multiple close identity candidates", candidates: candidates.slice(0, 3) });
    else if (best) diagnostics.push({ field: "patient.fullName", rule: best.rule, confidence: best.confidence, reason: best.reasons.join("; "), source: best.sourceText });
    const age = firstMatch(text, [/(?:Возраст)\s*[:\-–]?\s*([0-9]{1,3}\s*(?:лет|года|год)?)/i]);
    const card = firstMatch(text, [/(?:Мед(?:ицинская)?\s*карта|Медкарта|Карта)\s*(?:№|N|No)?\s*[:\-–]?\s*([A-Za-zА-Яа-я0-9/-]+)/i]);
    const labeledFullName = fullName ? field(fullName.value, fullName.sourceText) : emptyField();
    const labeledBirthDate = birthDate ? field(normalizeDate(birthDate.value), birthDate.sourceText) : emptyField();
    const useCandidate = best && !ambiguous && best.score >= 4;
    const candidateMetadata = useCandidate ? { confidence: best.confidence, rule: best.rule, reason: best.reasons.join("; "), page: 1 } : {};
    return {
      fullName: useCandidate ? field(best.fullName, best.sourceText, candidateMetadata) : fieldValue(labeledFullName) && !ambiguous ? labeledFullName : emptyField({ rule: "identity_candidate_scoring" }),
      birthDate: fieldValue(labeledBirthDate) && !ambiguous ? labeledBirthDate : useCandidate ? field(normalizeDate(best.birthDate), best.sourceText, candidateMetadata) : emptyField({ rule: "identity_candidate_scoring" }),
      ageMentioned: age ? field(age.value, age.sourceText, { confidence: "medium", rule: "age_label" }) : emptyField(),
      medicalCardNumber: card ? field(card.value, card.sourceText, { confidence: "medium", rule: "medical_card_label" }) : emptyField(),
      _diagnostics: diagnostics,
      _candidates: candidates
    };
  }

  function parseDocumentInfo(text) {
    const protocolDate = firstMatch(text, [
      /(?:ПРОТОКОЛ|Протокол|При[её]м|Консультация)[^\n]{0,40}?(?:от)?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i,
      /(?:Дата(?: документа| приема| при[её]ма)?)\s*[:\-–]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i
    ]);
    const clinic = firstMatch(text, [/(?:Клиника|Медицинский центр|ЛПУ|Организация)\s*[:\-–]\s*([^\n]+)/i]);
    const doctorName = firstMatch(text, [/(?:Врач)\s*[:\-–]\s*([А-ЯЁA-Z][^\n,]+)/i]);
    const specialty = firstMatch(text, [/(?:Специальность|Должность)\s*[:\-–]\s*([^\n]+)/i]);
    const type = /протокол/i.test(text) ? "protocol" : "medical document";
    return {
      type: field(type, ""),
      date: protocolDate ? field(normalizeDate(protocolDate.value), protocolDate.sourceText) : emptyField(),
      clinic: clinic ? field(clinic.value, clinic.sourceText) : emptyField(),
      doctorName: doctorName ? field(doctorName.value, doctorName.sourceText) : emptyField(),
      doctorSpecialty: specialty ? field(specialty.value, specialty.sourceText) : emptyField()
    };
  }

  function parseAnthropometry(text) {
    const height = firstMatch(text, [/(?:Рост|рост)\s*[:\-–]?\s*([0-9]{2,3}(?:[,.][0-9])?)\s*см/i]);
    const weight = firstMatch(text, [/(?:Масса тела|Вес|вес)\s*[:\-–]?\s*([0-9]{2,3}(?:[,.][0-9])?)\s*(?:кг|kg)/i]);
    const bmi = firstMatch(text, [/(?:ИМТ|BMI|индекс массы тела)\s*[:\-–]?\s*([0-9]{1,2}(?:[,.][0-9])?)/i]);
    const normalizeNumber = (value) => (value ? String(value).replace(",", ".") : null);
    return {
      heightCm: height ? field(normalizeNumber(height.value), height.sourceText) : emptyField(),
      weightKg: weight ? field(normalizeNumber(weight.value), weight.sourceText) : emptyField(),
      bmi: bmi ? field(normalizeNumber(bmi.value), bmi.sourceText) : emptyField()
    };
  }

  function parseDiagnoses(text) {
    const icd = firstMatch(text, [/(?:МКБ|Код МКБ|Диагноз по МКБ)\s*[:\-–]?\s*([A-ZА-Я][0-9]{1,2}(?:\.[0-9A-ZА-Я]+)?)/i]);
    const clinicalDiagnosis = sectionText(text, ["Клинический диагноз"], [
      "Лечение",
      "Рекомендации",
      "Обследования",
      "Следующий визит",
      "План",
      "Назначения"
    ]);
    return {
      icdCode: icd ? field(icd.value.toUpperCase(), icd.sourceText) : emptyField(),
      icdDiagnosis: emptyField(),
      clinicalDiagnosis
    };
  }

  function parseInvestigations(text, pages = []) {
    const rows = [];
    const seen = new Set();
    const investigationsBlock = sectionText(text, ["По данным обследования"], [
      "Объективный статус",
      "Жизненные показатели",
      "Диагноз",
      "Диагноз по МКБ",
      "Клинический диагноз",
      "Лечение",
      "Лечение на приеме",
      "Рекомендации",
      "Следующий визит"
    ]);
    const source = fieldValue(investigationsBlock) || text;
    const lines = source.split("\n").map((line) => normalizeWhitespace(line)).filter(Boolean);
    const pageForSource = (sourceText) => {
      const normalizedSource = normalizeWhitespace(sourceText || "");
      const page = pages.find((item) => normalizeWhitespace(item.text || "").includes(normalizedSource));
      return page?.pageNumber || page?.page || null;
    };
    const addRow = ({ name, value = null, date = null, rawText, unit = null, referenceRange = null, type = "other", confidence = "medium", rule = "investigation_fragment" }) => {
      const normalizedName = normalizeWhitespace(name);
      const normalizedRaw = normalizeWhitespace(rawText || "");
      if (!normalizedName || !normalizedRaw) return;
      const key = `${normalizedName.toLowerCase()}|${normalizedRaw.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({ type, name: normalizedName, date, value, unit, referenceRange, rawText: normalizedRaw, confidence, rule, page: pageForSource(normalizedRaw) });
    };
    const valueFromOwnFragment = (line, labelPattern) => {
      let fragment = normalizeWhitespace(line.replace(labelPattern, ""));
      fragment = fragment.replace(/\bот\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/i, "");
      fragment = fragment.split(/\b(?:ТТГ|TSH|СвТ4|св\.?\s*Т4|свободн(?:ый|ого)?\s+Т4|АТ[-\s]?ТПО|АТ\s+к\s+ТПО|Б\/х анализ крови|биохимия крови|ОАК|Пролактин|УЗИ)\b/i)[0];
      const afterColon = fragment.match(/[:\-–]\s*([0-9]+(?:[,.][0-9]+)?)(?:\s*([a-zA-Zа-яА-Я.%/]+))?/);
      const loose = fragment.match(/^\s*([0-9]+(?:[,.][0-9]+)?)(?:\s*([a-zA-Zа-яА-Я.%/]+))?/);
      const match = afterColon || loose;
      return match ? { value: match[1].replace(",", "."), unit: match[2] || null } : { value: null, unit: null };
    };
    for (let index = 0; index < lines.length; index += 1) {
      let line = lines[index];
      if (/а\s*т\s+к\s+рецеп/i.test(line) && /^\s*т\s*т\s*г/i.test(lines[index + 1] || "")) {
        line = `${line} ${lines[index + 1]}`;
        index += 1;
      }
      if (/рост|масса тела|индекс массы тела|протокол|медкарта/i.test(line)) continue;
      const date = normalizeDate(line);
      if (/а\s*т\s+к\s+рецеп|антител[ао]\s+к\s+рецептор/i.test(line)) {
        const { value, unit } = valueFromOwnFragment(line, /а\s*т\s+к\s+рецеп(?:торам)?\s*т\s*т\s*г|антител[ао]\s+к\s+рецептор[^\d:]*/i);
        addRow({ type: "anti_tsh_receptor", name: "АТ к рецепторам ТТГ", value, unit, date, rawText: line, confidence: value ? "high" : "medium" });
      } else if (/^(?:т\s*т\s*г|t\s*t\s*г|t\s*t\s*h)(?=\s|:|$)/i.test(line)) {
        const suspiciousOcr = /[A-Z]/.test(line.match(/^(?:\S+\s*){1,2}/)?.[0] || "") || /[0-9][,.\s]*[A-ZА-ЯЁ][,.\s]*[0-9]/i.test(line);
        const { value, unit } = suspiciousOcr ? { value: null, unit: null } : valueFromOwnFragment(line, /^(?:т\s*т\s*г|t\s*t\s*г|t\s*t\s*h)(?=\s|:|$)/i);
        addRow({ type: "tsh", name: "ТТГ", value, unit, date, rawText: line, confidence: value ? "high" : suspiciousOcr ? "low" : "medium" });
      } else if (/^(?:св\s*т4|cв\s*т4|свт4|св\.?\s*т4|свободн(?:ый|ого)?\s+т4)(?=\s|:|$)/i.test(line)) {
        const suspiciousOcr = /[0-9][,.\s]*[A-ZА-ЯЁ][,.\s]*[0-9]/i.test(line);
        const { value, unit } = suspiciousOcr ? { value: null, unit: null } : valueFromOwnFragment(line, /^(?:св\s*т4|cв\s*т4|свт4|св\.?\s*т4|свободн(?:ый|ого)?\s+т4)(?=\s|:|$)/i);
        addRow({ type: "free_t4", name: "СвТ4", value, unit, date, rawText: line, confidence: value ? "high" : suspiciousOcr ? "low" : "medium" });
      } else if (/^(?:ат[-\s]?тпо|антител[ао]\s+к\s+тпо)(?=\s|:|$)/i.test(line)) {
        const { value, unit } = valueFromOwnFragment(line, /^(?:ат[-\s]?тпо|антител[ао]\s+к\s+тпо)(?=\s|:|$)/i);
        addRow({ type: "anti_tpo", name: "АТ-ТПО", value, unit, date, rawText: line, confidence: value ? "high" : "medium" });
      }
      else if (/б\/х|биохим/i.test(line)) addRow({ type: "biochemistry", name: "Биохимия крови", value: null, date, rawText: line, confidence: "medium" });
      else if (/^оак/i.test(line) || /общий анализ крови/i.test(line)) addRow({ type: "cbc", name: "ОАК", value: /без отклон/i.test(line) ? "Без отклонений" : null, date, rawText: line, confidence: "medium" });
      else if (/пролактин/i.test(line)) {
        const { value, unit } = valueFromOwnFragment(line, /пролактин/i);
        addRow({ type: "prolactin", name: "Пролактин", value, unit, date, rawText: line, confidence: value ? "high" : "medium" });
      }
      else if (/узи\s+щитовид/i.test(line)) addRow({ type: "ultrasound_thyroid", name: "УЗИ щитовидной железы", value: null, date, rawText: line, confidence: "medium" });
      else if (/узи\s+обп|узи\s+органов брюшной|почек/i.test(line)) addRow({ type: "ultrasound_abdomen_kidney", name: "УЗИ ОБП + почек", value: null, date, rawText: line, confidence: "medium" });
      else {
        const generic = line.match(/^([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z0-9 .+/-]{1,42})\s+([0-9]+(?:[,.][0-9]+)?)\s*([a-zA-Zа-яА-Я/%]+)?\s*(?:\(([^)]+)\))?/);
        if (generic) {
          addRow({
            name: generic[1],
            value: generic[2].replace(",", "."),
            unit: generic[3] || null,
            referenceRange: generic[4] || null,
            date,
            rawText: line
          });
        }
      }
    }
    return rows.slice(0, 16);
  }

  function parseClinical(text) {
    const stops = [
      "Жалобы",
      "Анамнез заболевания",
      "Анамнез",
      "Объективный статус",
      "По данным обследования",
      "Жизненные показатели",
      "Диагноз",
      "Клинический диагноз",
      "Диагноз по МКБ",
      "Лечение на приеме",
      "Лечение",
      "Рекомендации",
      "Обследования",
      "Следующий визит",
      "План",
      "С планом лечения ознакомлен",
      "Врач",
      "м.п."
    ];
    const diagnosis = parseDiagnoses(text);
    const nextStep = sectionText(text, ["Следующий визит", "Контроль", "Повторный прием"], stops);
    if (fieldValue(nextStep)) {
      nextStep.value = firstMeaningfulLine(stripFooter(nextStep.value));
    }
    return {
      anamnesis: sectionText(text, ["Анамнез заболевания", "Анамнез"], stops),
      complaints: sectionText(text, ["Жалобы"], stops),
      objectiveStatus: sectionText(text, ["Объективный статус", "Осмотр"], stops),
      icdCode: diagnosis.icdCode,
      icdDiagnosis: diagnosis.icdDiagnosis,
      clinicalDiagnosis: diagnosis.clinicalDiagnosis,
      treatment: sectionText(text, ["Лечение на приеме", "Лечение", "Назначения", "Терапия"], stops),
      recommendations: sectionText(text, ["Рекомендации", "Обследования", "План"], stops),
      nextStep,
      nextVisitTiming: fieldValue(nextStep) ? field(fieldValue(nextStep), nextStep.sourceText) : firstMatch(text, [/следующ(?:ий|его)\s+визит[^\n]{0,40}?(через\s+[^\n.;]+)/i])
    };
  }

  function fieldValue(item) {
    return item && typeof item === "object" && "value" in item ? item.value : item || null;
  }

  function collectDiagnostics({ patient, document, anthropometry, clinical, investigations, sections }) {
    const diagnostics = [];
    if (patient?._diagnostics?.length) diagnostics.push(...patient._diagnostics);
    [
      ["document.date", document.date],
      ["anthropometry.heightCm", anthropometry.heightCm],
      ["anthropometry.weightKg", anthropometry.weightKg],
      ["clinical.icdCode", clinical.icdCode],
      ["clinical.clinicalDiagnosis", clinical.clinicalDiagnosis],
      ["clinical.nextStep", clinical.nextStep]
    ].forEach(([name, item]) => {
      if (item?.value) {
        diagnostics.push({
          field: name,
          rule: item.rule || "legacy_field_parser",
          confidence: item.confidence || "medium",
          source: item.sourceText || ""
        });
      }
    });
    investigations.forEach((item, index) => {
      diagnostics.push({
        field: `investigations.${index}`,
        rule: item.rule || "investigation_fragment",
        confidence: item.confidence || "medium",
        source: item.rawText || "",
        reason: item.value ? "value extracted from own fragment" : "raw fragment preserved"
      });
    });
    diagnostics.push({ field: "sections", rule: "detectSections", confidence: "medium", reason: Object.keys(sections || {}).join(", ") });
    return diagnostics;
  }

  function validateParsedDraft({ patient, document, clinical, investigations }) {
    const warnings = [];
    if (!fieldValue(patient.fullName)) warnings.push("Не удалось уверенно определить пациента");
    if (!fieldValue(patient.birthDate)) warnings.push("Дата рождения не найдена");
    if (!fieldValue(document.date)) warnings.push("Не удалось определить дату визита");
    if (fieldValue(patient.birthDate) && fieldValue(document.date) && fieldValue(patient.birthDate) >= fieldValue(document.date)) {
      warnings.push("Дата рождения выглядит позже или равной дате документа");
    }
    if (!fieldValue(clinical.clinicalDiagnosis) && !fieldValue(clinical.icdCode)) warnings.push("Диагноз не найден");
    if (fieldValue(clinical.nextStep) && /(?:С планом лечения ознакомлен|Врач\s*:|м\.?\s*п\.?|Подпись\b)/i.test(fieldValue(clinical.nextStep))) {
      warnings.push("Следующий шаг содержит текст подписи или footer");
    }
    investigations.forEach((item) => {
      if (item.confidence === "low") warnings.push(`${item.name} найден, значение требует проверки`);
    });
    if (patient?._diagnostics?.some((item) => item.reason === "multiple close identity candidates")) {
      warnings.push("Найдены два возможных ФИО пациента");
    }
    return warnings;
  }

  function parseMedicalDocument(extractedText) {
    const originalText = extractedText?.fullText || String(extractedText || "");
    const normalizedText = normalizeDocumentText(originalText);
    const context = {
      method: extractedText?.method || "text",
      rawText: originalText,
      normalizedText,
      pages: extractedText?.pages || [],
      ...detectSections(normalizedText, extractedText?.pages || [])
    };
    const patient = parsePatientIdentity(normalizedText, context.sections);
    const document = parseDocumentInfo(normalizedText);
    const anthropometry = parseAnthropometry(normalizedText);
    const clinical = parseClinical(normalizedText);
    if (clinical.nextVisitTiming && !("value" in clinical.nextVisitTiming)) {
      clinical.nextVisitTiming = field(clinical.nextVisitTiming.value, clinical.nextVisitTiming.sourceText);
    } else if (!clinical.nextVisitTiming) {
      clinical.nextVisitTiming = emptyField();
    }
    const investigations = parseInvestigations(normalizedText, context.pages);
    const warnings = validateParsedDraft({ patient, document, clinical, investigations });
    const diagnostics = collectDiagnostics({ patient, document, anthropometry, clinical, investigations, sections: context.sections });
    return {
      patient,
      document,
      anthropometry,
      clinical,
      investigations,
      warnings,
      diagnostics,
      sections: context.sections,
      unparsedText: normalizedText,
      pages: context.pages
    };
  }

  window.MedNoteDocumentParser = {
    normalizeWhitespace,
    restoreLabelBoundaries,
    normalizeDocumentText,
    detectSections,
    parsePatientIdentity,
    parseDocumentInfo,
    parseAnthropometry,
    parseDiagnoses,
    parseInvestigations,
    parseClinical,
    parseMedicalDocument,
    fieldValue,
    stripFooter,
    firstMeaningfulLine
  };
})();
