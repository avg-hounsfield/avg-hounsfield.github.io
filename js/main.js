// js/main.js - FINAL VERSION

import { initFuzzy, fuzzySearch } from './search.js';
import { renderGroupedProtocols } from './render.js';

let protocolData = [];
let allStudies = []; // Add a new variable to hold the flattened list of all studies
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
  if (!allStudies || !allStudies.length) {
    console.error('No protocol data available');
    resultsContainer.innerHTML = 
      '<p class="error">Failed to load protocols. Please try again later.</p>';
    return;
  }

  try {
    // Perform search on the flattened list of all studies
    let results = fuzzySearch(query, allStudies);
    if (!Array.isArray(results)) {
      results = [];
    }
    
    // Debug logs
    console.log('Search returned results:', results);

    if (results.length === 0) {
      resultsContainer.innerHTML = '<p>No matching protocols found.</p>';
    } else {
      const grouped = results.reduce((acc, protocol) => {
        const sectionArr = protocol.section;
        const sectionKey = Array.isArray(sectionArr) && sectionArr.length > 0 ? sectionArr[0] : 'Other';
        if (!acc[sectionKey]) {
          acc[sectionKey] = [];
        }
        acc[sectionKey].push(protocol);
        return acc;
      }, {});

      resultsContainer.innerHTML = renderGroupedProtocols(grouped);
      const cards = resultsContainer.querySelectorAll('.protocol-card');
      cards.forEach((card, index) => {
        card.style.setProperty('--delay', `${index * 60}ms`);
        card.classList.add('fade-in-up');
      });
    }
  } catch (error) {
    console.error('Error in search and render:', error);
    resultsContainer.innerHTML = '<p class="error">An error occurred while searching. Please try again.</p>';
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
      protocolData = rawData;
      
      // Flatten all studies from all sections into a single array
      allStudies = [];
      protocolData.forEach(sectionObj => {
        if (Array.isArray(sectionObj.studies)) {
          sectionObj.studies.forEach(study => {
            // Attach section info to each study for grouping later
            study.section = sectionObj.section;
            allStudies.push(study);
          });
        }
      });

      // Initialize fuzzy search with the flattened list
      initFuzzy(allStudies);
      
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