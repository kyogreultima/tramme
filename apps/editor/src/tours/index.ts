// The editor's own tours. Each module declares its tours with registerTour;
// a new tour is a new module here, or a plugin's `tours` export, or a script
// calling window.tramme.tours.register.

import './home.ts';
import './studio.ts';
import './editor.ts';
import './tips.ts';
import './drawn.ts';
import './sound.ts';
import './montage.ts';
import './speech.ts';
import './assistant.ts';

export * from './engine.ts';
