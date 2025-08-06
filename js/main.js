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

  // Only fuzzy search if there's a query
  let results = fuzzySearch(query);

  // Log for debugging
  console.log('Search query:', query);
  console.log('Search results:', results);

  // Group results by category
  const grouped = results.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {});

  if (results.length === 0) {
    resultsContainer.innerHTML = '<p>No matching protocols found.</p>';
  } else {
    resultsContainer.innerHTML = renderPairedProtocols(grouped);
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
      protocolData = rawData.flatMap(group =>
        group.protocols.map(p => ({
          ...p,
          category: group.category
        }))
      );
      
      // Initialize fuzzy search
      initFuzzy(protocolData);
      
      // Don't show any results initially, wait for user input
      resultsContainer.innerHTML = '';
      
      // Only run search if there's an initial value
      if (searchInput.value.trim()) {
        runSearchAndRender();
      }
    })
    .catch(error => {
      console.error('Failed to load protocols:', error);
      // Only show error if user has tried to search
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

function renderPairedProtocols(grouped) {
  let html = '';
  Object.entries(grouped).forEach(([category, protocols]) => {
    html += `<h2>${category}</h2><div class="protocol-grid">`;
    protocols.forEach(protocol => {
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
            <div><strong>Sequences:</strong> ${Array.isArray(protocol.sequences) ? protocol.sequences.join(', ') : ''}</div>
          </div>
          <div class="protocol-right">
            <div><strong>Indications:</strong> ${protocol.indications || ''}</div>
            <div><strong>Contrast rationale:</strong> ${protocol.contrastRationale || ''}</div>
          </div>
        </div>
      `;
    });
    html += '</div>';
  });
  return html;
}