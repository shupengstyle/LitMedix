(() => {
  const CARD_SELECTOR = 'article.full-docsum, .search-results-chunk article';
  let customIfData = null;
  let activeIfYear = globalThis.PAPERSCOPE_IF_META?.years?.at(-1) || 2025;
  const hasBuiltInIfData = Boolean(Object.keys(globalThis.PAPERSCOPE_IF_DATA || {}).length);
  const DEFAULT_IF_COLOR_CONFIG = Object.freeze({ thresholds: [10, 5, 3], colors: ['#c0392b', '#e67e22', '#3273b8', '#607d8b'] });
  let ifColorConfig = DEFAULT_IF_COLOR_CONFIG;
  let initialized = false;
  let initializeTimer = null;

  chrome.storage.sync.get({ enabled: true, ifColorConfig: DEFAULT_IF_COLOR_CONFIG }, async ({ enabled, ifColorConfig: storedColorConfig }) => {
    if (!enabled) return;
    ifColorConfig = normalizeIfColorConfig(storedColorConfig);
    await loadCustomIfData();
    installIfChartTooltip();
    await initializePage();
    const observer = new MutationObserver(() => {
      clearTimeout(initializeTimer);
      initializeTimer = setTimeout(initializePage, 180);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  async function initializePage() {
    const records = [...document.querySelectorAll(CARD_SELECTOR)].map(parseCard).filter(Boolean);
    if (records.length && !document.querySelector('#paperscope-panel')) {
      initialized = true;
      mountPanel(records);
      await Promise.allSettled([
        Promise.allSettled(records.map(loadNote)),
        loadPublicationTypes(records)
      ]);
      updateCount(records);
      return;
    }
    if (initialized) return;
    const detailRecord = parseDetailPage();
    if (detailRecord && !document.querySelector('#paperscope-detail')) {
      initialized = true;
      await Promise.allSettled([loadNote(detailRecord), loadPublicationTypes([detailRecord])]);
      mountSimilarLiterature(detailRecord);
    }
  }

  async function loadCustomIfData() {
    const stored = await chrome.storage.local.get('paperscopeCustomIf');
    const imported = stored.paperscopeCustomIf;
    if (!imported?.records?.length || !imported?.aliases) return;
    customIfData = imported;
    activeIfYear = Number(imported.year) || activeIfYear;
  }

  function parseCard(card) {
    const titleLink = card.querySelector('.docsum-title, a[href^="/"][href$="/"]');
    const pmid = card.querySelector('.docsum-pmid')?.textContent.trim() || titleLink?.getAttribute('href')?.match(/^\/(\d+)\/?$/)?.[1];
    const title = titleLink?.textContent.replace(/\s+/g, ' ').trim();
    if (!pmid || !title) return null;
    const journalText = card.querySelector('.docsum-journal-citation')?.textContent.trim() || '';
    const journalName = extractJournalName(journalText);
    const journal = findJournal(journalName);
    const author = card.querySelector('.docsum-authors')?.textContent.replace(/\s+/g, ' ').trim() || '';
    return { card, pmid, title, author, journalName, journal, publicationType: 'Article', year: +(journalText.match(/\b(19|20)\d{2}\b/)?.[0] || 0) };
  }

  function parseDetailPage() {
    const titleElement = document.querySelector('h1.heading-title');
    const pmid = document.querySelector('meta[name="citation_pmid"]')?.content || location.pathname.match(/^\/(\d+)\/?$/)?.[1];
    if (!titleElement || !pmid) return null;
    const title = document.querySelector('meta[name="citation_title"]')?.content || titleElement.textContent.replace(/\s+/g, ' ').trim();
    const fullJournalName = document.querySelector('meta[name="citation_journal_title"]')?.content || '';
    const journalName = document.querySelector('.journal-actions-trigger')?.textContent.replace(/\s+/g, ' ').trim() || fullJournalName;
    const journal = findJournal(fullJournalName) || findJournal(journalName);
    const date = document.querySelector('meta[name="citation_date"]')?.content || '';
    const pageTypes = [...document.querySelectorAll('#publication-types .keyword-actions-trigger')].map((element) => element.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return {
      card: document.querySelector('main') || document.body,
      titleElement,
      isDetail: true,
      pmid,
      title,
      author: document.querySelector('meta[name="citation_author"]')?.content || '',
      journalName,
      journal,
      publicationType: choosePublicationType(pageTypes),
      year: +(date.match(/\b(19|20)\d{2}\b/)?.[0] || 0)
    };
  }

  async function loadPublicationTypes(records) {
    const ids = records.map((record) => record.pmid).join(',');
    if (!ids) return;
    const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
    url.searchParams.set('db', 'pubmed');
    url.searchParams.set('id', ids);
    url.searchParams.set('retmode', 'json');
    url.searchParams.set('tool', 'paperscope');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`NCBI ESummary ${response.status}`);
    const data = await response.json();
    records.forEach((record) => {
      const summary = data.result?.[record.pmid] || {};
      record.publicationType = choosePublicationType(summary.pubtype || []);
      record.journal = findJournal(summary.fulljournalname || '') || record.journal;
      record.author = summary.sortfirstauthor || summary.authors?.[0]?.name || record.author;
      record.citationSource = summary.fulljournalname || summary.source || record.journalName;
      record.citationDate = summary.pubdate || summary.epubdate || String(record.year || '');
      const badge = record.card.querySelector('.ps-type');
      if (badge) badge.textContent = record.publicationType;
      const journalFields = record.card.querySelector('.ps-journal-fields');
      if (journalFields) journalFields.innerHTML = renderJournalBadges(record);
    });
  }

  async function loadNote(record) {
    const stored = await chrome.storage.local.get(`paper:${record.pmid}`);
    const note = stored[`paper:${record.pmid}`] || {};
    if (note.tags && !record.isDetail) record.card.classList.add('ps-tagged');
    renderMeta(record, note);
  }

  function renderMeta(record, note) {
    if (record.card.querySelector('.ps-meta')) return;
    const meta = document.createElement('div');
    meta.className = record.isDetail ? 'ps-meta ps-detail-meta' : 'ps-meta';
    if (record.isDetail) meta.id = 'paperscope-detail';
    if (record.isDetail && note.tags) meta.classList.add('ps-detail-tagged');
    const hasNote = Boolean(note.note || note.tags);
    const noteLabel = hasNote ? '编辑笔记' : '添加笔记';
    meta.innerHTML = `<span class="ps-strip"><span class="ps-journal-fields">${renderJournalBadges(record)}</span><span class="ps-badge ps-year">${record.year || '年份未知'}</span><span class="ps-badge ps-type">${escapeHtml(record.publicationType)}</span></span><div class="ps-cite-wrap"><button class="ps-cite-button" type="button" title="一键引用" aria-label="一键引用">引用</button><div class="ps-cite-menu" hidden><button data-format="vancouver" type="button">复制 Vancouver</button><button data-format="apa" type="button">复制 APA</button><button data-format="gbt" type="button">复制 GB/T 7714</button></div></div><button class="ps-note-button${hasNote ? ' has-note' : ''}" type="button" aria-label="${noteLabel}" title="${noteLabel}"><svg viewBox="0 0 1024 1024" aria-hidden="true"><path d="M840.5 528.2 648.7 860.7 627.8 960l75.5-67.8L895 559.8l-54.5-31.6zm63.5-110-31.5 54.6 54.5 31.5 31.5-54.6-54.5-31.6zM128 896V249.7c9.9 3.4 20.5 5.3 31.5 5.3H768v356.9L832 500V255c0-35.3-28.7-64-64-64h-32V96c0-17.7-14.3-32-32-32H159.5C106.8 64 64 106.8 64 159.5V896c0 35.3 28.7 64 64 64h442.2l36.6-64H128zm31.5-768H672v63H159.5c-17.4 0-31.5-14.1-31.5-31.5s14.1-31.5 31.5-31.5zM768 827.5V896h-39.2l-36.6 64H768c35.3 0 64-28.7 64-64V715.7l-64 111.8z"/><path d="M640 384H256c-17.7 0-32 14.3-32 32s14.3 32 32 32h384c17.7 0 32-14.3 32-32s-14.3-32-32-32zM512 512H256c-17.7 0-32 14.3-32 32s14.3 32 32 32h256c17.7 0 32-14.3 32-32s-14.3-32-32-32z"/></svg></button>`;
    const editor = document.createElement('div');
    editor.className = 'ps-note-editor';
    editor.innerHTML = `<input class="ps-tags" placeholder="标签，逗号分隔" value="${escapeAttr(note.tags || '')}"><textarea class="ps-note" placeholder="使用 Markdown 记录这篇文献的要点…">${escapeHtml(note.note || '')}</textarea><button class="ps-note-save" type="button">保存到本机</button>`;
    meta.querySelector('.ps-note-button').addEventListener('click', () => editor.classList.toggle('open'));
    const citeButton = meta.querySelector('.ps-cite-button');
    const citeMenu = meta.querySelector('.ps-cite-menu');
    for (const [format, label] of [['endnote', 'EndNote（RIS）'], ['zotero', 'Zotero（RIS）'], ['noteexpress', 'NoteExpress（RIS）']]) {
      const option = document.createElement('button');
      option.type = 'button';
      option.dataset.format = format;
      option.textContent = `导出至 ${label}`;
      citeMenu.appendChild(option);
    }
    const citeStatus = document.createElement('span');
    citeStatus.className = 'ps-cite-status';
    citeStatus.setAttribute('role', 'status');
    meta.appendChild(citeStatus);
    citeButton.addEventListener('click', () => { citeMenu.hidden = !citeMenu.hidden; });
    citeMenu.querySelectorAll('button').forEach((button) => button.addEventListener('click', async () => {
      const exporting = ['endnote', 'zotero', 'noteexpress'].includes(button.dataset.format);
      citeMenu.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      citeStatus.textContent = exporting ? '正在获取完整题录…' : '';
      try {
        if (exporting) await exportReference(record, button.dataset.format);
        else await copyCitation(record, button.dataset.format);
        citeMenu.hidden = true;
        citeStatus.textContent = exporting ? '已生成 RIS 文件，请在对应软件中打开或导入（RIS）。' : '引用已复制';
      } catch (error) {
        citeStatus.textContent = `操作失败，请重试：${error.message}`;
      } finally {
        citeMenu.querySelectorAll('button').forEach((item) => { item.disabled = false; });
      }
    }));
    editor.querySelector('.ps-note-save').addEventListener('click', async () => {
      const value = { tags: editor.querySelector('.ps-tags').value.trim(), note: editor.querySelector('.ps-note').value.trim(), title: record.title, updatedAt: Date.now() };
      await chrome.storage.local.set({ [`paper:${record.pmid}`]: value });
      if (record.isDetail) meta.classList.toggle('ps-detail-tagged', Boolean(value.tags));
      else record.card.classList.toggle('ps-tagged', Boolean(value.tags));
      editor.classList.remove('open');
      const noteButton = meta.querySelector('.ps-note-button');
      const saved = Boolean(value.tags || value.note);
      const label = saved ? '编辑笔记' : '添加笔记';
      noteButton.classList.toggle('has-note', saved);
      noteButton.setAttribute('aria-label', label);
      noteButton.title = label;
    });
    const titleElement = record.titleElement || record.card.querySelector('.docsum-title');
    if (titleElement) titleElement.after(meta, editor);
    else (record.card.querySelector('.docsum-content') || record.card).prepend(meta, editor);
  }

  function mountPanel(records) {
    const panel = document.createElement('aside');
    panel.id = 'paperscope-panel';
    const maxIf = Math.max(10, Math.ceil(Math.max(...records.map((record) => Number(record.journal?.[0]) || 0))));
    const metricStatus = customIfData ? `IF ${activeIfYear} · 用户数据` : (hasBuiltInIfData ? `IF ${activeIfYear}` : '期刊指标未导入');
    panel.innerHTML = `<div class="ps-panel-head"><div><h3>智能筛选</h3><small>LitMedix · ${metricStatus}</small></div><strong class="ps-count">${records.length} / ${records.length} 篇</strong><button class="ps-collapse" type="button" aria-label="收起筛选窗口" aria-expanded="true" title="收起"></button></div><div class="ps-panel-body"><div class="ps-if-head"><label for="ps-min-if">最低 IF</label><output id="ps-min-if-value">0.0</output></div><input id="ps-min-if" class="ps-if-range" type="range" min="0" max="${maxIf}" step="0.5" value="0"><div class="ps-quartiles" role="group" aria-label="JCR 分区"><button class="active" data-quartile="" type="button">全部</button><button data-quartile="Q1" type="button">Q1</button><button data-quartile="Q2" type="button">Q2</button><button data-quartile="Q3" type="button">Q3</button><button data-quartile="Q4" type="button">Q4</button></div><details class="ps-advanced"><summary>更多筛选</summary><input id="ps-keyword" type="search" placeholder="标题关键词（自动高亮）"><select id="ps-sort"><option value="default">默认顺序</option><option value="if">按 IF 从高到低</option><option value="year">按年份从新到旧</option></select><label class="ps-toggle"><input id="ps-noted" type="checkbox"> 仅看已添加笔记</label></details><button id="ps-reset" class="ps-reset" type="button">重置筛选</button></div>`;
    document.body.appendChild(panel);
    enablePanelDragging(panel);
    restorePanelPosition(panel);
    const apply = () => applyFilters(records, panel);
    const range = panel.querySelector('#ps-min-if');
    const queryTerm = new URLSearchParams(location.search).get('term') || '';
    const simpleQuery = queryTerm.replace(/\[[^\]]+\]|\b(?:AND|OR|NOT)\b/gi, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim();
    if (simpleQuery && simpleQuery.length <= 70) panel.querySelector('#ps-keyword').value = simpleQuery;
    const updateRangeAppearance = () => {
      const progress = ((Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min))) * 100;
      range.style.setProperty('--ps-range-progress', `${progress}%`);
      panel.querySelector('#ps-min-if-value').textContent = Number(range.value).toFixed(1);
    };
    updateRangeAppearance();
    range.addEventListener('input', () => { updateRangeAppearance(); apply(); });
    panel.querySelectorAll('.ps-quartiles button').forEach((button) => button.addEventListener('click', () => {
      panel.querySelectorAll('.ps-quartiles button').forEach((item) => item.classList.toggle('active', item === button));
      apply();
    }));
    panel.querySelector('#ps-keyword').addEventListener('input', apply);
    panel.querySelector('#ps-sort').addEventListener('change', apply);
    panel.querySelector('#ps-noted').addEventListener('change', apply);
    panel.querySelector('.ps-collapse').addEventListener('click', (event) => {
      const collapsed = panel.classList.toggle('collapsed');
      event.currentTarget.title = collapsed ? '展开' : '收起';
      event.currentTarget.setAttribute('aria-label', collapsed ? '展开筛选窗口' : '收起筛选窗口');
      event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    });
    panel.querySelector('#ps-reset').addEventListener('click', () => {
      range.value = '0';
      updateRangeAppearance();
      panel.querySelector('#ps-keyword').value = '';
      panel.querySelector('#ps-noted').checked = false;
      panel.querySelector('#ps-sort').value = 'default';
      panel.querySelectorAll('.ps-quartiles button').forEach((button) => button.classList.toggle('active', button.dataset.quartile === ''));
      records.sort((a, b) => a.index - b.index).forEach((record) => { record.card.classList.remove('ps-hidden'); record.card.parentElement?.appendChild(record.card); });
      updateCount(records);
    });
    records.forEach((record, index) => { record.index = index; });
    apply();
    updateCount(records);
  }

  async function restorePanelPosition(panel) {
    const { litmedixFilterPosition } = await chrome.storage.local.get('litmedixFilterPosition');
    if (!litmedixFilterPosition) return;
    placePanel(panel, litmedixFilterPosition.left, litmedixFilterPosition.top);
  }

  function placePanel(panel, left, top) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - panel.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - panel.offsetHeight - margin);
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${Math.min(Math.max(margin, Number(left) || margin), maxLeft)}px`;
    panel.style.top = `${Math.min(Math.max(margin, Number(top) || margin), maxTop)}px`;
  }

  function enablePanelDragging(panel) {
    const handle = panel.querySelector('.ps-panel-head');
    let drag = null;
    handle.title = '拖动移动筛选框；双击恢复默认位置';
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      placePanel(panel, event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    });
    const finishDrag = async (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      panel.classList.remove('dragging');
      const rect = panel.getBoundingClientRect();
      await chrome.storage.local.set({ litmedixFilterPosition: { left: Math.round(rect.left), top: Math.round(rect.top) } });
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('dblclick', async (event) => {
      if (event.target.closest('button')) return;
      panel.removeAttribute('style');
      await chrome.storage.local.remove('litmedixFilterPosition');
    });
    window.addEventListener('resize', () => {
      if (panel.style.left) placePanel(panel, parseFloat(panel.style.left), parseFloat(panel.style.top));
    });
  }

  function applyFilters(records, panel = document.querySelector('#paperscope-panel')) {
    const keyword = panel.querySelector('#ps-keyword').value.trim().toLowerCase();
    const minIfInput = panel.querySelector('#ps-min-if').value;
    const minIf = +(minIfInput || 0);
    const quartile = panel.querySelector('.ps-quartiles button.active')?.dataset.quartile || '';
    const notedOnly = panel.querySelector('#ps-noted').checked;
    const sort = panel.querySelector('#ps-sort').value;
    records.forEach((record) => record.card.classList.toggle('ps-hidden', Boolean(
      (keyword && !record.title.toLowerCase().includes(keyword)) ||
      (minIf > 0 && (record.journal?.[0] ?? -1) < minIf) ||
      (quartile && record.journal?.[1] !== quartile) ||
      (notedOnly && !record.card.classList.contains('ps-tagged'))
    )));
    highlightTitles(records, keyword);
    if (sort !== 'default') {
      records.slice().sort((a, b) => sort === 'if' ? (b.journal?.[0] ?? -1) - (a.journal?.[0] ?? -1) : b.year - a.year).forEach((record) => record.card.parentElement?.appendChild(record.card));
    }
    updateCount(records);
  }

  function updateCount(records) {
    const visible = records.filter((record) => !record.card.classList.contains('ps-hidden')).length;
    const target = document.querySelector('.ps-count');
    if (target) target.textContent = `${visible} / ${records.length} 篇`;
  }
  function highlightTitles(records, keyword) {
    const terms = keyword.split(/\s+/).filter((term) => term.length > 1).slice(0, 6);
    records.forEach((record) => {
      const element = record.titleElement || record.card.querySelector('.docsum-title');
      if (!element) return;
      const text = record.title || element.textContent.trim();
      if (!terms.length) { element.textContent = text; return; }
      const pattern = new RegExp(`(${terms.map(escapeRegex).join('|')})`, 'gi');
      element.innerHTML = escapeHtml(text).replace(pattern, '<mark class="ps-title-highlight">$1</mark>');
    });
  }
  function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function extractJournalName(citation) { return citation.replace(/\.\s+(?=(?:19|20)\d{2}\b)[\s\S]*$/, '').replace(/\s+(?=(?:19|20)\d{2}\b)[\s\S]*$/, '').trim(); }
  function findJournal(name) {
    const key = normalizeJournal(name);
    const customIndex = customIfData?.aliases?.[key];
    if (Number.isInteger(customIndex) && customIfData.records[customIndex]) return customIfData.records[customIndex];
    const data = globalThis.PAPERSCOPE_IF_DATA || {};
    if (data[key]) return data[key];
    const fullNames = globalThis.PAPERSCOPE_IF_FULL_NAMES || [];
    for (const fullName of fullNames) {
      if (key.length > fullName.length && key.startsWith(fullName)) return data[fullName] || null;
    }
    const aliases = globalThis.PAPERSCOPE_IF_ABBREVIATIONS || [];
    for (const alias of aliases) {
      const extraLength = key.length - alias.length;
      if (extraLength >= 1 && extraLength <= 8 && key.startsWith(alias)) return data[alias] || null;
    }
    const tokenOwner = (globalThis.PAPERSCOPE_IF_TOKEN_ALIASES || {})[journalTokenSignature(name)];
    if (tokenOwner) return data[tokenOwner] || null;
    return null;
  }
  function renderJournalBadges(record) {
    if (!record.journal) return `<span class="ps-badge ps-no-if" title="Excel 数据中未匹配该期刊">${escapeHtml(record.journalName || '期刊未知')} · 暂无 IF</span>`;
    const history = Array.isArray(record.journal[5]) ? record.journal[5] : [];
    const years = record.journal[4] === 'USER'
      ? (customIfData?.years || [])
      : (globalThis.PAPERSCOPE_IF_META?.years || [2021, 2022, 2023, 2024, 2025]);
    const historyTitle = history.map((value, index) => value == null ? null : `${years[index]} IF: ${value}`).filter(Boolean).join(' | ');
    const quartile = record.journal[1]
      ? `<span class="ps-badge ps-${String(record.journal[1]).toLowerCase()}">${escapeHtml(record.journal[1])}</span>`
      : '';
    const displayIf = record.journal[6] || record.journal[0];
    const sourceTitle = record.journal[4] === 'USER'
      ? ([`${activeIfYear} 影响因子 · 用户导入`, historyTitle].filter(Boolean).join(' | '))
      : (historyTitle || `${activeIfYear} 影响因子`);
    const historyPayload = escapeAttr(JSON.stringify({ years, values: history, currentYear: activeIfYear, currentValue: displayIf, source: record.journal[4] === 'USER' ? '用户导入' : '内置数据' }));
    const journalColor = colorForIf(record.journal[0]);
    return `<span class="ps-badge ps-journal" style="background:${journalColor}" title="${escapeAttr(record.journal[2])}">${escapeHtml(record.journalName || record.journal[2])}</span><span class="ps-badge ps-if" data-ps-history="${historyPayload}" aria-label="${escapeAttr(sourceTitle)}" tabindex="0">${escapeHtml(displayIf)}</span>${quartile}`;
  }
  function normalizeIfColorConfig(value) {
    const thresholds = Array.isArray(value?.thresholds) ? value.thresholds.map(Number) : [];
    const colors = Array.isArray(value?.colors) ? value.colors.map(String) : [];
    if (thresholds.length !== 3 || colors.length !== 4 || thresholds.some((item) => !Number.isFinite(item)) || colors.some((item) => !/^#[0-9a-f]{6}$/i.test(item)) || !(thresholds[0] > thresholds[1] && thresholds[1] > thresholds[2])) return DEFAULT_IF_COLOR_CONFIG;
    return { thresholds, colors };
  }
  function colorForIf(rawIf) {
    const value = Number(rawIf);
    const [high, medium, low] = ifColorConfig.thresholds;
    const [highColor, mediumColor, lowColor, baseColor] = ifColorConfig.colors;
    if (value >= high) return highColor;
    if (value >= medium) return mediumColor;
    if (value >= low) return lowColor;
    return baseColor;
  }
  function installIfChartTooltip() {
    if (document.querySelector('#ps-if-chart-tooltip')) return;
    const tooltip = document.createElement('div');
    tooltip.id = 'ps-if-chart-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
    const show = (badge) => {
      let payload;
      try { payload = JSON.parse(badge.dataset.psHistory || '{}'); } catch { return; }
      const years = Array.isArray(payload.years) ? payload.years : [];
      const values = Array.isArray(payload.values) ? payload.values : [];
      const points = years.map((year, index) => ({ year, raw: values[index], value: chartNumber(values[index]) })).filter((point) => point.value != null);
      if (!points.length) return;
      tooltip.innerHTML = renderIfChart(points, payload);
      tooltip.classList.add('visible');
      positionIfTooltip(tooltip, badge);
    };
    document.addEventListener('mouseover', (event) => {
      const badge = event.target.closest?.('.ps-if[data-ps-history]');
      if (badge) show(badge);
    });
    document.addEventListener('mouseout', (event) => {
      const badge = event.target.closest?.('.ps-if[data-ps-history]');
      if (badge && !badge.contains(event.relatedTarget)) tooltip.classList.remove('visible');
    });
    document.addEventListener('focusin', (event) => {
      const badge = event.target.closest?.('.ps-if[data-ps-history]');
      if (badge) show(badge);
    });
    document.addEventListener('focusout', (event) => {
      if (event.target.matches?.('.ps-if[data-ps-history]')) tooltip.classList.remove('visible');
    });
    window.addEventListener('scroll', () => tooltip.classList.remove('visible'), { passive: true });
  }
  function chartNumber(value) {
    if (value == null || value === '') return null;
    const lessThan = String(value).match(/^<\s*(\d+(?:\.\d+)?)$/);
    const number = lessThan ? Number(lessThan[1]) / 2 : Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function renderIfChart(points, payload) {
    const width = 286, height = 126, left = 34, right = 12, top = 22, bottom = 25;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const max = Math.max(...points.map((point) => point.value), 0.1);
    const x = (index) => left + (points.length === 1 ? plotWidth / 2 : index * plotWidth / (points.length - 1));
    const y = (value) => top + plotHeight - (value / max) * plotHeight;
    const coords = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(' ');
    const grid = [0, .5, 1].map((ratio) => `<line x1="${left}" y1="${top + plotHeight * ratio}" x2="${width - right}" y2="${top + plotHeight * ratio}"/>`).join('');
    const marks = points.map((point, index) => `<g><circle cx="${x(index)}" cy="${y(point.value)}" r="4"/><text class="ps-chart-value" x="${x(index)}" y="${Math.max(12, y(point.value) - 8)}">${escapeHtml(point.raw)}</text><text class="ps-chart-year" x="${x(index)}" y="${height - 6}">${escapeHtml(point.year)}</text></g>`).join('');
    return `<div class="ps-chart-head"><div><strong>历年影响因子</strong><small>${escapeHtml(payload.source || '')}</small></div><b>${escapeHtml(payload.currentYear)} · ${escapeHtml(payload.currentValue)}</b></div><svg class="ps-if-chart" viewBox="0 0 ${width} ${height}" aria-label="历年影响因子折线图"><g class="ps-chart-grid">${grid}</g><polyline points="${coords}"/><g class="ps-chart-marks">${marks}</g></svg>`;
  }
  function positionIfTooltip(tooltip, badge) {
    const rect = badge.getBoundingClientRect();
    const width = 310;
    const left = Math.min(Math.max(10, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 10);
    const height = tooltip.offsetHeight || 190;
    const top = rect.top - height - 10 >= 8 ? rect.top - height - 10 : rect.bottom + 10;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }
  async function exportReference(record, application) {
    if (!record.risExport) {
      const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi');
      url.search = new URLSearchParams({ db: 'pubmed', id: record.pmid, retmode: 'xml' });
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`NCBI ${response.status}`);
      const doc = new DOMParser().parseFromString(await response.text(), 'text/xml');
      const article = [...doc.querySelectorAll('PubmedArticle')].find((item) => item.querySelector('MedlineCitation > PMID')?.textContent.trim() === record.pmid);
      if (doc.querySelector('parsererror') || !article) throw new Error('未获取到该文献的完整题录');
      const value = (selector) => article.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() || '';
      const authors = [...article.querySelectorAll('Article > AuthorList > Author')].map((author) => {
        const surname = author.querySelector('LastName')?.textContent || '';
        const given = author.querySelector('ForeName')?.textContent || author.querySelector('Initials')?.textContent || '';
        return surname ? `${surname}${given ? ', ' + given : ''}` : author.querySelector('CollectiveName')?.textContent || '';
      }).filter(Boolean);
      const date = value('JournalIssue > PubDate > Year') || value('JournalIssue > PubDate > MedlineDate');
      const pages = value('Pagination > StartPage') || value('Pagination > MedlinePgn');
      record.risExport = globalThis.LitMedixRIS.serialize({
        title: value('Article > ArticleTitle'), authors,
        journal: value('Journal > Title'), abbreviation: value('Journal > ISOAbbreviation'),
        year: date.match(/\d{4}/)?.[0] || '', volume: value('JournalIssue > Volume'), issue: value('JournalIssue > Issue'),
        startPage: pages.split('-')[0], endPage: value('Pagination > EndPage') || pages.split('-').slice(1).join('-'),
        doi: value('PubmedData ArticleId[IdType="doi"]'), issn: value('Journal > ISSN'), pmid: record.pmid,
        abstract: [...article.querySelectorAll('Article > Abstract > AbstractText')].map((node) => `${node.getAttribute('Label') ? node.getAttribute('Label') + ': ' : ''}${node.textContent}`).join(' '),
        keywords: [...article.querySelectorAll('KeywordList > Keyword')].map((node) => node.textContent)
      });
    }
    const url = URL.createObjectURL(new Blob([record.risExport], { type: 'application/x-research-info-systems;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `LitMedix-${record.pmid}-${application}.ris`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function copyCitation(record, format) {
    const author = record.author || 'Unknown author';
    const year = record.year || record.citationDate?.match(/(19|20)\d{2}/)?.[0] || 'n.d.';
    const source = record.citationSource || record.journalName || 'PubMed';
    const url = `https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`;
    const citation = format === 'apa'
      ? `${author} (${year}). ${record.title}. ${source}. ${url}`
      : format === 'gbt'
        ? `${author}. ${record.title}[J]. ${source}, ${year}. PMID: ${record.pmid}.`
        : `${author}. ${record.title}. ${source}. ${year}. PMID: ${record.pmid}.`;
    await navigator.clipboard.writeText(citation);
  }
  function mountSimilarLiterature(record) {
    if (document.querySelector('#ps-similar-literature')) return;
    const section = document.createElement('section');
    section.id = 'ps-similar-literature';
    section.className = 'ps-similar-literature';
    section.innerHTML = `<div class="ps-similar-head"><div><strong>相似文献增强</strong><small>按已导入期刊 IF 排序</small></div><button type="button">加载相似文献</button></div><div class="ps-similar-results">点击加载后，显示最多 8 篇相似文献。</div>`;
    const nativeSimilar = document.querySelector('#similar');
    const heading = nativeSimilar?.querySelector('h2');
    if (heading) heading.after(section);
    else if (nativeSimilar) nativeSimilar.prepend(section);
    else {
      // Some records have no native similar-articles section.
      const abstract = document.querySelector('#abstract');
      const anchor = abstract || document.querySelector('#paperscope-detail');
      if (!anchor) return;
      anchor.after(section);
    }
    section.querySelector('small').textContent = '从前 30 篇相似文献中按已导入 IF 排序，显示最多 8 篇';
    section.querySelector('button').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const target = section.querySelector('.ps-similar-results');
      button.disabled = true;
      button.textContent = '正在加载…';
      target.textContent = '正在从 PubMed 获取相似文献…';
      try {
        const ids = await getSimilarPmids(record.pmid);
        if (!ids.length) {
          target.textContent = 'PubMed 暂未返回相似文献。下方原有列表仍可正常使用。';
          button.textContent = '重新加载';
          return;
        }
        const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi');
        url.searchParams.set('db', 'pubmed');
        url.searchParams.set('id', ids.slice(0, 30).join(','));
        url.searchParams.set('retmode', 'json');
        const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`NCBI ESummary ${response.status}`);
        const data = await response.json();
        if (data.error || !data.result) throw new Error(data.error || 'NCBI 未返回文献详情');
        const articles = ids.map((id) => data.result?.[id]).filter(Boolean).map((item) => {
          const journal = findJournal(item.fulljournalname || item.source || '');
          return { id: item.uid, title: item.title || `PMID ${item.uid}`, journal, source: item.source || item.fulljournalname || '', year: item.pubdate?.match(/(19|20)\d{2}/)?.[0] || '' };
        }).sort((a, b) => (b.journal?.[0] ?? -1) - (a.journal?.[0] ?? -1)).slice(0, 8);
        if (!articles.length) throw new Error('未获取到相似文献详情，请稍后重试');
        target.innerHTML = articles.map((item) => `<a href="https://pubmed.ncbi.nlm.nih.gov/${item.id}/" target="_blank" rel="noopener"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.source)} · ${escapeHtml(item.year)} · ${item.journal ? `IF ${escapeHtml(item.journal[6] || item.journal[0])}` : '暂无 IF'}</span></a>`).join('');
        button.textContent = '重新加载';
      } catch (error) {
        target.textContent = `加载失败：${error.message}。`;
        button.textContent = '重试';
      } finally { button.disabled = false; }
    });
  }
  async function getSimilarPmids(pmid) {
    const url = new URL('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi');
    url.searchParams.set('dbfrom', 'pubmed');
    url.searchParams.set('db', 'pubmed');
    url.searchParams.set('id', pmid);
    url.searchParams.set('cmd', 'neighbor_score');
    url.searchParams.set('linkname', 'pubmed_pubmed');
    url.searchParams.set('retmode', 'json');
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`NCBI ELink ${response.status}`);
    const data = await response.json();
    return globalThis.LitMedixLinks.parse(data, pmid);
  }
  function choosePublicationType(types) {
    const values = Array.isArray(types) ? types : [];
    const priorities = ['Meta-Analysis', 'Systematic Review', 'Randomized Controlled Trial', 'Clinical Trial', 'Observational Study', 'Clinical Study', 'Multicenter Study', 'Comparative Study', 'Evaluation Study', 'Validation Study', 'Case Reports', 'Practice Guideline', 'Guideline', 'Review', 'Editorial', 'Letter', 'Comment', 'Preprint'];
    for (const preferred of priorities) {
      const match = values.find((value) => value === preferred || value.startsWith(`${preferred},`));
      if (match) return match;
    }
    return values.find((value) => value !== 'Journal Article' && !value.startsWith('Research Support')) || 'Article';
  }
  function normalizeJournal(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function journalTokenSignature(value) {
    const stopWords = new Set(['A', 'AN', 'AND', 'DE', 'DER', 'DES', 'DI', 'EL', 'ET', 'FOR', 'LA', 'LE', 'OF', 'THE', 'UND', 'Y']);
    const tokens = String(value || '').toUpperCase().match(/[A-Z0-9]+/g) || [];
    const parts = tokens.filter((token) => !stopWords.has(token)).map((token) => {
      if (token === 'J' || token === 'JOURNAL') return 'J';
      return token.length <= 3 ? token : token.slice(0, 3);
    });
    return parts.length >= 3 ? parts.join('') : '';
  }
  function escapeHtml(value) { const element = document.createElement('div'); element.textContent = value; return element.innerHTML; }
  function escapeAttr(value) { return escapeHtml(value).replace(/"/g, '&quot;'); }
})();
