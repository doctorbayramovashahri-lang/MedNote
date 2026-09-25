(function () {
  const PDF_TEXT_MIN_CHARS = 120;
  const PDF_TEXT_MIN_WORDS = 18;
  const PDF_MAX_AUTO_PAGES = 8;
  const OCR_SCALE = 1.6;
  const PDFJS_WORKER_SRC = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

  function ensurePdfJs() {
    if (!window.pdfjsLib) throw new Error("PDF.js не загружен.");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    return window.pdfjsLib;
  }

  function meaningfulTextStats(text = "") {
    const normalized = window.MedNoteDocumentParser.normalizeWhitespace(text);
    const meaningfulChars = (normalized.match(/[A-Za-zА-Яа-яЁё0-9]/g) || []).length;
    const words = (normalized.match(/[A-Za-zА-Яа-яЁё0-9]{2,}/g) || []).length;
    const nonWhitespace = normalized.replace(/\s/g, "").length;
    return { meaningfulChars, words, nonWhitespace };
  }

  function hasUsefulText(text = "") {
    const stats = meaningfulTextStats(text);
    return stats.meaningfulChars >= PDF_TEXT_MIN_CHARS && stats.words >= PDF_TEXT_MIN_WORDS;
  }

  async function extractPdfText(file, onProgress = () => {}) {
    const pdfjsLib = ensurePdfJs();
    const data = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > PDF_MAX_AUTO_PAGES) {
      throw new Error(`Документ содержит ${pdf.numPages} страниц. В этом прототипе автоматически обрабатывается до ${PDF_MAX_AUTO_PAGES}.`);
    }
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      onProgress({ stage: "text", label: "Извлекаем текст", pageNumber, pageCount: pdf.numPages, percent: Math.round((pageNumber / pdf.numPages) * 100) });
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str).join(" ");
      pages.push({ pageNumber, text: window.MedNoteDocumentParser.normalizeWhitespace(text) });
    }
    return {
      pageCount: pdf.numPages,
      pages,
      fullText: pages.map((page) => page.text).join("\n\n"),
      pdf
    };
  }

  async function renderPageToCanvas(page) {
    const viewport = page.getViewport({ scale: OCR_SCALE });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas;
  }

  async function extractPdfOcr(pdf, onProgress = () => {}) {
    if (!window.Tesseract) throw new Error("Tesseract.js не загружен.");
    const pages = [];
    const worker = await window.Tesseract.createWorker("rus+eng", 1, {
      logger: (message) => {
        if (message.status === "recognizing text") {
          onProgress({
            stage: "ocr",
            label: "Распознаём документ",
            pageNumber: message.page || pages.length + 1,
            pageCount: pdf.numPages,
            percent: Math.round((pages.length / pdf.numPages) * 100 + (message.progress || 0) * (100 / pdf.numPages))
          });
        }
      }
    });
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        onProgress({ stage: "ocr", label: "Распознаём документ", pageNumber, pageCount: pdf.numPages, percent: Math.round(((pageNumber - 1) / pdf.numPages) * 100) });
        const page = await pdf.getPage(pageNumber);
        const canvas = await renderPageToCanvas(page);
        const { data } = await worker.recognize(canvas);
        pages.push({ pageNumber, text: window.MedNoteDocumentParser.normalizeWhitespace(data.text || "") });
      }
    } finally {
      await worker.terminate();
    }
    return {
      pageCount: pdf.numPages,
      pages,
      fullText: pages.map((page) => page.text).join("\n\n")
    };
  }

  async function analyzePdfFile(file, onProgress = () => {}) {
    if (!file || file.type !== "application/pdf") throw new Error("Выберите PDF-документ.");
    onProgress({ stage: "text", label: "Извлекаем текст", percent: 0 });
    const textResult = await extractPdfText(file, onProgress);
    let extraction = {
      method: "pdf-text",
      pageCount: textResult.pageCount,
      pages: textResult.pages,
      fullText: textResult.fullText
    };
    if (!hasUsefulText(textResult.fullText)) {
      onProgress({ stage: "ocr-loading", label: "Документ выглядит как скан. Запускаем распознавание...", percent: 0 });
      extraction = {
        method: "ocr",
        ...(await extractPdfOcr(textResult.pdf, onProgress))
      };
      if (!hasUsefulText(extraction.fullText)) {
        throw new Error("Не удалось надёжно распознать документ.");
      }
    }
    const draft = window.MedNoteDocumentParser.parseMedicalDocument(extraction);
    return { extraction, draft };
  }

  window.MedNoteDocumentImport = {
    PDF_MAX_AUTO_PAGES,
    PDF_TEXT_MIN_CHARS,
    PDF_TEXT_MIN_WORDS,
    meaningfulTextStats,
    hasUsefulText,
    analyzePdfFile
  };
})();
