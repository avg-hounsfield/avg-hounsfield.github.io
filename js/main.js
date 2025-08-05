// js/main.js - FINAL VERSION

import { initFuzzy, fuzzySearch } from './search.js';
import { renderPairedProtocols } from './render.js';

// =================================================================================
// 1. STATE AND INITIALIZATION
// =================================================================================

let protocolData = [];
let typingTimer;
const DEBOUNCE_DELAY = 300;

// Fetch and process the protocol data once when the app loads
fetch('./data/protocols.json')
  .then(res => {
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return res.json();
  })
  .then(rawData => {
    // This is the crucial data transformation step:
    // We expand any protocol with multiple scanners into separate objects.
    // This ensures the data format is consistent for the renderer.
    protocolData = rawData.flatMap(group =>
      group.protocols.flatMap(p => {
        if (p.scanner && p.scanner.length > 1) {
          // SPLIT: Create a new protocol object for each scanner type
          return p.scanner.map(scannerType => ({
            ...p,
            scanner: [scannerType], // Override scanner to be a single-item array
            category: group.category
          }));
        }
        // KEEP: Protocol already has only one scanner, just add category
        return [{ ...p, category: group.category }];
      })
    );
    
    // Initialize the fuzzy search engine with the complete, clean dataset
    initFuzzy(protocolData);

    // If there's a search query from a previous session, run the search on load
    const searchInput = document.getElementById('searchInput');
    if (searchInput.value) {
      runSearchAndRender();
    }
  })
  .catch(error => {
    console.error("Failed to load protocol data:", error);
    document.getElementById('results').innerHTML = '<p class="error">Could not load protocol data.</p>';
  });

// =================================================================================
// 2. CORE FUNCTIONS
// =================================================================================

/**
 * The definitive search and render function. It correctly sequences
 * the fuzzy search and secondary filters.
 */
function runSearchAndRender() {
  const searchInput = document.getElementById('searchInput');
  const contrastFilter = document.getElementById('contrast-filter');
  const scannerFilter = document.getElementById('scanner-filter');
  const resultsContainer = document.getElementById('results');

  const query = searchInput.value.trim();
  const contrastValue = contrastFilter.value;
  const scannerValue = scannerFilter.value;

  sessionStorage.setItem('lastQuery', query);

  // If all inputs are empty/default, clear the results and exit.
  if (!query && contrastValue === 'all' && scannerValue === 'all') {
    resultsContainer.innerHTML = '';
    return;
  }

  // 1. Start with initial results: either from fuzzy search or the full dataset.
  let results = query ? fuzzySearch(query) : protocolData;

  // 2. Apply the secondary filters on the results from step 1.
  if (contrastValue !== 'all') {
    const requiresContrast = (contrastValue === 'with');
    results = results.filter(p => p.usesContrast === requiresContrast);
  }

  if (scannerValue !== 'all') {
    results = results.filter(p => p.scanner && p.scanner.includes(scannerValue));
  }

  // 3. Group the final, filtered results by their category.
  const grouped = results.reduce((acc, p) => {
    if (!acc[p.category]) {
      acc[p.category] = [];
    }
    acc[p.category].push(p);
    return acc;
  }, {});

  // 4. Render the output to the page.
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

/**
 * Sets up the light/dark theme toggle functionality.
 */
function setupThemeToggle() {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const body = document.body;

  const applyTheme = (theme) => {
    if (theme === 'light') {
      body.classList.add('light-theme');
      themeIcon.textContent = 'dark_mode';
    } else {
      body.classList.remove('light-theme');
      themeIcon.textContent = 'light_mode';
    }
  };

  themeToggle.addEventListener('click', () => {
    const isLight = body.classList.contains('light-theme');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });

  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);
}

// =================================================================================
// 3. EVENT BINDING
// =================================================================================

window.addEventListener('DOMContentLoaded', () => {
  setupThemeToggle();

  const searchInput = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchButton');
  const contrastFilter = document.getElementById('contrast-filter');
  const scannerFilter = document.getElementById('scanner-filter');

  searchInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(runSearchAndRender, DEBOUNCE_DELAY);
  });

  searchButton.addEventListener('click', runSearchAndRender);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearchAndRender();
    }
  });
  
  contrastFilter.addEventListener('change', runSearchAndRender);
  scannerFilter.addEventListener('change', runSearchAndRender);

  const lastQuery = sessionStorage.getItem('lastQuery');
  if (lastQuery) {
    searchInput.value = lastQuery;
    runSearchAndRender();
  }
  
  searchInput.focus();
});