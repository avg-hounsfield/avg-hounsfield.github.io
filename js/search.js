import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.esm.js';

let fuse;
export function initFuzzy(data) {
  fuse = new Fuse(data, {
    includeScore: true,
    threshold: 0.3,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'study', weight: 2 },
      { name: 'sequences.type', weight: 1 },
      { name: 'sequences.note', weight: 0.5 },
      { name: 'category', weight: 0.5 }
    ]
  });
}

export function fuzzySearch(query) {
  if (!fuse || !query.trim()) return [];
  return fuse.search(query).map(r => r.item);
}