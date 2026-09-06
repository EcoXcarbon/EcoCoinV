import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { LangProvider } from './context/LangContext';
import { OfflineProvider } from './context/OfflineContext';
import App from './App';
import './index.css';

// Auto-reload the page the moment a new service worker takes control, so a fresh
// deploy is never stuck "one reload behind" for users. Runs once per update.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return; reloading = true; window.location.reload();
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename="/lms">
      <ThemeProvider>
        <LangProvider>
          <OfflineProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </OfflineProvider>
        </LangProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
