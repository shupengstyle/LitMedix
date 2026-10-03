const MENU_ID = "paperscope-pubmed-search";

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "PubMed检索",
      contexts: ["selection"]
    });
  });
}

function removeUnmatchedClosingBrackets(value) {
  let result = value;
  const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];

  for (const [opening, closing] of pairs) {
    while (result.endsWith(closing)) {
      const openingCount = result.split(opening).length - 1;
      const closingCount = result.split(closing).length - 1;
      if (closingCount <= openingCount) break;
      result = result.slice(0, -1);
    }
  }

  return result;
}

function extractPmid(selection) {
  const match = selection.match(/^(?:PMID\s*:\s*)?(\d{1,8})$/i);
  return match?.[1] || null;
}

function extractDoi(selection) {
  const withoutPrefix = selection
    .replace(/^doi\s*:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .trim()
    .replace(/[.,;:]+$/, "");
  const cleaned = removeUnmatchedClosingBrackets(withoutPrefix);
  const match = cleaned.match(/^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i);
  return match ? cleaned : null;
}

chrome.runtime.onInstalled.addListener((details) => {
  createContextMenu();
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
chrome.runtime.onStartup.addListener(createContextMenu);

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;

  const selection = info.selectionText.trim();
  const pmid = extractPmid(selection);
  const doi = pmid ? null : extractDoi(selection);

  if (pmid) {
    chrome.tabs.create({ url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` });
  } else if (doi) {
    const query = encodeURIComponent(`${doi}[AID]`);
    chrome.tabs.create({ url: `https://pubmed.ncbi.nlm.nih.gov/?term=${query}` });
  }
});

let notesSyncTimer;
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !Object.keys(changes).some((key) => key.startsWith("paper:"))) return;
  clearTimeout(notesSyncTimer);
  notesSyncTimer = setTimeout(syncNotesToCustomFolder, 500);
});

async function syncNotesToCustomFolder() {
  try {
    const handle = await getSavedNotesDirectory();
    if (!handle || typeof handle.queryPermission !== "function") return;
    if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") return;
    const stored = await chrome.storage.local.get(null);
    const notes = Object.entries(stored)
      .filter(([key, value]) => key.startsWith("paper:") && value && typeof value === "object")
      .map(([key, value]) => ({ pmid: key.slice(6), title: String(value.title || `PMID ${key.slice(6)}`), tags: String(value.tags || ""), note: String(value.note || ""), updatedAt: Number(value.updatedAt) || 0 }));
    const backup = { format: "litmedix-notes-backup", version: 1, exportedAt: new Date().toISOString(), notes };
    const fileHandle = await handle.getFileHandle("litmedix-notes.json", { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(backup, null, 2));
    await writable.close();
  } catch (error) {
    console.warn("LitMedix custom-folder sync failed", error);
  }
}

function getSavedNotesDirectory() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("paperscope-file-handles", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("handles");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const lookup = database.transaction("handles").objectStore("handles").get("notes-directory");
      lookup.onsuccess = () => { resolve(lookup.result || null); database.close(); };
      lookup.onerror = () => { reject(lookup.error); database.close(); };
    };
  });
}
