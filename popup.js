const enabled = document.querySelector('#enabled');
const status = document.querySelector('#status');
const fileInput = document.querySelector('#if-file');
const importButton = document.querySelector('#import-if');
const clearButton = document.querySelector('#clear-if');
const yearInput = document.querySelector('#if-year');
const summary = document.querySelector('#import-summary');
let selectedFile = null;

yearInput.value = String(new Date().getFullYear() - 1);

chrome.storage.sync.get({ enabled: true }, (value) => {
  enabled.checked = value.enabled;
});

refreshImportStatus();

document.querySelector('#save').addEventListener('click', () => {
  chrome.storage.sync.set({ enabled: enabled.checked }, () => {
    showStatus('已保存，刷新 PubMed 页面后生效');
  });
});

document.querySelector('#open-notes').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('notes.html') });
});

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files?.[0] || null;
  importButton.disabled = !selectedFile;
  if (selectedFile) summary.textContent = `已选择：${selectedFile.name}（${formatBytes(selectedFile.size)}）`;
});

importButton.addEventListener('click', async () => {
  if (!selectedFile) return;
  importButton.disabled = true;
  showStatus('正在解析和建立期刊索引…', false);
  try {
    if (selectedFile.size > 40 * 1024 * 1024) throw new Error('文件不能超过 40 MB');
    const rows = await readRows(selectedFile);
    const imported = buildImport(rows, Number(yearInput.value));
    imported.sourceName = selectedFile.name;
    imported.importedAt = Date.now();
    await chrome.storage.local.set({ paperscopeCustomIf: imported });
    showStatus(`导入成功：${imported.recordCount.toLocaleString()} 本期刊`);
    selectedFile = null;
    fileInput.value = '';
    await refreshImportStatus();
  } catch (error) {
    showStatus(`导入失败：${error.message}`, true);
    importButton.disabled = false;
  }
});

clearButton.addEventListener('click', async () => {
  await chrome.storage.local.remove('paperscopeCustomIf');
  showStatus('已清除用户导入的期刊指标');
  await refreshImportStatus();
});

document.querySelector('#download-template').addEventListener('click', () => {
  const csv = '\uFEFFname,abbreviation,JIF,quartile,category,year,history_IF_2021,history_IF_2022,history_IF_2023,history_IF_2024,history_IF_2025\r\nJournal of Example,J Example,5.6,Q1,Medicine,2025,3.2,3.8,4.4,5.1,5.6\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'litmedix-journal-metrics-template.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function refreshImportStatus() {
  const { paperscopeCustomIf } = await chrome.storage.local.get('paperscopeCustomIf');
  if (!paperscopeCustomIf?.recordCount) {
    summary.textContent = '尚未导入期刊指标数据';
    clearButton.disabled = true;
    return;
  }
  const date = new Date(paperscopeCustomIf.importedAt).toLocaleDateString('zh-CN');
  summary.textContent = `当前：${paperscopeCustomIf.year} IF · ${paperscopeCustomIf.recordCount.toLocaleString()} 本 · ${date} 导入`;
  clearButton.disabled = false;
}

async function readRows(file) {
  const text = await file.text();
  if (/\.json$/i.test(file.name) || /^[\s\r\n]*[\[{]/.test(text)) {
    const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    const rows = Array.isArray(parsed) ? parsed : parsed.journals || parsed.items || parsed.data || parsed.records;
    if (!Array.isArray(rows)) throw new Error('JSON 顶层应为数组，或包含 journals/items/data/records 数组');
    return rows;
  }
  const delimiter = /\.tsv$/i.test(file.name) ? '\t' : detectDelimiter(text);
  return parseDelimited(text, delimiter);
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  return (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
}

function parseDelimited(text, delimiter) {
  const table = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) table.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) table.push(row);
  if (table.length < 2) throw new Error('CSV/TSV 中没有可导入的数据行');
  const headers = table.shift();
  return table.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function buildImport(rows, fallbackYear) {
  if (!Number.isInteger(fallbackYear) || fallbackYear < 2000 || fallbackYear > 2100) throw new Error('请输入有效的数据年份');
  const records = [];
  const aliases = Object.create(null);
  const ambiguousAliases = new Set();
  const normalizedRows = rows
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map(normalizeRow);
  const historyYears = [...new Set(normalizedRows.flatMap((row) => Object.keys(row).flatMap((key) => {
    const match = key.match(/^(?:historyif|ifhistory)(20\d{2})$/);
    return match ? [Number(match[1])] : [];
  })))].sort((a, b) => a - b);
  let detectedYear = fallbackYear;

  for (const row of normalizedRows) {
    const name = pick(row, ['name', 'journal', 'journalname', 'journaltitle', 'fulljournalname', 'title']);
    const ifField = findIfField(row);
    if (!name || !ifField) continue;
    const parsedIf = parseIf(ifField.value);
    if (!parsedIf) continue;
    detectedYear = Math.max(detectedYear, ifField.year || Number(pick(row, ['year', 'jifyear', 'ifyear'])) || fallbackYear);
    const quartileRaw = String(pick(row, ['quartile', 'jifquartile', 'jcrquartile', 'q']) || '').toUpperCase();
    const quartile = quartileRaw.match(/Q[1-4]/)?.[0] || '';
    const category = String(pick(row, ['category', 'subject', 'jcrcategory']) || '用户导入');
    const displayIf = parsedIf.display;
    const history = historyYears.map((year) => {
      const historyIf = parseIf(pick(row, [`historyif${year}`, `ifhistory${year}`]));
      return historyIf ? (historyIf.display || historyIf.value) : null;
    });
    const record = [parsedIf.value, quartile, String(name).trim(), category, 'USER', history, displayIf];
    const recordIndex = records.push(record) - 1;
    addAlias(String(name), recordIndex, true);
    const abbreviation = pick(row, ['abbreviation', 'journalabbreviation', 'jcrabbreviation', 'isoabbreviation', 'nlmta', 'abbr']);
    if (abbreviation) addAlias(String(abbreviation), recordIndex, false);
  }

  ambiguousAliases.forEach((key) => delete aliases[key]);
  if (!records.length) throw new Error('未识别到有效记录，请检查期刊名和 IF 字段');
  return { version: 2, year: detectedYear, years: historyYears, recordCount: records.length, records, aliases };

  function addAlias(value, index, isFullName) {
    const key = normalizeJournal(value);
    if (!key) return;
    if (isFullName || aliases[key] == null) aliases[key] = index;
    else if (aliases[key] !== index) ambiguousAliases.add(key);
  }
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value]));
}

function normalizeHeader(value) { return String(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeJournal(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function pick(row, keys) { for (const key of keys) if (row[key] != null && String(row[key]).trim()) return row[key]; return ''; }

function findIfField(row) {
  const candidates = Object.entries(row).flatMap(([key, value]) => {
    const match = key.match(/^(?:jif|if|impactfactor)(20\d{2})?$/);
    return match ? [{ value, year: Number(match[1]) || 0, priority: match[1] ? 2 : 1 }] : [];
  }).sort((a, b) => b.year - a.year || b.priority - a.priority);
  return candidates[0] || null;
}

function parseIf(rawValue) {
  const text = String(rawValue ?? '').trim();
  if (!text || /^(?:n\/?a|na|null|-)$/i.test(text)) return null;
  const lessThan = text.match(/^<\s*(\d+(?:\.\d+)?)$/);
  if (lessThan) return { value: Number(lessThan[1]) / 2, display: `<${lessThan[1]}` };
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) && value >= 0 ? { value, display: '' } : null;
}

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

