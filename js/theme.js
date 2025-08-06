document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const body = document.body;

  // Function to apply theme
  function applyTheme(theme) {
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
    const isLight = body.classList.contains('light-theme');
    const newTheme = isLight ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });

  // Load saved theme or use default
  const savedTheme = localStorage.getItem('theme') || 'dark';
  applyTheme(savedTheme);
});