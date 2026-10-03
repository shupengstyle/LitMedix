// UTF-8 RIS shared by EndNote, Zotero and NoteExpress.
globalThis.LitMedixRIS = Object.freeze({
  serialize(record) {
    const lines = ['TY  - JOUR'];
    const add = (tag, raw) => {
      const value = String(raw ?? '').replace(/\s+/g, ' ').trim();
      if (value) lines.push(`${tag}  - ${value}`);
    };
    add('TI', record.title);
    (record.authors || []).forEach((author) => add('AU', author));
    for (const [tag, field] of [['JF', 'journal'], ['JA', 'abbreviation'], ['PY', 'year'], ['VL', 'volume'], ['IS', 'issue'], ['SP', 'startPage'], ['EP', 'endPage'], ['DO', 'doi'], ['SN', 'issn'], ['AB', 'abstract']]) add(tag, record[field]);
    (record.keywords || []).forEach((keyword) => add('KW', keyword));
    add('AN', record.pmid);
    add('DB', 'PubMed');
    if (record.pmid) add('UR', `https://pubmed.ncbi.nlm.nih.gov/${record.pmid}/`);
    lines.push('ER  -', '');
    return lines.join('\r\n');
  }
});
