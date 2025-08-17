// js/theme.js

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    const body = document.body;
    const themeMeta = document.getElementById('theme-color-meta');

    if (!themeToggle || !themeIcon) {
        console.warn('Theme toggle UI elements not found.');
        return; 
    }

    const lightThemeColor = '#FFFbff';
    const darkThemeColor = '#1D1B20';

    function applyTheme(theme) {
        body.setAttribute('data-theme', theme);
        themeIcon.textContent = theme === 'dark' ? 'dark_mode' : 'light_mode';
        if (themeMeta) {
            themeMeta.setAttribute('content', theme === 'dark' ? darkThemeColor : lightThemeColor);
        }
        localStorage.setItem('theme', theme);
    }

    function getSystemTheme() {
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    themeToggle.addEventListener('click', () => {
        const newTheme = body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(newTheme);
    });

    applyTheme(localStorage.getItem('theme') || 'dark');
});