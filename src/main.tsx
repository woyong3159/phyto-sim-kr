import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { initPwa } from './pwa/usePwa';
import { session } from './sim/session';
import './ui/styles.css';

initPwa();
void session.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
