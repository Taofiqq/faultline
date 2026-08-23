import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { App } from './ui/App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(createElement(App));
}
