// /js/theme.js - BULLETPROOF VERSION

document.addEventListener('DOMContentLoaded', () => {

    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const body = document.body;
    const themeMeta = document.getElementById('theme-color-meta'); // This might be null

    if (!themeToggle || !themeIcon) {
        console.warn('Theme toggle UI elements not found. Theming will be disabled.');
        return; 
    }

    const lightThemeColor = '#FFFbff';
    const darkThemeColor = '#1D1B20';

    function applyTheme(theme) {
        body.setAttribute('data-theme', theme);
        
        if (theme === 'dark') {
            themeIcon.textContent = 'light_mode';
            themeToggle.title = 'Switch to light mode';
            // ✅ THIS IS THE FIX: Only set attribute if the element exists
            if (themeMeta) {
                themeMeta.setAttribute('content', darkThemeColor);
            }
        } else {
            themeIcon.textContent = 'dark_mode';
            themeToggle.title = 'Switch to dark mode';
            // ✅ THIS IS THE FIX: Only set attribute if the element exists
            if (themeMeta) {
                themeMeta.setAttribute('content', lightThemeColor);
            }
        }
        
        localStorage.setItem('theme', theme);
    }

    function getSystemTheme() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    themeToggle.addEventListener('click', () => {
        const currentTheme = body.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
    });

    const initialTheme = localStorage.getItem('theme') || getSystemTheme();
    applyTheme(initialTheme);
});