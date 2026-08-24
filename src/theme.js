// Applies the saved theme before first paint to avoid a flash of the wrong
// theme. Without a saved choice the stylesheet follows the browser/OS
// preference via prefers-color-scheme.
try {
	const saved = localStorage.getItem('theme')
	if (saved === 'light' || saved === 'dark') {
		document.documentElement.dataset.theme = saved
	}
} catch (e) {}
