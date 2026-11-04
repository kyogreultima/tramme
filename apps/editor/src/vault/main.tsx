// The key vault (personal mode): a page of its own origin, framed by the
// editor, that keeps the visitor's keys in its own storage and calls the
// providers with them. The editor, its plugins and the server never read a
// key: the editor asks for a route (/api/claude, /api/llm…, the same routes
// the private Worker answers, @tramme/api) and gets the answer.
//
// The Worker serves this page with a strict Content-Security-Policy: framed by
// the editor's address only, reaching the providers of direct.ts and the relay.

import './params.ts';
// the styles here: imported by page.tsx, esbuild would also write them in a stylesheet of their own that nothing loads
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '../theme/tokens.css';
import '../theme/base.css';
import '../theme/components.css';
import '../screens/settings.css';
import '../theme/frost.css';
import '../theme/liquid-glass.css';

// the page, after the editor's language and theme are kept: imported
// statically, the preferences and the texts (in a chunk shared with the
// editor) would be read before params.ts runs
void import('./page.tsx');
