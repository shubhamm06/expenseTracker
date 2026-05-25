import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Instant tooltip system - replaces slow native title tooltips
(function() {
  const tip = document.createElement('div');
  tip.id = 'app-tooltip';
  document.body.appendChild(tip);

  let activeEl = null;
  let showTimer = null;

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title]');
    if (el && el.title) {
      el.dataset.tip = el.title;
      el.removeAttribute('title');
    }
    const target = e.target.closest('[data-tip]');
    if (target && target.dataset.tip) {
      activeEl = target;
      clearTimeout(showTimer);
      showTimer = setTimeout(() => {
        if (activeEl !== target) return;
        tip.textContent = target.dataset.tip;
        const rect = target.getBoundingClientRect();
        tip.style.left = rect.left + rect.width / 2 + 'px';
        tip.style.top = rect.top - 4 + 'px';
        tip.style.transform = 'translate(-50%, -100%)';
        tip.classList.add('visible');
      }, 500);
    }
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tip]');
    if (target === activeEl) {
      clearTimeout(showTimer);
      tip.classList.remove('visible');
      activeEl = null;
    }
  });
})();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
