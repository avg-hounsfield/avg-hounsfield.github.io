import { initFuzzy, fuzzySearch } from './search.js';
import { renderGroupedProtocols, renderProtocolCard } from './render.js';

let protocolData = [];

fetch('./data/protocols.json')
  .then(res => res.json())
  .then(rawData => {
    // Flatten & tag category
    protocolData = rawData.flatMap(group =>
      group.protocols.map(p => ({ ...p, category: group.category }))
    );

    initFuzzy(protocolData); // Fuse.js indexing only

    // Don't render anything yet — wait for search
  });

function runSearch() {
  const query = document.getElementById('searchInput').value;
  sessionStorage.setItem('lastQuery', query);

  const results = fuzzySearch(query);
  const grouped = results.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {});
  const rerenderList = (listItem) => {
  listItem.classList.remove('fade');
  void listItem.offsetWidth; // triggers reflow
  listItem.classList.add('fade');
};
  

  if (Object.keys(grouped).length === 0) {
    document.getElementById('results').innerHTML = '<p>No matching protocols found.</p>';
  } else {
    document.getElementById('results').innerHTML = renderGroupedProtocols(grouped);
  }
  
}

window.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchButton');
  const lastQuery = sessionStorage.getItem('lastQuery');
 let typingTimer; // Declare this before the listener

searchInput.addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(runSearch, 300);
});

  searchInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(runSearch, 300);
  });

  searchButton.addEventListener('click', runSearch);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') runSearch();
  });

  if (lastQuery) {
    searchInput.value = lastQuery;
    runSearch();
  } else {
    searchInput.focus();
  }
});