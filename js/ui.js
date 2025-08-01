// /js/ui.js

export function renderResults(results) {
  const container = document.getElementById('results');
  container.innerHTML = '';

  results.forEach(protocol => {
    const card = document.createElement('div');
    card.className = 'protocol-card';

  const sequenceList = protocol.sequences.map(seq => {
  const isContrast = /contrast|post/i.test(seq.note || '');
  const style = seq.highlight || isContrast ? 'style="color:#fc8; font-weight:bold;"' : '';
  return `<li ${style}>${seq.type} - ${seq.note || ''}</li>`;
    }).join('');

    card.innerHTML = `
      <h3>${protocol.study}</h3>
      <p><strong>Scanner:</strong> ${protocol.scanner.join(', ')}</p>
      <ul>${sequenceList}</ul>
    `;

    container.appendChild(card);
}).join('');
  });
}
