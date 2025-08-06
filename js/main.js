// js/main.js - FINAL VERSION

import { initFuzzy, fuzzySearch } from './search.js';
import { renderPairedProtocols } from './render.js';

// =================================================================================
// 1. STATE AND INITIALIZATION
// =================================================================================

let protocolData = [];
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
    protocolData = rawData.flatMap(group =>
      group.protocols.flatMap(p => {
        if (p.scanner && p.scanner.length > 1) {
          return p.scanner.map(scannerType => ({
            ...p,
            scanner: [scannerType],
            category: group.category
          }));
        }
        return [{ ...p, category: group.category }];
      })
    );

    // Use fuzzy search from search.js
    initFuzzy(protocolData);

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
  const resultsContainer = document.getElementById('results');
  const query = searchInput.value.trim();

  sessionStorage.setItem('lastQuery', query);

  let results = query ? fuzzySearch(query) : protocolData;

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

// Replace your renderPairedProtocols function with this:
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
              <span style="color:${protocol.usesContrast ? '#b58900' : 'inherit'};font-weight:${protocol.usesContrast ? 'bold' : 'normal'};">
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

function initFuzzy(data) {
  window.fuse = new Fuse(data, {
    keys: ['study', 'sequences', 'indications', 'contrastRationale'],
    threshold: 0.3
  });
}

function fuzzySearch(query) {
  if (!window.fuse) return [];
  return window.fuse.search(query).map(result => result.item);
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('light-theme');
  const icon = document.getElementById('theme-icon');
  if (document.body.classList.contains('light-theme')) {
    icon.textContent = 'dark_mode';
  } else {
    icon.textContent = 'light_mode';
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const body = document.body;

  function applyTheme(theme) {
    if (theme === 'light') {
      body.classList.add('light-theme');
      themeIcon.textContent = 'dark_mode';
    } else {
      body.classList.remove('light-theme');
      themeIcon.textContent = 'light_mode';
    }
  }

  themeToggle.addEventListener('click', () => {
    const isLight = body.classList.contains('light-theme');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });

  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);
});