import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/space-grotesk/700.css';
import './index.css';
import App from './App';

// No StrictMode: Blockly owns its DOM and must be injected exactly once.
createRoot(document.getElementById('root')!).render(<App />);
