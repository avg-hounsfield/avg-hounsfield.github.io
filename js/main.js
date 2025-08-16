// js/main.js - OPTIMIZED VERSION

import { initFuzzy, fuzzySearch } from './search.js';
import { renderGroupedProtocols } from './render.js';

let protocolData = [];
let allStudies = []; // Add a new variable to hold the flattened list of all studies
const DEBOUNCE_DELAY = 250; // Reduced delay for better responsiveness

// Track animation timeouts to prevent memory leaks
let animationTimeouts = [];

// Cache last search results to avoid unnecessary re-processing
let lastSearchQuery = '';
let lastSearchResults = null;

// Optimize debounce function
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
};

// Map to store active timeouts for accordion animations to prevent memory leaks
const accordionTimeouts = new Map();

// Function to toggle accordion display with smooth height-based animations
window.toggleAccordion = function(accordionId) {
  const content = document.getElementById(accordionId);
  const toggle = document.getElementById('toggle-' + accordionId);
  
  if (!content || !toggle) return; // Safety check
  
  // Clear any existing timeout for this accordion to prevent memory leaks
  if (accordionTimeouts.has(accordionId)) {
    clearTimeout(accordionTimeouts.get(accordionId));
    accordionTimeouts.delete(accordionId);
  }
  
  // Determine current state more reliably
  const isCurrentlyHidden = content.style.display === 'none' || 
                           content.style.maxHeight === '0px' || 
                           !content.style.maxHeight;
  
  // Ensure consistent setup for all accordion sections
  content.style.overflow = 'hidden';
  content.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
  content.style.willChange = 'max-height, opacity, transform';
  
  if (isCurrentlyHidden) {
    // Opening animation - ensure smooth expansion for all sections
    content.style.display = 'block';
    content.style.opacity = '0';
    content.style.transform = 'translateY(-8px)';
    content.style.maxHeight = '0px';
    
    // Force reflow to ensure initial state is applied
    content.offsetHeight;
    
    // Get the natural height after content is visible
    const scrollHeight = content.scrollHeight;
    
    // Apply opening animation
    requestAnimationFrame(() => {
      content.style.maxHeight = scrollHeight + 'px';
      content.style.opacity = '1';
      content.style.transform = 'translateY(0)';
    });
    
    // Clean up after animation completes
    const timeoutId = setTimeout(() => {
      content.style.maxHeight = 'none';
      content.style.willChange = 'auto';
      accordionTimeouts.delete(accordionId);
    }, 500);
    accordionTimeouts.set(accordionId, timeoutId);
    
  } else {
    // Closing animation - ensure smooth collapse for all sections
    const scrollHeight = content.scrollHeight;
    
    // Set explicit height first
    content.style.maxHeight = scrollHeight + 'px';
    
    // Force reflow
    content.offsetHeight;
    
    // Apply closing animation
    requestAnimationFrame(() => {
      content.style.maxHeight = '0px';
      content.style.opacity = '0';
      content.style.transform = 'translateY(-8px)';
    });
    
    // Hide completely after animation
    const timeoutId = setTimeout(() => {
      content.style.display = 'none';
      content.style.willChange = 'auto';
      accordionTimeouts.delete(accordionId);
    }, 500);
    accordionTimeouts.set(accordionId, timeoutId);
  }
  
  // Update toggle button consistently
  toggle.textContent = isCurrentlyHidden ? '−' : '+';
  toggle.classList.toggle('expanded', isCurrentlyHidden);
};

// Cache DOM elements to avoid repeated queries
let cachedSearchInput;
let cachedResultsContainer;

// Optimized search and render function
function runSearchAndRender() {
  // Use cached elements or query them once
  if (!cachedSearchInput) cachedSearchInput = document.getElementById('searchInput');
  if (!cachedResultsContainer) cachedResultsContainer = document.getElementById('results');
  
  const searchInput = cachedSearchInput;
  const resultsContainer = cachedResultsContainer;
  
  if (!searchInput || !resultsContainer) return;
  
  const query = searchInput.value.trim();

  // Early return for empty queries
  if (!query) {
    if (lastSearchQuery !== '') {
      resultsContainer.innerHTML = '';
      // Clear any pending animation timeouts
      animationTimeouts.forEach(clearTimeout);
      animationTimeouts = [];
      lastSearchQuery = '';
      lastSearchResults = null;
    }
    return;
  }

  // Return cached results if query hasn't changed
  if (query === lastSearchQuery && lastSearchResults) {
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
    
    // Cache the results
    lastSearchQuery = query;
    lastSearchResults = results;
    
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

    // Clear any pending animation timeouts before creating new ones
    animationTimeouts.forEach(clearTimeout);
    animationTimeouts = [];
    
    // Use requestAnimationFrame for DOM updates to avoid layout thrashing
    requestAnimationFrame(() => {
      resultsContainer.innerHTML = renderGroupedProtocols(grouped);
      
      // Batch DOM queries and style operations for better performance
      requestAnimationFrame(() => {
        const cards = resultsContainer.querySelectorAll('.protocol-card');
        const fragment = document.createDocumentFragment();
        
        // Batch style operations to minimize reflow/repaint
        cards.forEach((card, index) => {
          const delay = index * 120;
          
          // Apply all styles in one operation to reduce style recalculation
          card.style.cssText += `
            animation-delay: ${delay}ms;
            will-change: transform, opacity, filter;
          `;
          card.classList.add('fade-in-up');
          
          // Use more efficient timeout management
          const timeoutId = setTimeout(() => {
            card.style.willChange = 'auto';
          }, 1200 + delay);
          animationTimeouts.push(timeoutId);
        });
      });
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
  var ordersOnlyToggle = document.getElementById('ordersOnlyToggle');

  // Validate required DOM elements exist
  if (!searchInput || !resultsContainer) {
    console.error('Required DOM elements not found. Application cannot initialize.');
    return;
  }

  // Orders Only filter state
  var isOrdersOnlyActive = false;

  // Toggle button functionality
  function toggleOrdersOnly() {
    if (!ordersOnlyToggle) return; // Safety check
    isOrdersOnlyActive = !isOrdersOnlyActive;
    ordersOnlyToggle.setAttribute('data-active', isOrdersOnlyActive.toString());
    
    // Re-run search if there's a query
    if (searchInput && searchInput.value.trim()) {
      runSearchAndRender();
    }
  }

  // Add click event to toggle button
  if (ordersOnlyToggle) {
    ordersOnlyToggle.addEventListener('click', toggleOrdersOnly);
  }

  // Make filter state accessible globally for search function
  window.getOrdersOnlyState = function() {
    return isOrdersOnlyActive;
  };

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
        .then(function(res) { 
          if (!res.ok) {
            throw new Error('HTTP error! status: ' + res.status);
          }
          return res.json(); 
        })
        .then(function(data) {
          // Validate data structure
          if (!Array.isArray(data)) {
            throw new Error('Invalid data format: expected array');
          }
          return data;
        });
    } else {
      // Fallback for older browsers
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', './data/protocols.json');
        xhr.timeout = 10000; // 10 second timeout
        
        xhr.onload = function() {
          if (xhr.status === 200) {
            try {
              var data = JSON.parse(xhr.responseText);
              // Validate data structure
              if (!Array.isArray(data)) {
                reject(new Error('Invalid data format: expected array'));
                return;
              }
              resolve(data);
            } catch (e) {
              reject(new Error('JSON parse error: ' + e.message));
            }
          } else {
            reject(new Error('HTTP error! status: ' + xhr.status));
          }
        };
        
        xhr.onerror = function() {
          reject(new Error('Network error'));
        };
        
        xhr.ontimeout = function() {
          reject(new Error('Request timeout'));
        };
        
        xhr.send();
      });
    }
  }

  loadProtocols()
    .then(function(rawData) {
      try {
        protocolData = rawData;
        
        // Validate and flatten all studies
        allStudies = [];
        
        if (!Array.isArray(protocolData)) {
          throw new Error('Invalid protocol data structure');
        }
        
        protocolData.forEach(function(sectionObj, index) {
          try {
            if (!sectionObj || typeof sectionObj !== 'object') {
              console.warn('Invalid section object at index', index);
              return;
            }
            
            if (Array.isArray(sectionObj.studies)) {
              var sections = Array.isArray(sectionObj.section) ? sectionObj.section : ['Other'];
              
              sectionObj.studies.forEach(function(study, studyIndex) {
                try {
                  if (!study || typeof study !== 'object') {
                    console.warn('Invalid study object at section', index, 'study', studyIndex);
                    return;
                  }
                  
                  sections.forEach(function(sectionName) {
                    if (typeof sectionName === 'string' && sectionName.trim()) {
                      // Create a new object for each study-section pair
                      allStudies.push(Object.assign({}, study, {
                        section: sectionName.trim()
                      }));
                    }
                  });
                } catch (studyError) {
                  console.warn('Error processing study:', studyError);
                }
              });
            }
          } catch (sectionError) {
            console.warn('Error processing section:', sectionError);
          }
        });

        if (allStudies.length === 0) {
          throw new Error('No valid studies found in protocol data');
        }

        // Initialize fuzzy search with the flattened list
        initFuzzy(allStudies);
        
        // Don't show any results initially
        if (resultsContainer) {
          resultsContainer.innerHTML = '';
        }
        
        if (searchInput && searchInput.value.trim()) {
          runSearchAndRender();
        }
        
      } catch (processingError) {
        console.error('Error processing protocol data:', processingError);
        if (resultsContainer) {
          resultsContainer.innerHTML = 
            '<p class="error">Error processing protocol data. Please try refreshing the page.</p>';
        }
      }
    })
    .catch(function(error) {
      console.error('Failed to load protocols:', error);
      if (searchInput && searchInput.value.trim() && resultsContainer) {
        resultsContainer.innerHTML = 
          '<p class="error">Failed to load protocols. Please try again later.</p>';
      }
    });

  // Set up event listeners for search with cross-browser support
  if (searchInput) {
    addEvent(searchInput, 'input', debouncedSearch);
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
  }
  
  if (searchButton) {
    addEvent(searchButton, 'click', runSearchAndRender);
  }
});