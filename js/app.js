/**
 * Protocol.Help - Main Application
 *
 * Clinical decision support for imaging recommendations.
 * Version 3.0 - Recommendation-centric architecture
 */

import { initSearchEngine } from './search-engine.js';
import { isDatabaseReady, getStats } from './db/database.js';
import { initRecommendationEngine, getRecommendations, getRecommendationsWithContext } from './recommendation-engine.js';
import {
    renderRecommendationLoading,
    renderRecommendationError,
    renderClarificationNeeded,
    renderRecommendations,
    renderWelcomeState
} from './render-recommendations.js';
import { initFavorites } from './favorites.js';
import { initAIAssistant } from './ai-assistant.js';

// Application state
const state = {
    isReady: false,
    currentQuery: '',
    lastResult: null,
    pendingClarification: null
};

// DOM Elements
let searchInput, resultsContainer;

/**
 * Initialize the application
 */
async function initApp() {
    console.log('Protocol.Help v3.0 - Initializing...');

    // Get DOM references
    searchInput = document.getElementById('searchInput');
    resultsContainer = document.getElementById('results');

    if (!resultsContainer) {
        console.error('Results container not found');
        return;
    }

    // Show loading state
    resultsContainer.innerHTML = renderRecommendationLoading();

    try {
        // Initialize search engine (loads database)
        await initSearchEngine();

        // Initialize recommendation engine
        await initRecommendationEngine();

        // Get and display stats
        const stats = getStats();
        console.log('Database stats:', stats);

        // Mark app as ready
        state.isReady = true;

        // Show welcome screen
        resultsContainer.innerHTML = renderWelcomeState(stats);

        // Setup event listeners
        setupEventListeners();

        // Initialize favorites
        initFavorites();

        // Initialize AI assistant
        initAIAssistant();

        console.log('Application initialized successfully');

    } catch (error) {
        console.error('Application initialization failed:', error);
        resultsContainer.innerHTML = renderRecommendationError(
            'Failed to load imaging database. Please refresh the page.'
        );
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    if (!searchInput) return;

    // Clear results when input is emptied
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        if (!query) {
            const stats = getStats();
            resultsContainer.innerHTML = renderWelcomeState(stats);
            state.currentQuery = '';
            state.lastResult = null;
            state.pendingClarification = null;
        }
    });

    // Search on Enter key
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const query = searchInput.value.trim();
            if (query) {
                performRecommendation(query);
            }

            // Blur on mobile to hide keyboard
            if (window.innerWidth <= 768) {
                searchInput.blur();
            }
        }
    });

    // Delegate click events for dynamic content
    resultsContainer.addEventListener('click', handleResultClick);

    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }
}

/**
 * Handle clicks within results container
 */
function handleResultClick(e) {
    const target = e.target;

    // Example chip click
    const exampleChip = target.closest('.example-chip');
    if (exampleChip) {
        const query = exampleChip.dataset.query;
        if (query) {
            searchInput.value = query;
            performRecommendation(query);
        }
        return;
    }

    // Clarification submit
    if (target.closest('#submitClarification')) {
        const input = document.getElementById('clarificationInput');
        if (input && input.value.trim() && state.pendingClarification) {
            submitClarification(input.value.trim());
        }
        return;
    }

    // Partial match chip click
    const partialChip = target.closest('.partial-match-chip');
    if (partialChip) {
        const condition = partialChip.dataset.condition;
        if (condition) {
            searchInput.value = condition;
            performRecommendation(condition);
        }
        return;
    }

    // Related scenario chip click
    const relatedChip = target.closest('.related-chip');
    if (relatedChip) {
        const scenarioName = relatedChip.dataset.scenarioName;
        if (scenarioName) {
            searchInput.value = scenarioName;
            performRecommendation(scenarioName);
        }
        return;
    }

    // Toggle sections
    const toggleHeader = target.closest('[data-toggle]');
    if (toggleHeader) {
        const targetId = toggleHeader.dataset.toggle;
        const content = document.getElementById(targetId);
        const icon = toggleHeader.querySelector('.toggle-icon');

        if (content) {
            content.classList.toggle('open');
            if (icon) {
                icon.classList.toggle('rotated');
            }
        }
        return;
    }

    // Accordion toggles (legacy support)
    const accordionHeader = target.closest('[data-accordion-id]');
    if (accordionHeader) {
        const accordionId = accordionHeader.dataset.accordionId;
        toggleAccordion(accordionId);
        return;
    }
}

/**
 * Perform recommendation search
 */
async function performRecommendation(query) {
    if (!state.isReady || !query) return;

    state.currentQuery = query;
    state.pendingClarification = null;
    console.log('Getting recommendations for:', query);

    // Show loading state
    resultsContainer.innerHTML = renderRecommendationLoading();

    try {
        const result = await getRecommendations(query);

        state.lastResult = result;

        if (result.error) {
            resultsContainer.innerHTML = renderRecommendationError(result.error);
            return;
        }

        if (result.needsClarification) {
            state.pendingClarification = query;
            resultsContainer.innerHTML = renderClarificationNeeded(result);
            // Focus the clarification input
            setTimeout(() => {
                const input = document.getElementById('clarificationInput');
                if (input) input.focus();
            }, 100);
            return;
        }

        resultsContainer.innerHTML = renderRecommendations(result);

        // Attach dynamic listeners
        requestAnimationFrame(() => {
            attachResultListeners();
        });

    } catch (error) {
        console.error('Recommendation error:', error);
        resultsContainer.innerHTML = renderRecommendationError(
            'An error occurred while generating recommendations.'
        );
    }
}

/**
 * Submit clarification answer
 */
async function submitClarification(answer) {
    if (!state.pendingClarification) return;

    const originalQuery = state.pendingClarification;
    state.pendingClarification = null;

    // Show loading
    resultsContainer.innerHTML = renderRecommendationLoading();

    try {
        const result = await getRecommendationsWithContext(originalQuery, answer);

        state.lastResult = result;

        if (result.error) {
            resultsContainer.innerHTML = renderRecommendationError(result.error);
            return;
        }

        if (result.needsClarification) {
            state.pendingClarification = originalQuery;
            resultsContainer.innerHTML = renderClarificationNeeded(result);
            return;
        }

        resultsContainer.innerHTML = renderRecommendations(result);

        requestAnimationFrame(() => {
            attachResultListeners();
        });

    } catch (error) {
        console.error('Clarification error:', error);
        resultsContainer.innerHTML = renderRecommendationError(
            'An error occurred while processing your clarification.'
        );
    }
}

/**
 * Attach event listeners to rendered results
 */
function attachResultListeners() {
    // Handle clarification input enter key
    const clarificationInput = document.getElementById('clarificationInput');
    if (clarificationInput) {
        clarificationInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && clarificationInput.value.trim()) {
                submitClarification(clarificationInput.value.trim());
            }
        });
    }
}

/**
 * Toggle accordion panel
 */
function toggleAccordion(accordionId) {
    const content = document.getElementById(accordionId);
    if (!content) return;

    const header = document.querySelector(`[data-accordion-id="${accordionId}"]`);
    const isOpen = content.classList.contains('open');

    if (isOpen) {
        content.classList.remove('open');
        content.style.maxHeight = '0px';
        header?.querySelector('.accordion-icon')?.classList.remove('rotated');
        header?.querySelector('.toggle-icon')?.classList.remove('rotated');
    } else {
        content.classList.add('open');
        content.style.maxHeight = content.scrollHeight + 'px';
        header?.querySelector('.accordion-icon')?.classList.add('rotated');
        header?.querySelector('.toggle-icon')?.classList.add('rotated');
    }
}

/**
 * Toggle theme
 */
function toggleTheme() {
    const body = document.body;
    const isDark = body.dataset.theme === 'dark';
    body.dataset.theme = isDark ? 'light' : 'dark';
    localStorage.setItem('theme', body.dataset.theme);

    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
        themeIcon.textContent = isDark ? 'dark_mode' : 'light_mode';
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initApp);

// Export for debugging and external access
window.protocolApp = {
    state,
    performRecommendation,
    getStats: () => isDatabaseReady() ? getStats() : null
};
