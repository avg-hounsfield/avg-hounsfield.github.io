document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const body = document.body;

  // Validate required elements exist
  if (!themeToggle || !themeIcon) {
    console.warn('Theme toggle elements not found. Theme switching disabled.');
    return;
  }

  // Function to apply theme
  function applyTheme(theme) {
    if (!body || !themeIcon) return;
    
    if (theme === 'light') {
      body.classList.add('light-theme');
      themeIcon.textContent = 'dark_mode';
    } else {
      body.classList.remove('light-theme');
      themeIcon.textContent = 'light_mode';
    }
  }

  // Toggle theme when button is clicked
  themeToggle.addEventListener('click', () => {
    if (!body) return;
    
    const isLight = body.classList.contains('light-theme');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    
    try {
      localStorage.setItem('theme', newTheme);
    } catch (e) {
      console.warn('Unable to save theme preference:', e);
    }
  });

  // Load saved theme or use default
  let savedTheme = 'dark';
  try {
    savedTheme = localStorage.getItem('theme') || 'dark';
  } catch (e) {
    console.warn('Unable to load theme preference:', e);
  }
  applyTheme(savedTheme);
});