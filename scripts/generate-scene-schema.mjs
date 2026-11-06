// Regenerate the published JSON Schema from the validated scene manifest.
// node scripts/generate-scene-schema.mjs
import fs from 'node:fs';
import { sceneJsonSchema } from '../packages/project/src/scene.ts';

fs.writeFileSync(new URL('../schema/webscene-1.schema.json', import.meta.url), JSON.stringify(sceneJsonSchema(), null, 2) + '\n');
