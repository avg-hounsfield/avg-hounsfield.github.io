// js/main.js - FINAL VERSION

import { initFuzzy, fuzzySearch } from './search.js';

let protocolData = [];
const DEBOUNCE_DELAY = 300; // Delay for real-time search

// Function to debounce the search
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function runSearchAndRender() {
  const searchInput = document.getElementById('searchInput');
  const resultsContainer = document.getElementById('results');
  const query = searchInput.value.trim();

  // Debug logs
  console.log('Running search with query:', query);
  console.log('Protocol data available:', protocolData.length);

  // If search is empty, just clear results
  if (!query) {
    resultsContainer.innerHTML = '';
    return;
  }

  // Only search if we have data
  if (!protocolData || !protocolData.length) {
    console.error('No protocol data available');
    resultsContainer.innerHTML = 
      '<p class="error">Failed to load protocols. Please try again later.</p>';
    return;
  }

  // Perform search
  let results = fuzzySearch(query);
  
  // Debug logs
  console.log('Search returned results:', results);

  if (results.length === 0) {
    resultsContainer.innerHTML = '<p>No matching protocols found.</p>';
  } else {
    // Directly render the results without grouping first
    resultsContainer.innerHTML = renderPairedProtocols(results);
    const cards = resultsContainer.querySelectorAll('.protocol-card');
    cards.forEach((card, index) => {
      card.style.setProperty('--delay', `${index * 60}ms`);
      card.classList.add('fade-in-up');
    });
  }
}

// Create a debounced version of the search function
const debouncedSearch = debounce(runSearchAndRender, DEBOUNCE_DELAY);

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchButton');
  const resultsContainer = document.getElementById('results');

  // Load protocols data
  fetch('./data/protocols.json')
    .then(res => res.json())
    .then(rawData => {
      // Data is already in the format we need
      protocolData = rawData;
      
      // Initialize fuzzy search
      initFuzzy(protocolData);
      
      // Don't show any results initially
      resultsContainer.innerHTML = '';
      
      if (searchInput.value.trim()) {
        runSearchAndRender();
      }
    })
    .catch(error => {
      console.error('Failed to load protocols:', error);
      if (searchInput.value.trim()) {
        resultsContainer.innerHTML = 
          '<p class="error">Failed to load protocols. Please try again later.</p>';
      }
    });

  // Set up event listeners for search
  searchInput.addEventListener('input', debouncedSearch);
  searchButton.addEventListener('click', runSearchAndRender);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearchAndRender();
    }
  });
});

function renderPairedProtocols(results) {
  // Debug log
  console.log('Rendering results:', results);

  let html = '';
  
  // Group by study type (first word of study name)
  const grouped = results.reduce((acc, protocol) => {
    // Handle potential undefined study names
    const studyName = protocol.study || 'Other';
    const category = studyName.split(' ')[0];
    if (!acc[category]) acc[category] = [];
    acc[category].push(protocol);
    return acc;
  }, {});

  // Debug log
  console.log('Grouped results:', grouped);

  Object.entries(grouped).forEach(([category, protocols]) => {
    html += `<h2>${category}</h2><div class="protocol-grid">`;
    protocols.forEach(protocol => {
      // Safely handle potentially missing data
      const sequences = protocol.sequences || [];
      const sequenceText = Array.isArray(sequences) 
        ? sequences.map(s => s.sequence || '').filter(Boolean).join(', ')
        : '';

      html += `
        <div class="protocol-card">
          <div class="protocol-left">
            <div><strong>Study:</strong> ${protocol.study || ''}</div>
            <div>
              <strong>Contrast:</strong>
              <span style="color:${protocol.usesContrast ? 'var(--interactive-accent)' : 'inherit'};font-weight:${protocol.usesContrast ? 'bold' : 'normal'};">
                ${protocol.usesContrast ? 'Yes' : 'No'}
              </span>
            </div>
            <div><strong>Sequences:</strong> ${sequenceText}</div>
          </div>
          <div class="protocol-right">
            <div><strong>Indications:</strong> ${protocol.Indications || ''}</div>
            <div>${protocol['Contrast rationale:'] ? `<strong>Contrast rationale:</strong> ${protocol['Contrast rationale:']}` : ''}</div>
          </div>
        </div>
      `;
    });
    html += '</div>';
  });

  return html;
}