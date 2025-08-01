export function renderGroupedProtocols(groupedData) {
  return Object.entries(groupedData)
    .map(([category, protocols]) => {
      return `
        <h2 class="category-header">${category}</h2>
        ${protocols.map(renderProtocolCard).join('')}
      `;
    })
    .join('');
}

export function renderProtocolCard(protocol) {
  return `
    <div class="card">
      <h3>${protocol.study || 'Untitled Study'}</h3>
      <p><strong>Scanner:</strong> ${protocol.scanner?.join(', ') || 'N/A'}</p>
      <p><strong>Contrast:</strong> ${protocol.contrast || 'None'}</p>

      <div class="sequences">
        <h4>Sequences:</h4>
        <ul>
          ${protocol.sequences?.map(seq => `
            <li><strong>${seq.type}:</strong> ${seq.planes?.join(', ') || '–'}</li>
          `).join('') || '<li>None listed</li>'}
        </ul>
      </div>

      ${protocol.teachingNote ? `<p class="note">${protocol.teachingNote}</p>` : ''}
    </div>
  `;
}