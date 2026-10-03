const enabled = document.querySelector('#enabled');
const status = document.querySelector('#status');
const saveButton = document.querySelector('#save');
const fileInput = document.querySelector('#if-file');
const importButton = document.querySelector('#import-if');
const clearButton = document.querySelector('#clear-if');
const yearInput = document.querySelector('#if-year');
const summary = document.querySelector('#import-summary');
const savedSearches = document.querySelector('#saved-searches');
const saveCurrentSearch = document.querySelector('#save-current-search');
const DEFAULT_IF_COLOR_CONFIG = Object.freeze({
  thresholds: [10, 5, 3],
  colors: ['#c0392b', '#e67e22', '#3273b8', '#607d8b']
});
let selectedFile = null;

yearInput.value = String(new Date().getFullYear() - 1);

chrome.storage.sync.get({ enabled: true, ifColorConfig: DEFAULT_IF_COLOR_CONFIG }, (value) => {
  enabled.checked = value.enabled;
  setColorForm(normalizeColorConfig(value.ifColorConfig));
});

refreshImportStatus();
document.querySelector('#open-guide').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
renderSavedSearches();

saveCurrentSearch.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url;
  try { url = new URL(tab?.url || ''); } catch { url = null; }
  if (!url || url.hostname !== 'pubmed.ncbi.nlm.nih.gov' || !url.searchParams.get('term')) {
    showStatus('请先打开带有检索词的 PubMed 结果页', true);
    return;
  }
  const term = url.searchParams.get('term').trim();
  const { litmedixSavedQueries = [] } = await chrome.storage.sync.get('litmedixSavedQueries');
  if (litmedixSavedQueries.some((item) => item.term === term)) {
    showStatus('该检索式已经保存');
    return;
  }
  const label = term.length > 38 ? `${term.slice(0, 38)}…` : term;
  const queries = [{ id: crypto.randomUUID(), term, label, savedAt: Date.now() }, ...litmedixSavedQueries].slice(0, 30);
  await chrome.storage.sync.set({ litmedixSavedQueries: queries });
  await renderSavedSearches();
  showStatus('已保存当前 PubMed 检索式');
});

async function renderSavedSearches() {
  const { litmedixSavedQueries = [] } = await chrome.storage.sync.get('litmedixSavedQueries');
  savedSearches.innerHTML = '';
  if (!litmedixSavedQueries.length) {
    savedSearches.innerHTML = '<p class="saved-search-empty">尚无已保存检索式</p>';
    return;
  }
  litmedixSavedQueries.forEach((query) => {
    const item = document.createElement('div');
    item.className = 'saved-search-item';
    const open = document.createElement('button');
    open.className = 'saved-search-open';
    open.type = 'button';
    open.textContent = query.label || query.term;
    open.title = query.term;
    open.addEventListener('click', () => chrome.tabs.create({ url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query.term)}` }));
    const remove = document.createElement('button');
    remove.className = 'saved-search-remove';
    remove.type = 'button';
    remove.setAttribute('aria-label', `删除检索式：${query.label || query.term}`);
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      const current = (await chrome.storage.sync.get('litmedixSavedQueries')).litmedixSavedQueries || [];
      await chrome.storage.sync.set({ litmedixSavedQueries: current.filter((item) => item.id !== query.id) });
      renderSavedSearches();
    });
    item.append(open, remove);
    savedSearches.appendChild(item);
  });
}

saveButton.addEventListener('click', () => {
  const ifColorConfig = readColorForm();
  if (!ifColorConfig) return;
  chrome.storage.sync.set({ enabled: enabled.checked, ifColorConfig }, () => {
    if (chrome.runtime.lastError) {
      showStatus(`保存失败：${chrome.runtime.lastError.message}`, true);
      return;
    }
    showStatus('设置已保存，刷新 PubMed 页面后生效');
    saveButton.textContent = '✓ 保存成功';
    saveButton.classList.add('saved');
    setTimeout(() => {
      saveButton.textContent = '保存设置';
      saveButton.classList.remove('saved');
    }, 2200);
  });
});

document.querySelector('#reset-colors').addEventListener('click', () => {
  setColorForm(DEFAULT_IF_COLOR_CONFIG);
  showStatus('已恢复默认配色，请点击“保存设置”');
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

function normalizeColorConfig(value) {
  const thresholds = Array.isArray(value?.thresholds) ? value.thresholds.map(Number) : [];
  const colors = Array.isArray(value?.colors) ? value.colors.map(String) : [];
  if (thresholds.length !== 3 || colors.length !== 4 || thresholds.some((item) => !Number.isFinite(item)) || colors.some((item) => !/^#[0-9a-f]{6}$/i.test(item))) {
    return { thresholds: [...DEFAULT_IF_COLOR_CONFIG.thresholds], colors: [...DEFAULT_IF_COLOR_CONFIG.colors] };
  }
  return { thresholds, colors };
}

function setColorForm(config) {
  const normalized = normalizeColorConfig(config);
  ['#if-high', '#if-medium', '#if-low'].forEach((selector, index) => { document.querySelector(selector).value = normalized.thresholds[index]; });
  ['#color-high', '#color-medium', '#color-low', '#color-base'].forEach((selector, index) => { document.querySelector(selector).value = normalized.colors[index]; });
}

function readColorForm() {
  const thresholds = ['#if-high', '#if-medium', '#if-low'].map((selector) => Number(document.querySelector(selector).value));
  if (thresholds.some((item) => !Number.isFinite(item) || item < 0) || !(thresholds[0] > thresholds[1] && thresholds[1] > thresholds[2])) {
    showStatus('IF 分界值必须依次递减，例如 10、5、3', true);
    return null;
  }
  const colors = ['#color-high', '#color-medium', '#color-low', '#color-base'].map((selector) => document.querySelector(selector).value);
  return { thresholds, colors };
}

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

