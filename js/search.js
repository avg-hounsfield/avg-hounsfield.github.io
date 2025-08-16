// Lunr.js will be loaded via script tag in HTML
// This ensures it's available as a global variable

let lunrIndex;
let documentsById = new Map();
let lastData = [];

export function initFuzzy(data) {
  if (!Array.isArray(data)) {
    throw new Error('initFuzzy requires an array of data');
  }
  
  if (data.length === 0) {
    console.warn('initFuzzy called with empty data array');
  }
  
  console.log('Initializing Lunr search with', data.length, 'documents');
  lastData = data;
  documentsById.clear();
  
  try {
    // Wait for Lunr to be available
    if (typeof lunr === 'undefined') {
      // If Lunr is not yet loaded, wait a bit and try again (max 10 attempts)
      let attempts = 0;
      const checkLunr = () => {
        attempts++;
        if (typeof lunr !== 'undefined') {
          initFuzzy(data);
        } else if (attempts < 10) {
          setTimeout(checkLunr, 100);
        } else {
          throw new Error('Lunr.js failed to load after 1 second');
        }
      };
      setTimeout(checkLunr, 100);
      return;
    }
    
          // Build Lunr index with enhanced configuration
      console.log('Building Lunr index...');
      lunrIndex = lunr(function () {
      // Configure the index
      this.ref('id');
      
      // Configure pipeline - remove unnecessary processing for medical terms
      this.pipeline.remove(lunr.stemmer);
      this.searchPipeline.remove(lunr.stemmer);
      
      // Define fields with boost values (equivalent to Fuse.js weights)
      this.field('study', { boost: 2.5 });
      this.field('sequences', { boost: 2.0 });
      this.field('indications', { boost: 1.5 });
      this.field('contrastRationale', { boost: 1.0 });
      this.field('scannerNotes', { boost: 1.8 });
      this.field('section', { boost: 1.5 });
      
      // Add documents to the index
      data.forEach((doc, index) => {
        const searchDoc = {
          id: index,
          study: extractStudy(doc),
          sequences: extractSequences(doc),
          indications: extractIndications(doc),
          contrastRationale: extractContrastRationale(doc),
          scannerNotes: extractScannerNotes(doc),
          section: extractSection(doc)
        };
        
        // Validate document has content
        const hasContent = Object.values(searchDoc).some(field => field && field.length > 0);
        if (hasContent) {
          // Store the document for retrieval
          documentsById.set(index, doc);
          
          // Add to Lunr index
          this.add(searchDoc);
        }
      });
    });
    
    console.log('Lunr index built successfully with', documentsById.size, 'documents');
    
  } catch (error) {
    console.error('Error initializing Lunr search:', error);
    throw error;
  }
}

// Helper functions to extract searchable content from documents
function extractStudy(obj) {
  return obj.study ? obj.study.toLowerCase() : '';
}

function extractSequences(obj) {
  const sequences = obj.layout?.leftCard?.sequences || [];
  return sequences.map(s => s.sequence?.toLowerCase?.() || '').join(' ');
}

function extractIndications(obj) {
  return obj.layout?.rightCard?.content?.indications?.toLowerCase() || '';
}

function extractContrastRationale(obj) {
  return obj.layout?.rightCard?.content?.contrastRationale?.toLowerCase() || '';
}

function extractScannerNotes(obj) {
  const scannerNotes = obj.layout?.rightCard?.content?.scannerSpecificNotes;
  if (!scannerNotes || typeof scannerNotes !== 'object') return '';
  
  // Extract all sequences from all scanner types
  const allSequences = [];
  Object.values(scannerNotes).forEach(sequences => {
    if (Array.isArray(sequences)) {
      sequences.forEach(seq => {
        if (seq.sequence) {
          allSequences.push(seq.sequence.toLowerCase());
        }
      });
    }
  });
  return allSequences.join(' ');
}

function extractSection(obj) {
  const section = obj.section;
  if (typeof section === 'string') {
    return section.toLowerCase();
  }
  if (Array.isArray(section)) {
    return section.map(s => s.toLowerCase()).join(' ');
  }
  return '';
}

function preprocessQuery(query) {
  // Convert to lowercase and trim
  query = query.toLowerCase().trim();
  
  // Split into words and filter out short words
  const words = query.split(/\s+/).filter(word => word.length > 1);
  
  // Remove common stop words that might interfere with search
  const stopWords = ['and', 'or', 'with', 'without', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'a', 'an'];
  const filteredWords = words.filter(word => !stopWords.includes(word));
  
  // If we filtered out all words, use the original words
  if (filteredWords.length === 0) {
    return words.join(' ');
  }
  
  return filteredWords.join(' ');
}

export function fuzzySearch(query) {
  if (!lunrIndex || !query.trim()) return [];
  
  if (typeof lunr === 'undefined') {
    console.warn('Lunr.js not yet loaded');
    return [];
  }
  
  const processedQuery = preprocessQuery(query);
  console.log('Searching for:', query, '→', processedQuery);
  
  try {
    let results = [];
    const terms = processedQuery.split(' ').filter(term => term.length > 0);
    
    // Strategy 1: Exact phrase search for multi-word queries
    if (terms.length > 1) {
      const phraseQuery = `"${processedQuery}"`;
      results = lunrIndex.search(phraseQuery);
    }
    
    // Strategy 2: Standard search if no phrase results or single word
    if (results.length === 0) {
      results = lunrIndex.search(processedQuery);
    }
    
    // Strategy 3: Wildcard search for partial matches
    if (results.length === 0 && processedQuery.length > 2) {
      const wildcardQuery = terms.map(term => `${term}*`).join(' ');
      results = lunrIndex.search(wildcardQuery);
    }
    
    // Strategy 4: Boost search for individual terms
    if (results.length === 0 && terms.length > 1) {
      const boostQuery = terms.map(term => `${term}^2`).join(' ');
      results = lunrIndex.search(boostQuery);
    }
    
    // Strategy 5: Fuzzy search with edit distance for typos
    if (results.length === 0 && processedQuery.length > 3) {
      const fuzzyQuery = terms.map(term => `${term}~1`).join(' ');
      results = lunrIndex.search(fuzzyQuery);
    }
    
    // Strategy 6: Very fuzzy search as last resort
    if (results.length === 0 && processedQuery.length > 4) {
      const veryFuzzyQuery = terms.map(term => `${term}~2`).join(' ');
      results = lunrIndex.search(veryFuzzyQuery);
    }
    
    // Convert Lunr results to documents and sort by score (descending)
    const items = results
      .filter(result => result.score > 0.1) // Filter out very low scores
      .sort((a, b) => b.score - a.score) // Lunr scores are higher = better (opposite of Fuse)
      .map(result => {
        const doc = documentsById.get(parseInt(result.ref));
        return doc;
      })
      .filter(Boolean) // Remove any undefined documents
      .slice(0, 50); // Limit results to top 50 for performance
    
    return items;
  } catch (error) {
    console.error('Error in Lunr search:', error);
    return [];
  }
}

function matchesSection(protocol, querySection) {
  // If the protocol has no sections, it can't match
  if (!protocol.section || !Array.isArray(protocol.section)) {
    return false;
  }

  // Check if any of the protocol's sections match the querySection
  for (const section of protocol.section) {
    if (typeof section === 'string' && section.toLowerCase() === querySection.toLowerCase()) {
      return true;
    }
  }

  return false;
}