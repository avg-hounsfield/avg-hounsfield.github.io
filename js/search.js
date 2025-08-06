import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.esm.js';

let fuse;
export function initFuzzy(data) {
  fuse = new Fuse(data, {
    includeScore: true,
    threshold: 0.4,           // More lenient matching
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'study', weight: 2.0 },
      { name: 'indications', weight: 1.5 },
      { name: 'sequences', weight: 1.5 },
      { name: 'category', weight: 1.0 },
      { name: 'contrastRationale', weight: 1.0 }
    ]
  });

  // Debug log
  console.log('Search initialized with data:', data);
}

export function fuzzySearch(query) {
  if (!fuse || !query.trim()) return [];
  
  // Debug log
  console.log('Searching for:', query);
  
  const results = fuse.search(query).map(r => r.item);
  
  // Debug log
  console.log('Search results:', results);
  
  return results;
}