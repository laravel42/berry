try { document.documentElement.dataset.theme = localStorage.getItem('berry-docs-theme') === 'light' ? 'light' : 'dark'; } catch { document.documentElement.dataset.theme = 'dark'; }
