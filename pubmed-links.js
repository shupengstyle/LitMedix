globalThis.LitMedixLinks = Object.freeze({
  parse(data, sourcePmid) {
    if (data?.error || data?.ERROR) throw new Error(String(data.error || data.ERROR));
    if (!Array.isArray(data?.linksets)) throw new Error('NCBI 相似文献响应格式异常');
    const ids = [];
    for (const set of data.linksets) {
      if (set.error) throw new Error(String(set.error));
      for (const group of set.linksetdbs || []) {
        // References and cited-by links are not similar articles.
        if (group.dbto !== 'pubmed' || group.linkname !== 'pubmed_pubmed') continue;
        for (const link of group.links || []) {
          const id = String(typeof link === 'object' && link !== null ? link.id : link);
          if (/^\d+$/.test(id) && id !== String(sourcePmid)) ids.push(id);
        }
      }
    }
    return [...new Set(ids)];
  }
});
