// The editor's own tours. Each module declares its tours with registerTour;
// a new tour is a new module here, or a plugin's `tours` export, or a script
// calling window.tramme.tours.register.

import './home.ts';
import './studio.ts';
import './retouch.ts';
import './editor.ts';
import './tips.ts';
import './drawn.ts';
import './sound.ts';
import './montage.ts';
import './speech.ts';
import './assistant.ts';
import './look.ts';
import './tools.ts';
import './yours.ts';

import { S } from '../state.ts';
import { prefs } from '../settings.ts';
import { offerTours } from './engine.ts';

// The studio is the default view: the atelier's tour is offered when a project
// first goes there, not only when one opens already in it.
let view = prefs.peek().view;
prefs.subscribe((p) => {
  if (p.view === view) return;
  view = p.view;
  if (S.ready.peek()) setTimeout(() => offerTours('editor'), 400);
});

export * from './engine.ts';
