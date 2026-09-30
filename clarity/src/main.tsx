import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './styles/ornaments.css';
import './styles/avatar-real.css';
import './styles/i18n.css';
import './styles/patient-v4.css';
import './styles/assistant-v4.css';
import './styles/auth-v4.css';
import './styles/staff-v4.css';
import './styles/docs-v5.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
