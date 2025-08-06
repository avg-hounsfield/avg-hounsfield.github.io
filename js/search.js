import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.esm.js';

let fuse;
export function initFuzzy(data) {
  // Debug log
  console.log('Initializing fuzzy search with data:', data);

  fuse = new Fuse(data, {
    includeScore: true,
    threshold: 0.6,           // More lenient matching
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'study', weight: 2.0 },
      { name: 'Indications', weight: 1.5 },
      { name: 'sequences.sequence', weight: 1.0 },
      { name: 'scanner', weight: 0.5 },
      { name: 'Contrast rationale:', weight: 0.5 }
    ]
  });
}

export function fuzzySearch(query) {
  if (!fuse || !query.trim()) return [];
  
  console.log('Searching with query:', query);
  
  // Make sure we return the items array
  const results = fuse.search(query).map(r => r.item);
  
  console.log('Search returned:', results);
  
  // Ensure we're returning an array
  return Array.isArray(results) ? results : [];
}