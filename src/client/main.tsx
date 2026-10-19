import { render } from 'preact';
import { App } from './App';
import { camera } from './map/controller';
import { session } from './session/session';
import { view } from './store';
import './styles.css';

// small read-mostly hook for automated UI tests and debugging
(window as unknown as { __wr: unknown }).__wr = { camera, session, view };

render(<App />, document.getElementById('app')!);
