// js/main.js - OPTIMIZED VERSION

import { initFuzzy, fuzzySearch } from './search.js';
import { renderGroupedProtocols } from './render.js';

let protocolData = [];
let allStudies = []; // Add a new variable to hold the flattened list of all studies
const DEBOUNCE_DELAY = 250; // Reduced delay for better responsiveness

// Optimize debounce function
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

// Function to toggle accordion display
window.toggleAccordion = function(accordionId) {
  const content = document.getElementById(accordionId);
  const toggle = document.getElementById('toggle-' + accordionId);
  
  if (!content || !toggle) return; // Safety check
  
  const isHidden = content.style.display === 'none' || content.style.display === '';
  
  // Use requestAnimationFrame for smooth animations
  requestAnimationFrame(() => {
    content.style.display = isHidden ? 'block' : 'none';
    toggle.textContent = isHidden ? '−' : '+';
    toggle.classList.toggle('expanded', isHidden);
  });
};

// Optimized search and render function
function runSearchAndRender() {
  const searchInput = document.getElementById('searchInput');
  const resultsContainer = document.getElementById('results');
  const query = searchInput.value.trim();

  // Early return for empty queries
  if (!query) {
    resultsContainer.innerHTML = '';
    return;
  }

  // Data validation
  if (!allStudies?.length) {
    console.error('No protocol data available');
    resultsContainer.innerHTML = 
      '<p class="error">Loading protocols...</p>';
    return;
  }

  try {
    const results = fuzzySearch(query, allStudies) || [];
    
    if (results.length === 0) {
      resultsContainer.innerHTML = '<p>No matching protocols found.</p>';
      return;
    }

    // Optimize grouping with Map for better performance
    const grouped = results.reduce((acc, protocol) => {
      const sectionKey = protocol.section || 'Other';
      if (!acc[sectionKey]) {
        acc[sectionKey] = [];
      }
      acc[sectionKey].push(protocol);
      return acc;
    }, {});

    resultsContainer.innerHTML = renderGroupedProtocols(grouped);
    
    // Optimize animations - use CSS classes instead of inline styles
    const cards = resultsContainer.querySelectorAll('.protocol-card');
    cards.forEach((card, index) => {
      card.style.animationDelay = `${index * 60}ms`;
      card.classList.add('fade-in-up');
    });
    
  } catch (error) {
    console.error('Search error:', error);
    resultsContainer.innerHTML = '<p class="error">Search error. Please try again.</p>';
  }
}

// Create a debounced version of the search function
const debouncedSearch = debounce(runSearchAndRender, DEBOUNCE_DELAY);

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  var searchInput = document.getElementById('searchInput');
  var searchButton = document.getElementById('searchButton');
  var resultsContainer = document.getElementById('results');

  // Feature detection
  var supportsES6 = (function() {
    try {
      return new Function("(a = 0) => a");
    } catch (e) {
      return false;
    }
  })();

  // Cross-browser event listener helper
  function addEvent(element, event, handler) {
    if (element.addEventListener) {
      element.addEventListener(event, handler, false);
    } else if (element.attachEvent) {
      element.attachEvent('on' + event, handler);
    } else {
      element['on' + event] = handler;
    }
  }

  // Load protocols data with fetch polyfill fallback
  function loadProtocols() {
    if (window.fetch) {
      return fetch('./data/protocols.json')
        .then(function(res) { return res.json(); });
    } else {
      // Fallback for older browsers
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', './data/protocols.json');
        xhr.onload = function() {
          if (xhr.status === 200) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(e);
            }
          } else {
            reject(new Error('Failed to load'));
          }
        };
        xhr.onerror = function() {
          reject(new Error('Network error'));
        };
        xhr.send();
      });
    }
  }

  loadProtocols()
    .then(function(rawData) {
      protocolData = rawData;
      
      // Flatten all studies, duplicating them for each section they belong to
      allStudies = [];
      protocolData.forEach(function(sectionObj) {
        if (Array.isArray(sectionObj.studies)) {
          var sections = Array.isArray(sectionObj.section) ? sectionObj.section : ['Other'];
          sectionObj.studies.forEach(function(study) {
            sections.forEach(function(sectionName) {
              // Create a new object for each study-section pair
              allStudies.push(Object.assign({}, study, {
                section: sectionName // Assign the single section name
              }));
            });
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
    .catch(function(error) {
      console.error('Failed to load protocols:', error);
      if (searchInput.value.trim()) {
        resultsContainer.innerHTML = 
          '<p class="error">Failed to load protocols. Please try again later.</p>';
      }
    });

  // Set up event listeners for search with cross-browser support
  addEvent(searchInput, 'input', debouncedSearch);
  addEvent(searchButton, 'click', runSearchAndRender);
  addEvent(searchInput, 'keydown', function(e) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      if (e.preventDefault) {
        e.preventDefault();
      } else {
        e.returnValue = false;
      }
      runSearchAndRender();
    }
  });
});