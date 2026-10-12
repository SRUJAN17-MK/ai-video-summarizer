import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installGlobalErrorLogging } from './lib/globalErrors';
import { logger } from './lib/logger';

installGlobalErrorLogging();
logger.info('frontend starting', { dev: import.meta.env.DEV });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
