// js/favorites.js - Favorites functionality with cross-browser storage

import { storage, browser } from './storage.js';

let favorites = [];
let sidebarOpen = false;

// Cross-browser storage helpers
function loadFavorites() {
  try {
    favorites = storage.get('mri-protocol-favorites', []);
  } catch (error) {
    console.error('Error loading favorites:', error);
    favorites = [];
  }
}

function saveFavorites() {
  try {
    const success = storage.set('mri-protocol-favorites', favorites);
    if (!success) {
      console.warn('Favorites could not be saved persistently');
    }
    return success;
  } catch (error) {
    console.error('Error saving favorites:', error);
    return false;
  }
}

// Initialize favorites system
export function initFavorites() {
  loadFavorites();
  setupSidebarEvents();
  updateFavoritesCount();
  renderFavoritesList();
  
  // Show storage info if not persistent
  if (!storage.isPersistent()) {
    setTimeout(() => {
      showStorageWarning();
    }, 3000);
  }
}

// Show storage warning for favorites
function showStorageWarning() {
  const info = storage.getInfo();
  let message = '';
  
  if (info.type === 'memory') {
    message = 'Favorites cannot be saved in this browser mode. They will be lost when you close the page.';
  } else if (info.type === 'sessionStorage') {
    message = 'Favorites will only be saved for this session due to browser privacy settings.';
  }
  
  if (message) {
    showFeedback(message, 'warning', 8000);
  }
}

// Setup sidebar event listeners
function setupSidebarEvents() {
  const trigger = document.getElementById('sidebar-trigger');
  const close = document.getElementById('sidebar-close');
  
  if (trigger) {
    trigger.addEventListener('click', toggleSidebar);
  }
  
  if (close) {
    close.addEventListener('click', closeSidebar);
  }
  
  // Close sidebar when clicking outside
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('favorites-sidebar');
    if (sidebarOpen && sidebar && !sidebar.contains(e.target)) {
      closeSidebar();
    }
  });
  
  // Close sidebar on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebarOpen) {
      closeSidebar();
    }
  });
}

// Toggle sidebar open/closed
function toggleSidebar() {
  if (sidebarOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

// Open sidebar
function openSidebar() {
  const content = document.getElementById('sidebar-content');
  if (content) {
    content.classList.add('open');
    sidebarOpen = true;
    renderFavoritesList(); // Refresh the list when opening
  }
}

// Close sidebar
function closeSidebar() {
  const content = document.getElementById('sidebar-content');
  if (content) {
    content.classList.remove('open');
    sidebarOpen = false;
  }
}

// Add protocol to favorites
export function addToFavorites(protocol) {
  if (!protocol || !protocol.study) return;
  
  // Check if already favorited
  const exists = favorites.some(fav => fav.study === protocol.study);
  if (exists) return;
  
  // Add to favorites
  favorites.push({
    study: protocol.study,
    usesContrast: protocol.usesContrast,
    section: protocol.section || 'Other',
    dateAdded: new Date().toISOString()
  });
  
  saveFavorites();
  updateFavoritesCount();
  renderFavoritesList();
  updateFavoriteButtons();
  
  // Show brief feedback
  showFeedback(`Added "${protocol.study}" to favorites`);
}

// Remove protocol from favorites
export function removeFromFavorites(studyName) {
  if (!studyName) return;
  
  favorites = favorites.filter(fav => fav.study !== studyName);
  saveFavorites();
  updateFavoritesCount();
  renderFavoritesList();
  updateFavoriteButtons();
  
  // Show brief feedback
  showFeedback(`Removed "${studyName}" from favorites`);
}

// Check if protocol is favorited
export function isFavorited(studyName) {
  return favorites.some(fav => fav.study === studyName);
}

// Update favorites count in sidebar trigger
function updateFavoritesCount() {
  const countElement = document.getElementById('favorites-count');
  if (countElement) {
    countElement.textContent = favorites.length;
  }
}

// Update all favorite buttons in the current view
function updateFavoriteButtons() {
  const buttons = document.querySelectorAll('.favorite-button');
  buttons.forEach(button => {
    const studyName = button.getAttribute('data-study');
    if (studyName) {
      if (isFavorited(studyName)) {
        button.classList.add('favorited');
        button.title = 'Remove from favorites';
      } else {
        button.classList.remove('favorited');
        button.title = 'Add to favorites';
      }
    }
  });
}

// Render the favorites list in the sidebar
function renderFavoritesList() {
  const listContainer = document.getElementById('favorites-list');
  if (!listContainer) return;
  
  if (favorites.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-favorites">
        <span class="material-symbols-outlined">favorite_border</span>
        <p>No favorite protocols yet</p>
        <small>Click the heart icon on any protocol to add it here</small>
      </div>
    `;
    return;
  }
  
  // Sort favorites by date added (newest first)
  const sortedFavorites = [...favorites].sort((a, b) => 
    new Date(b.dateAdded) - new Date(a.dateAdded)
  );
  
  const favoritesHtml = sortedFavorites.map(favorite => {
    const contrastText = favorite.usesContrast ? 'Contrast' : 'No Contrast';
    const contrastClass = favorite.usesContrast ? 'contrast-yes' : 'contrast-no';
    
    return `
      <div class="favorite-item" data-study="${favorite.study}">
        <div class="favorite-item-header">
          <h4 class="favorite-item-title">${favorite.study}</h4>
          <span class="favorite-item-contrast ${contrastClass}">${contrastText}</span>
        </div>
        <p class="favorite-item-category">${favorite.section}</p>
        <button class="favorite-item-remove" onclick="handleRemoveFavorite('${favorite.study}')" title="Remove from favorites">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `;
  }).join('');
  
  listContainer.innerHTML = favoritesHtml;
  
  // Add click handlers to favorite items
  listContainer.querySelectorAll('.favorite-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger if clicking the remove button
      if (e.target.closest('.favorite-item-remove')) return;
      
      const studyName = item.getAttribute('data-study');
      if (studyName) {
        handleFavoriteItemClick(studyName);
      }
    });
  });
}

// Handle clicking on a favorite item
function handleFavoriteItemClick(studyName) {
  // Close the sidebar
  closeSidebar();
  
  // Clear current search and search for this protocol
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = studyName;
    
    // Trigger search
    const searchEvent = new Event('input', { bubbles: true });
    searchInput.dispatchEvent(searchEvent);
  }
}

// Global function for remove button clicks
window.handleRemoveFavorite = function(studyName) {
  removeFromFavorites(studyName);
};

// Show brief feedback message with type support
function showFeedback(message, type = 'info', duration = 3000) {
  // Remove any existing feedback
  const existing = document.querySelector('.favorites-feedback');
  if (existing) {
    existing.remove();
  }
  
  // Determine colors based on type
  const colors = {
    info: { bg: 'var(--interactive-accent)', text: 'var(--interactive-accent-text)' },
    warning: { bg: '#ff9800', text: '#ffffff' },
    error: { bg: '#f44336', text: '#ffffff' },
    success: { bg: '#4caf50', text: '#ffffff' }
  };
  
  const color = colors[type] || colors.info;
  
  // Create feedback element
  const feedback = document.createElement('div');
  feedback.className = 'favorites-feedback';
  feedback.textContent = message;
  feedback.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${color.bg};
    color: ${color.text};
    padding: 12px 16px;
    border-radius: 8px;
    font-family: 'Jost', sans-serif;
    font-size: 0.9em;
    font-weight: 500;
    z-index: 2000;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    max-width: 300px;
    word-wrap: break-word;
  `;
  
  document.body.appendChild(feedback);
  
  // Animate in
  requestAnimationFrame(() => {
    feedback.style.transform = 'translateX(0)';
  });
  
  // Remove after specified duration
  setTimeout(() => {
    feedback.style.transform = 'translateX(100%)';
    setTimeout(() => {
      if (feedback.parentNode) {
        feedback.parentNode.removeChild(feedback);
      }
    }, 300);
  }, duration);
}

// Export function to add favorite buttons to protocol cards
export function addFavoriteButtons() {
  // Add favorite buttons to all protocol cards
  const protocolCards = document.querySelectorAll('.protocol-card');
  
  protocolCards.forEach(card => {
    // Skip if button already exists
    if (card.querySelector('.favorite-button')) return;
    
    // Get protocol data from data attributes
    const studyName = card.getAttribute('data-study');
    const usesContrast = card.getAttribute('data-contrast') === 'true';
    const section = card.getAttribute('data-section') || 'Other';
    
    if (!studyName) return;
    
    // Create favorite button
    const button = document.createElement('button');
    button.className = 'favorite-button';
    button.setAttribute('data-study', studyName);
    button.innerHTML = '<span class="material-symbols-outlined">favorite</span>';
    
    // Set initial state
    if (isFavorited(studyName)) {
      button.classList.add('favorited');
      button.title = 'Remove from favorites';
    } else {
      button.title = 'Add to favorites';
    }
    
    // Add click handler
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (isFavorited(studyName)) {
        removeFromFavorites(studyName);
      } else {
        // Get full protocol data for adding to favorites
        const protocol = {
          study: studyName,
          usesContrast: usesContrast,
          section: section
        };
        addToFavorites(protocol);
      }
    });
    
    // Add button to card
    card.appendChild(button);
  });
}