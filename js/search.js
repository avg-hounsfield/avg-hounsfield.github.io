import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.esm.js';

let fuse;
export function initFuzzy(data) {
  fuse = new Fuse(data, {
    includeScore: true,
    threshold: 0.4,           // Increased threshold for more matches
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'study', weight: 2 },
      { name: 'indications', weight: 1.5 },
      { name: 'sequences', weight: 1 },
      { name: 'category', weight: 0.5 },
      { name: 'contrastRationale', weight: 0.5 } // Added this field
    ]
  });
  
  // Log for debugging
  console.log('Fuzzy search initialized with data:', data);
}

export function fuzzySearch(query) {
  if (!fuse || !query.trim()) return [];
  const results = fuse.search(query).map(r => r.item);
  console.log(`Fuzzy search for "${query}" returned:`, results);
  return results;
}