// js/main.js - CORRECTED VERSION

// --- MODULE IMPORTS (Stay at the top level) ---
import { renderGroupedProtocols } from './render.js';
import { initFuzzy, fuzzySearch } from './search.js';
import { initFavorites, addFavoriteButtons } from './favorites.js';
import { initFeedback } from './feedback.js';

// --- GLOBAL VARIABLES & FUNCTIONS (Can stay at the top level) ---
let protocolData = [];
let ordersData = [];
let allStudies = [];
let allOrders = [];
const DEBOUNCE_DELAY = 250;

// ... (all your pathologyMapping, symptomKeywords, performPathologySearch, debounce, and toggleAccordion functions go here, unchanged) ...
// NOTE: For brevity, I'm omitting the large data objects and functions that don't need changes. 
// Just ensure they are here in your file, outside the DOMContentLoaded wrapper.

const pathologyMapping = { /* ... your big mapping object ... */ };
const symptomKeywords = [ /* ... your keywords ... */ ];
function performPathologySearch(query, orders) { /* ... your function ... */ }
const debounce = (func, wait) => { /* ... your function ... */ };
const accordionTimeouts = new Map();
window.toggleAccordion = function(accordionId) { /* ... your function ... */ };


// ==========================================================================
// THIS IS THE CRITICAL FIX: All code that touches the DOM goes inside here.
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {

    // --- All of your application logic from the original file goes here ---

    let cachedSearchInput;
    let cachedResultsContainer;

    function runSearchAndRender() {
        if (!cachedSearchInput) cachedSearchInput = document.getElementById('searchInput');
        if (!cachedResultsContainer) cachedResultsContainer = document.getElementById('results');
        
        const searchInput = cachedSearchInput;
        const resultsContainer = cachedResultsContainer;
        
        if (!searchInput || !resultsContainer) return;
        
        const query = searchInput.value.trim();

        if (!query) {
            resultsContainer.innerHTML = '';
            searchInput.classList.remove('search-loading');
            return;
        }

        searchInput.classList.add('search-loading');
        resultsContainer.innerHTML = `
            <div class="loading-container">
                <div class="loading-spinner"></div>
                <p class="loading-text">Searching...</p>
            </div>
        `;

        const isOrdersMode = window.getOrdersOnlyState ? window.getOrdersOnlyState() : false;
        const currentDataset = isOrdersMode ? allOrders : allStudies;
        const datasetName = isOrdersMode ? 'orders' : 'protocols';

        if (!currentDataset?.length) {
            resultsContainer.innerHTML = `<p class="error">Loading ${datasetName} data...</p>`;
            searchInput.classList.remove('search-loading');
            return;
        }

        try {
            let results;
            
            if (isOrdersMode) {
                const pathologyResults = performPathologySearch(query, allOrders);
                results = pathologyResults.length > 0 ? pathologyResults : (fuzzySearch(query, allOrders) || []);
            } else {
                results = fuzzySearch(query, allStudies) || [];
            }
            
            if (results.length === 0) {
                resultsContainer.innerHTML = `<p>No matching ${datasetName} found.</p>`;
                searchInput.classList.remove('search-loading');
                return;
            }

            // This logic seems complex, we will assume it's correct for now
            // The key is that renderGroupedProtocols is now correctly imported and called
            const grouped = results.reduce((acc, item) => {
              let sectionKey = item.section || 'Other';
              if (!acc[sectionKey]) acc[sectionKey] = [];
              acc[sectionKey].push(item);
              return acc;
            }, {});

            resultsContainer.innerHTML = renderGroupedProtocols(grouped, isOrdersMode);
            
            // Apply animations
            const cards = resultsContainer.querySelectorAll('.protocol-card, .order-card');
            cards.forEach((card, index) => {
                card.style.animationDelay = `${index * 80}ms`;
                card.classList.add('fade-in-up');
            });

            searchInput.classList.remove('search-loading');
            addFavoriteButtons();

        } catch (error) {
            console.error('Search error:', error);
            resultsContainer.innerHTML = '<p class="error">An error occurred during search.</p>';
            searchInput.classList.remove('search-loading');
        }
    }

    const debouncedSearch = debounce(runSearchAndRender, DEBOUNCE_DELAY);

    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const resultsContainer = document.getElementById('results');
    const dataSourceToggle = document.getElementById('dataSourceToggle');
    const protocolsLabel = document.getElementById('protocolsLabel');
    const ordersLabel = document.getElementById('ordersLabel');

    if (!searchInput || !searchButton || !resultsContainer) {
        console.error('Required DOM elements not found. Application cannot initialize.');
        return;
    }

    let currentDataSource = 'protocols';

    function toggleDataSource() {
        if (dataSourceToggle.checked) {
            currentDataSource = 'orders';
            protocolsLabel.classList.remove('active');
            ordersLabel.classList.add('active');
            searchInput.placeholder = 'Search orders or symptoms...';
        } else {
            currentDataSource = 'protocols';
            protocolsLabel.classList.add('active');
            ordersLabel.classList.remove('active');
            searchInput.placeholder = 'Search protocols...';
        }
        if (searchInput.value.trim()) {
            runSearchAndRender();
        }
    }

    if (dataSourceToggle) {
        dataSourceToggle.addEventListener('change', toggleDataSource);
    }

    window.getOrdersOnlyState = () => currentDataSource === 'orders';
    
    // --- DATA LOADING ---
    async function loadAllData() {
        try {
            const [protocolRes, ordersRes] = await Promise.all([
                fetch('./data/protocols.json'),
                fetch('./data/imaging-orders.json')
            ]);

            if (!protocolRes.ok || !ordersRes.ok) {
                throw new Error('Failed to fetch data files.');
            }

            protocolData = await protocolRes.json();
            ordersData = await ordersRes.json();
            
            // Flatten data
            allStudies = protocolData.flatMap(sectionObj => 
                sectionObj.studies.map(study => ({...study, section: sectionObj.section[0] || 'Other'}))
            );
            allOrders = ordersData.flatMap(sectionObj => 
                sectionObj.studies.map(order => ({...order, section: sectionObj.section[0] || 'Other'}))
            );
            
            initFuzzy(allStudies.concat(allOrders));
            initFavorites();
            initFeedback();
            
            // Initial render (optional, you can leave it blank until search)
            resultsContainer.innerHTML = '';

        } catch (error) {
            console.error('Failed to load data:', error);
            resultsContainer.innerHTML = '<p class="error">Failed to load protocol data.</p>';
        }
    }
    
    // --- INITIALIZE ---
    searchInput.addEventListener('input', debouncedSearch);
    searchButton.addEventListener('click', runSearchAndRender);
    
    loadAllData();
});