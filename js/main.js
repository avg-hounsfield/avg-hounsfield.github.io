// js/main.js

// Import your render function at the top
import { renderGroupedProtocols } from './render.js';

// The entire application logic is wrapped in this single event listener
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM ELEMENTS ---
    // It's best to declare all your element variables at the top
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const resultsContainer = document.getElementById('results');
    const dataSourceToggle = document.getElementById('dataSourceToggle');
    const sidebarTrigger = document.getElementById('sidebar-trigger');
    const sidebarClose = document.getElementById('sidebar-close');
    const sidebarContent = document.getElementById('sidebar-content');

    // --- STATE ---
    // ✅ This code has been moved inside the listener
    let allProtocols = [];
    let allOrders = [];

    // --- FUNCTIONS ---
    // ✅ This function has been moved inside the listener
    async function loadData() {
        // Safety check to ensure resultsContainer was found
        if (!resultsContainer) return;
        resultsContainer.innerHTML = `<p>Loading data...</p>`;
        try {
            const [protocolRes, ordersRes] = await Promise.all([
                fetch('./data/protocols.json'),
                fetch('./data/imaging-orders.json')
            ]);
            if (!protocolRes.ok || !ordersRes.ok) throw new Error('Failed to fetch data files.');
            
            const protocolData = await protocolRes.json();
            const ordersData = await ordersRes.json();

            allProtocols = protocolData.flatMap(p => p.studies.map(s => ({...s, section: p.section[0]})));
            allOrders = ordersData.flatMap(o => o.studies.map(s => ({...s, section: o.section[0]})));
            
            handleSearch(); // Initial render after data is loaded
            
        } catch (error) {
            console.error('Data loading error:', error);
            resultsContainer.innerHTML = `<p class="error">Could not load protocol data.</p>`;
        }
    }

    // ✅ This function has been moved inside the listener
    function handleSearch() {
        // Safety checks
        if (!searchInput || !dataSourceToggle || !resultsContainer) return;

        const query = searchInput.value.toLowerCase().trim();
        const isOrdersMode = dataSourceToggle.checked;
        const dataToSearch = isOrdersMode ? allOrders : allProtocols;

        if (!query) {
            resultsContainer.innerHTML = '<p>Enter a search term to begin.</p>';
            return;
        }

        const results = dataToSearch.filter(item => 
            item.study.toLowerCase().includes(query)
        );

        if (results.length === 0) {
            resultsContainer.innerHTML = `<p>No results found for "${query}".</p>`;
        } else {
            const grouped = results.reduce((acc, item) => {
                const key = item.section || 'Other';
                if (!acc[key]) acc[key] = [];
                acc[key].push(item);
                return acc;
            }, {});
            resultsContainer.innerHTML = renderGroupedProtocols(grouped, isOrdersMode);
        }
    }

    // --- EVENT LISTENERS ---

    // Search event listeners
    // ✅ This code has been moved inside the listener
    if (searchButton && searchInput && dataSourceToggle) {
        searchButton.addEventListener('click', handleSearch);
        searchInput.addEventListener('keyup', (event) => {
            if (event.key === 'Enter') {
                handleSearch();
            }
        });
        dataSourceToggle.addEventListener('change', handleSearch);
    }

    // Sidebar event listeners
    if (sidebarTrigger && sidebarClose && sidebarContent) {
        sidebarTrigger.addEventListener('click', () => {
            sidebarContent.classList.toggle('open');
        });

        sidebarClose.addEventListener('click', () => {
            sidebarContent.classList.remove('open');
        });

        document.addEventListener('click', (event) => {
            if (!sidebarContent.contains(event.target) && !sidebarTrigger.contains(event.target)) {
                sidebarContent.classList.remove('open');
            }
        });
    }
    
    // --- INITIALIZATION ---
    // ✅ The initial call to loadData is now correctly at the end, inside the listener
    loadData();

}); // <-- This is the one, correct closing bracket for the DOMContentLoaded listener