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

// Function to toggle accordion display with enhanced professional animations
window.toggleAccordion = function(accordionId) {
  const content = document.getElementById(accordionId);
  const toggle = document.getElementById('toggle-' + accordionId);
  
  if (!content || !toggle) return; // Safety check
  
  const isHidden = content.style.display === 'none' || content.style.display === '';
  
  // Add professional performance optimization
  content.style.willChange = 'opacity, transform, filter';
  
  // Use requestAnimationFrame for buttery smooth animations
  requestAnimationFrame(() => {
    if (isHidden) {
      // Professional opening animation sequence
      content.style.display = 'block';
      content.style.opacity = '0';
      content.style.transform = 'translateY(-15px) scale(0.96)';
      content.style.filter = 'blur(1px)';
      
      requestAnimationFrame(() => {
        content.style.transition = 'all 0.6s cubic-bezier(0.19, 1, 0.22, 1)';
        content.style.opacity = '1';
        content.style.transform = 'translateY(0) scale(1)';
        content.style.filter = 'blur(0)';
      });
    } else {
      // Professional closing animation sequence
      content.style.transition = 'all 0.5s cubic-bezier(0.55, 0.085, 0.68, 0.53)';
      content.style.opacity = '0';
      content.style.transform = 'translateY(-10px) scale(0.98)';
      content.style.filter = 'blur(0.5px)';
      
      setTimeout(() => {
        content.style.display = 'none';
        content.style.willChange = 'auto';
      }, 500); // Match enhanced CSS transition duration
    }
    
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
    
    // Professional staggered animations with optimized timing
    const cards = resultsContainer.querySelectorAll('.protocol-card');
    cards.forEach((card, index) => {
      // Smooth staggered animation with professional timing curve
      card.style.animationDelay = `${index * 120}ms`;
      card.classList.add('fade-in-up');
      
      // Enhanced performance optimization
      card.style.willChange = 'transform, opacity, filter';
      
      // Clean up will-change after animation completes with extended timing
      setTimeout(() => {
        card.style.willChange = 'auto';
      }, 1200 + (index * 120));
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