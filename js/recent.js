// js/recent.js - Recently viewed protocols functionality with cross-browser storage

import { storage } from './storage.js';

let recentProtocols = [];
const MAX_RECENT = 5;

// Cross-browser storage helpers
function loadRecentProtocols() {
  try {
    recentProtocols = storage.get('mri-protocol-recent', []);
  } catch (error) {
    console.error('Error loading recent protocols:', error);
    recentProtocols = [];
  }
}

function saveRecentProtocols() {
  try {
    storage.set('mri-protocol-recent', recentProtocols);
  } catch (error) {
    console.error('Error saving recent protocols:', error);
  }
}

// Initialize recent protocols system
export function initRecentProtocols() {
  loadRecentProtocols();
  renderRecentProtocols();
  
  // Set up clear button if it doesn't exist
  setupClearButton();
}

// Add protocol to recent viewed
export function addToRecentProtocols(protocol) {
  if (!protocol || !protocol.study) return;
  
  // Remove if already exists (to move to front)
  recentProtocols = recentProtocols.filter(recent => recent.study !== protocol.study);
  
  // Add to front with timestamp
  recentProtocols.unshift({
    study: protocol.study,
    usesContrast: protocol.usesContrast,
    section: protocol.section || 'Other',
    viewedAt: new Date().toISOString()
  });
  
  // Keep only the most recent MAX_RECENT items
  if (recentProtocols.length > MAX_RECENT) {
    recentProtocols = recentProtocols.slice(0, MAX_RECENT);
  }
  
  saveRecentProtocols();
  renderRecentProtocols();
}

// Clear all recent protocols
function clearRecentProtocols() {
  recentProtocols = [];
  saveRecentProtocols();
  renderRecentProtocols();
}

// Setup clear button
function setupClearButton() {
  // Add event listener for clear button if not already added
  const existingHandler = window.clearRecentProtocols;
  if (!existingHandler) {
    window.clearRecentProtocols = clearRecentProtocols;
  }
}

// Render recent protocols section
function renderRecentProtocols() {
  const recentContainer = document.getElementById('recently-viewed');
  const recentProtocolsContainer = document.getElementById('recent-protocols');
  
  if (!recentContainer || !recentProtocolsContainer) return;
  
  if (recentProtocols.length === 0) {
    recentContainer.style.display = 'none';
    return;
  }
  
  recentContainer.style.display = 'block';
  
  const recentHtml = recentProtocols.map(protocol => {
    const contrastText = protocol.usesContrast ? 'Contrast' : 'No Contrast';
    const contrastClass = protocol.usesContrast ? 'contrast-yes' : 'contrast-no';
    const timeAgo = getTimeAgo(new Date(protocol.viewedAt));
    
    return `
      <div class="recent-protocol-item" data-study="${protocol.study}">
        <h4 class="recent-protocol-title">${protocol.study}</h4>
        <div class="recent-protocol-meta">
          <span class="recent-protocol-contrast ${contrastClass}">${contrastText}</span>
          <span class="recent-protocol-time">${timeAgo}</span>
        </div>
      </div>
    `;
  }).join('');
  
  recentProtocolsContainer.innerHTML = `
    ${recentHtml}
    ${recentProtocols.length > 0 ? `
      <button class="recent-clear" onclick="clearRecentProtocols()" title="Clear recent protocols">
        Clear All
      </button>
    ` : ''}
  `;
  
  // Add click handlers to recent protocol items
  recentProtocolsContainer.querySelectorAll('.recent-protocol-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const studyName = item.getAttribute('data-study');
      if (studyName) {
        handleRecentProtocolClick(studyName);
      }
    });
  });
}

// Handle clicking on a recent protocol
function handleRecentProtocolClick(studyName) {
  // Clear current search and search for this protocol
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = studyName;
    
    // Trigger search
    const searchEvent = new Event('input', { bubbles: true });
    searchInput.dispatchEvent(searchEvent);
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Get human-readable time ago string
function getTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) {
    return 'Just now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Track protocol views when search results are rendered
export function trackProtocolView(query, results) {
  // Only track if there's a specific search query and results
  if (!query || !results || results.length === 0) return;
  
  // If there's exactly one result, track it as viewed
  if (results.length === 1) {
    const protocol = results[0];
    addToRecentProtocols({
      study: protocol.study,
      usesContrast: protocol.usesContrast,
      section: protocol.section
    });
  }
  
  // If the query exactly matches a protocol name, track it
  const exactMatch = results.find(protocol => 
    protocol.study.toLowerCase() === query.toLowerCase()
  );
  
  if (exactMatch) {
    addToRecentProtocols({
      study: exactMatch.study,
      usesContrast: exactMatch.usesContrast,
      section: exactMatch.section
    });
  }
}