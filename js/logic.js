import { renderProtocolCard } from './render.js';

function renderResults(data) {
  const container = document.getElementById('results');
  container.innerHTML = data.map(renderProtocolCard).join('');
}