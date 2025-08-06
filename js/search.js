import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@6.6.2/dist/fuse.esm.js';

let fuse;
let lastData = [];

export function initFuzzy(data) {
  lastData = data;
  fuse = new Fuse(data, {
    includeScore: true,
    threshold: 0.3,           // Stricter matching (lower = more exact matches required)
    ignoreLocation: false,    // Consider the location of matches
    location: 0,             // Prefer matches at the start of fields
    distance: 100,           // How far to look for matches
    minMatchCharLength: 3,    // Require longer matches
    useExtendedSearch: true, // Enable extended search operators
    findAllMatches: false,   // Stop after finding first match per field
    keys: [
      { 
        name: 'study', 
        weight: 2.5,
        getFn: (obj) => obj.study ? obj.study.toLowerCase() : null 
      },
      { 
        name: 'layout.leftCard.sequences.sequence', 
        weight: 2.0,
        getFn: (obj) => {
          const sequences = obj.layout?.leftCard?.sequences || [];
          return sequences.map(s => s.sequence?.toLowerCase?.() || '');
        }
      },
      { 
        name: 'layout.rightCard.content.indications', 
        weight: 1.5,
        getFn: (obj) => obj.layout?.rightCard?.content?.indications?.toLowerCase() || null
      },
      { 
        name: 'layout.rightCard.content.contrastRationale', 
        weight: 1.0,
        getFn: (obj) => obj.layout?.rightCard?.content?.contrastRationale?.toLowerCase() || null
      },
      {
        name: 'section',
        weight: 1.5,
        getFn: (obj) => Array.isArray(obj.section) ? obj.section.map(s => s.toLowerCase()) : []
      }
    ]
  });
}

function preprocessQuery(query) {
  // Convert to lowercase
  query = query.toLowerCase().trim();
  
  // Split into words
  const words = query.split(/\s+/).filter(word => word.length > 1);
  
  // For single word queries, search as is
  if (words.length === 1) {
    return query;
  }
  
  // For multi-word queries, construct a more precise search expression
  const searchExpression = words.map(word => {
    // Skip common words
    if (['and', 'or', 'with', 'without', 'the', 'in', 'on', 'at'].includes(word)) {
      return null;
    }
    return `'${word}`;  // Exact word match using Fuse.js extended search
  }).filter(Boolean).join(' ');
  
  return searchExpression;
}

// Accepts optional data argument for searching a specific array
export function fuzzySearch(query, dataOverride) {
  if ((!fuse && !dataOverride) || !query.trim()) return [];
  
  const processedQuery = preprocessQuery(query);
  let searchFuse = fuse;
  if (dataOverride) {
    // If dataOverride is provided, create a temporary Fuse instance for this search
    searchFuse = new Fuse(dataOverride, fuse.options);
  }
  try {
    // Search with the processed query
    let results = searchFuse.search(processedQuery);
    
    // Filter out low-scoring results
    results = results.filter(result => result.score < 0.5);
    
    // Sort by score
    results.sort((a, b) => a.score - b.score);
    
    // Extract just the items
    const items = results.map(r => r.item);
    
    return items;
  } catch (error) {
    console.error('Error in fuzzy search:', error);
    return [];
  }
}