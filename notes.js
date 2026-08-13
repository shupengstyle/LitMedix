const state = { notes: [], selectedPmid: null, activeTag: '', query: '', sort: 'updated', mode: 'write', directoryHandle: null };
const elements = {
  totalCount: document.querySelector('#total-count'), allCount: document.querySelector('#all-count'),
  tagList: document.querySelector('#tag-list'), noteList: document.querySelector('#note-list'),
  emptyList: document.querySelector('#empty-list'), resultSummary: document.querySelector('#result-summary'),
  search: document.querySelector('#note-search'), sort: document.querySelector('#sort-notes'),
  editor: document.querySelector('#editor'), editorEmpty: document.querySelector('#editor-empty'),
  pmid: document.querySelector('#editor-pmid'), pubmed: document.querySelector('#open-pubmed'),
  title: document.querySelector('#editor-title'), tags: document.querySelector('#editor-tags'),
  note: document.querySelector('#editor-note'), preview: document.querySelector('#markdown-preview'),
  saveState: document.querySelector('#save-state'), toast: document.querySelector('#toast'),
  importInput: document.querySelector('#import-notes')
};

initialize();

async function initialize() {
  bindEvents();
  await loadNotes();
  await restoreDirectoryHandle();
  renderAll();
}

function bindEvents() {
  elements.search.addEventListener('input', () => { state.query = elements.search.value.trim().toLowerCase(); renderList(); });
  elements.sort.addEventListener('change', () => { state.sort = elements.sort.value; renderList(); });
  document.querySelector('[data-tag=""]').addEventListener('click', () => selectTag(''));
  document.querySelector('#save-note').addEventListener('click', saveSelectedNote);
  document.querySelector('#delete-note').addEventListener('click', deleteSelectedNote);
  document.querySelector('#export-notes').addEventListener('click', exportBackup);
  document.querySelector('#choose-folder').addEventListener('click', chooseStorageFolder);
  document.querySelector('#sync-folder').addEventListener('click', () => syncBackupToFolder(true));
  elements.importInput.addEventListener('change', importBackup);
  document.querySelectorAll('.editor-tabs button').forEach((button) => button.addEventListener('click', () => setEditorMode(button.dataset.mode)));
  [elements.title, elements.tags, elements.note].forEach((input) => input.addEventListener('input', () => { elements.saveState.textContent = '有未保存的修改'; elements.saveState.classList.add('dirty'); }));
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.selectedPmid) { event.preventDefault(); saveSelectedNote(); }
  });
}

async function loadNotes() {
  const stored = await chrome.storage.local.get(null);
  state.notes = Object.entries(stored)
    .filter(([key, value]) => key.startsWith('paper:') && value && typeof value === 'object')
    .map(([key, value]) => normalizeNote(key.slice(6), value));
}

function normalizeNote(pmid, value) {
  return {
    pmid: String(pmid), title: String(value.title || `PMID ${pmid}`),
    tags: String(value.tags || ''), note: String(value.note || ''),
    updatedAt: Number(value.updatedAt) || 0
  };
}

function renderAll() { renderTags(); renderList(); renderEditor(); }

function renderTags() {
  const counts = new Map();
  state.notes.forEach((note) => getTags(note.tags).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  elements.totalCount.textContent = String(state.notes.length);
  elements.allCount.textContent = String(state.notes.length);
  elements.tagList.replaceChildren(...[...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).map(([tag, count]) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `tag-filter${state.activeTag === tag ? ' active' : ''}`; button.dataset.tag = tag;
    const label = document.createElement('span'); label.textContent = tag;
    const badge = document.createElement('b'); badge.textContent = String(count);
    button.append(label, badge); button.addEventListener('click', () => selectTag(tag));
    return button;
  }));
  document.querySelector('[data-tag=""]').classList.toggle('active', !state.activeTag);
}

function selectTag(tag) { state.activeTag = tag; renderTags(); renderList(); }

function filteredNotes() {
  const filtered = state.notes.filter((note) => {
    const matchesTag = !state.activeTag || getTags(note.tags).includes(state.activeTag);
    const haystack = `${note.title}\n${note.pmid}\n${note.tags}\n${note.note}`.toLowerCase();
    return matchesTag && (!state.query || haystack.includes(state.query));
  });
  return filtered.sort((a, b) => state.sort === 'title'
    ? a.title.localeCompare(b.title, 'zh-CN')
    : b.updatedAt - a.updatedAt);
}

function renderList() {
  const notes = filteredNotes();
  elements.resultSummary.textContent = state.activeTag ? `标签“${state.activeTag}” · ${notes.length} 篇` : `${notes.length} 篇笔记`;
  elements.noteList.replaceChildren(...notes.map(createNoteCard));
  elements.emptyList.hidden = notes.length > 0;
}

function createNoteCard(note) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = `note-card${note.pmid === state.selectedPmid ? ' active' : ''}`;
  const meta = document.createElement('div'); meta.className = 'note-card-meta';
  const pmid = document.createElement('span'); pmid.textContent = `PMID ${note.pmid}`;
  const date = document.createElement('time'); date.textContent = formatDate(note.updatedAt);
  meta.append(pmid, date);
  const title = document.createElement('h2'); title.textContent = note.title;
  const excerpt = document.createElement('p'); excerpt.textContent = plainExcerpt(note.note) || '暂无笔记内容';
  const tags = document.createElement('div'); tags.className = 'note-card-tags';
  getTags(note.tags).slice(0, 4).forEach((tag) => { const chip = document.createElement('span'); chip.textContent = tag; tags.append(chip); });
  button.append(meta, title, excerpt, tags);
  button.addEventListener('click', () => { state.selectedPmid = note.pmid; renderList(); renderEditor(); });
  return button;
}

function renderEditor() {
  const note = state.notes.find((item) => item.pmid === state.selectedPmid);
  elements.editor.hidden = !note; elements.editorEmpty.hidden = Boolean(note);
  if (!note) return;
  elements.pmid.textContent = `PMID ${note.pmid}`;
  elements.pubmed.href = `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(note.pmid)}/`;
  elements.title.value = note.title; elements.tags.value = note.tags; elements.note.value = note.note;
  elements.saveState.textContent = note.updatedAt ? `上次保存：${formatDateTime(note.updatedAt)}` : '尚未保存';
  elements.saveState.classList.remove('dirty'); setEditorMode('write');
}

function setEditorMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.editor-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  elements.note.hidden = mode !== 'write'; elements.preview.hidden = mode !== 'preview';
  if (mode === 'preview') elements.preview.innerHTML = renderMarkdown(elements.note.value);
}

async function saveSelectedNote() {
  const note = state.notes.find((item) => item.pmid === state.selectedPmid);
  if (!note) return;
  note.title = elements.title.value.trim() || `PMID ${note.pmid}`;
  note.tags = normalizeTags(elements.tags.value);
  note.note = elements.note.value;
  note.updatedAt = Date.now();
  await chrome.storage.local.set({ [`paper:${note.pmid}`]: { title: note.title, tags: note.tags, note: note.note, updatedAt: note.updatedAt } });
  elements.tags.value = note.tags; elements.saveState.textContent = `已保存：${formatDateTime(note.updatedAt)}`; elements.saveState.classList.remove('dirty');
  renderTags(); renderList(); showToast('笔记已保存到本机'); await syncBackupToFolder();
}

async function deleteSelectedNote() {
  const note = state.notes.find((item) => item.pmid === state.selectedPmid);
  if (!note || !confirm(`确定删除“${note.title}”的笔记吗？此操作无法撤销。`)) return;
  await chrome.storage.local.remove(`paper:${note.pmid}`);
  state.notes = state.notes.filter((item) => item.pmid !== note.pmid); state.selectedPmid = null;
  renderAll(); showToast('笔记已删除'); await syncBackupToFolder();
}

function createBackup() {
  return { format: 'litmedix-notes-backup', version: 1, exportedAt: new Date().toISOString(), notes: state.notes };
}

function exportBackup() {
  const backup = createBackup();
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `litmedix-notes-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); showToast(`已导出 ${state.notes.length} 篇笔记`);
}

async function importBackup() {
  const file = elements.importInput.files?.[0]; if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('备份文件不能超过 20 MB');
    const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
    const notes = parseBackup(parsed);
    if (!notes.length) throw new Error('备份中没有有效笔记');
    const values = Object.fromEntries(notes.map((note) => [`paper:${note.pmid}`, { title: note.title, tags: note.tags, note: note.note, updatedAt: note.updatedAt || Date.now() }]));
    await chrome.storage.local.set(values); await loadNotes(); renderAll(); showToast(`已导入 ${notes.length} 篇笔记`); await syncBackupToFolder();
  } catch (error) { showToast(`导入失败：${error.message}`, true); }
  finally { elements.importInput.value = ''; }
}

function parseBackup(parsed) {
  if (['litmedix-notes-backup', 'paperscope-notes-backup'].includes(parsed?.format) && Array.isArray(parsed.notes)) return parsed.notes.filter(validBackupNote).map((note) => normalizeNote(note.pmid, note));
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.entries(parsed).filter(([key, value]) => key.startsWith('paper:') && value && typeof value === 'object').map(([key, value]) => normalizeNote(key.slice(6), value));
  throw new Error('不是有效的 LitMedix 笔记备份');
}

async function chooseStorageFolder() {
  if (!window.showDirectoryPicker) { showToast('当前浏览器不支持自定义文件夹，请使用最新版 Chrome 或 Edge', true); return; }
  try {
    const handle = await window.showDirectoryPicker({ id: 'paperscope-notes', mode: 'readwrite', startIn: 'documents' });
    if (!await ensureDirectoryPermission(handle)) throw new Error('未获得文件夹读写权限');
    state.directoryHandle = handle;
    await saveDirectoryHandle(handle);
    updateFolderStatus('已连接');
    const existing = await readFolderBackup(handle);
    if (existing?.notes?.length) {
      if (!confirm(`该文件夹已有 ${existing.notes.length} 篇 LitMedix 笔记。是否合并到当前笔记库？\n\n选择“取消”将保留原文件，不会覆盖。`)) {
        updateFolderStatus('已连接 · 未覆盖原文件');
        showToast('已保留文件夹中的原备份；点击“立即同步”可主动覆盖');
        return;
      }
      const notes = parseBackup(existing);
      const values = Object.fromEntries(notes.map((note) => [`paper:${note.pmid}`, { title: note.title, tags: note.tags, note: note.note, updatedAt: note.updatedAt || Date.now() }]));
      await chrome.storage.local.set(values); await loadNotes(); renderAll();
    }
    await syncBackupToFolder(true);
  } catch (error) {
    if (error.name !== 'AbortError') showToast(`文件夹设置失败：${error.message}`, true);
  }
}

async function restoreDirectoryHandle() {
  try {
    const handle = await getSavedDirectoryHandle();
    if (!handle) return;
    state.directoryHandle = handle;
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    updateFolderStatus(permission === 'granted' ? '已连接' : '需要重新授权');
  } catch { updateFolderStatus('连接失效'); }
}

async function syncBackupToFolder(showSuccess = false) {
  const handle = state.directoryHandle;
  if (!handle) { if (showSuccess) showToast('请先选择存储文件夹', true); return; }
  try {
    if (!await ensureDirectoryPermission(handle)) { updateFolderStatus('需要重新授权'); if (showSuccess) showToast('请重新选择或授权存储文件夹', true); return; }
    const fileHandle = await handle.getFileHandle('litmedix-notes.json', { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(createBackup(), null, 2));
    await writable.close(); updateFolderStatus('已同步');
    if (showSuccess) showToast(`已同步 ${state.notes.length} 篇笔记`);
  } catch (error) { updateFolderStatus('同步失败'); showToast(`文件夹同步失败：${error.message}`, true); }
}

async function readFolderBackup(handle) {
  try {
    let fileHandle;
    try { fileHandle = await handle.getFileHandle('litmedix-notes.json'); }
    catch (error) {
      if (error.name !== 'NotFoundError') throw error;
      fileHandle = await handle.getFileHandle('paperscope-notes.json');
    }
    const file = await fileHandle.getFile();
    return JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
  } catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
}

async function ensureDirectoryPermission(handle) {
  if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
}

function updateFolderStatus(status) {
  const label = document.querySelector('#folder-status');
  const syncButton = document.querySelector('#sync-folder');
  label.textContent = state.directoryHandle ? `存储：${state.directoryHandle.name} · ${status}` : '存储：浏览器本地';
  label.title = state.directoryHandle ? '自动同步到所选文件夹中的 litmedix-notes.json' : '尚未选择自定义文件夹';
  syncButton.disabled = !state.directoryHandle;
}

function openHandleDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('paperscope-file-handles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function saveDirectoryHandle(handle) {
  const database = await openHandleDatabase();
  await new Promise((resolve, reject) => { const transaction = database.transaction('handles', 'readwrite'); transaction.objectStore('handles').put(handle, 'notes-directory'); transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); });
  database.close();
}

async function getSavedDirectoryHandle() {
  const database = await openHandleDatabase();
  const handle = await new Promise((resolve, reject) => { const request = database.transaction('handles').objectStore('handles').get('notes-directory'); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); });
  database.close(); return handle;
}

function validBackupNote(note) { return note && /^\d{1,8}$/.test(String(note.pmid || '')); }
function getTags(value) { return [...new Set(String(value || '').split(/[,，;；]/).map((tag) => tag.trim()).filter(Boolean))]; }
function normalizeTags(value) { return getTags(value).join(', '); }
function plainExcerpt(value) { return String(value || '').replace(/[#>*_`\[\]()~-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 130); }
function formatDate(value) { return value ? new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '未记录'; }
function formatDateTime(value) { return new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }

function renderMarkdown(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  let inCode = false; let inList = false; const output = [];
  for (const rawLine of lines) {
    if (rawLine.trim().startsWith('```')) {
      if (inList) { output.push('</ul>'); inList = false; }
      output.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; continue;
    }
    if (inCode) { output.push(`${escapeHtml(rawLine)}\n`); continue; }
    const listMatch = rawLine.match(/^\s*[-*+]\s+(.+)$/);
    if (listMatch) { if (!inList) { output.push('<ul>'); inList = true; } output.push(`<li>${renderInline(listMatch[1])}</li>`); continue; }
    if (inList) { output.push('</ul>'); inList = false; }
    const heading = rawLine.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const level = heading[1].length; output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`); continue; }
    const quote = rawLine.match(/^>\s?(.*)$/);
    if (quote) { output.push(`<blockquote>${renderInline(quote[1])}</blockquote>`); continue; }
    if (/^\s*---+\s*$/.test(rawLine)) { output.push('<hr>'); continue; }
    output.push(rawLine.trim() ? `<p>${renderInline(rawLine)}</p>` : '');
  }
  if (inList) output.push('</ul>'); if (inCode) output.push('</code></pre>');
  return output.join('\n') || '<p class="preview-placeholder">暂无内容</p>';
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function showToast(message, isError = false) { elements.toast.textContent = message; elements.toast.className = `show${isError ? ' error' : ''}`; clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { elements.toast.className = ''; }, 2600); }
