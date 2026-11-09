// The code of a web scene, read only: the scene's text files as the project
// holds them, so the user can see what the assistant wrote. Edits go through
// the assistant's scene tools, never through this view.

import { useEffect, useState } from 'preact/hooks';
import { api } from '../api.ts';
import { readProjectText } from '../plugins/read-project-text.ts';
import { SCENE_TEXT_FILE } from '../scene-tools.ts';
import { t } from '../i18n/index.ts';
import { Select } from './controls.tsx';

/** how much of a file the view shows: a scene's script is small, a pasted bundle is not read here */
const SHOWN = 60_000;
const FOLDER = /^scenes\/[a-z0-9][a-z0-9-]{0,63}$/;

/** the scene folder a layer's `folder` names, or null when it names none that the project format admits */
export const sceneFolder = (folder: unknown): string | null => (typeof folder === 'string' && FOLDER.test(folder) ? folder : null);

export function SceneCode({ projectId, folder }: { projectId: string; folder: string }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [file, setFile] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let live = true;
    setFiles(null); setText(null); setProblem('');
    api.info(projectId).then((info) => {
      if (!live) return;
      const mine = info.files.map((f) => f.path).filter((p) => p.startsWith(`${folder}/`) && SCENE_TEXT_FILE.test(p)).sort();
      setFiles(mine);
      setFile((now) => (mine.includes(now) ? now : mine.find((p) => p.endsWith('/index.html')) ?? mine[0] ?? ''));
    }).catch((error: Error) => { if (live) { setFiles([]); setProblem(error.message); } });
    return () => { live = false; };
  }, [projectId, folder]);

  useEffect(() => {
    if (!file) { setText(null); return; }
    let live = true;
    readProjectText(projectId, file).then((body) => { if (live) { setText(body ?? ''); setProblem(''); } })
      .catch((error: Error) => { if (live) { setText(null); setProblem(error.message); } });
    return () => { live = false; };
  }, [projectId, file]);

  if (files && !files.length) return <div class="scene-code-empty">{problem || t('inspector.sceneNoFiles', { folder })}</div>;
  return (
    <div class="scene-code">
      <Select value={file} options={(files ?? []).map((p) => [p, p.slice(folder.length + 1)] as [string, string])} onChange={setFile} title={t('inspector.sceneFile')} />
      {problem ? <div class="scene-code-empty">{problem}</div>
        : <pre tabIndex={0} aria-label={t('inspector.sceneCodeOf', { file: file.slice(folder.length + 1) })}>{text === null ? t('inspector.sceneLoading') : text.length > SHOWN ? `${text.slice(0, SHOWN)}\n…` : text}</pre>}
      <div class="scene-code-note">{t('inspector.sceneReadOnly')}</div>
    </div>
  );
}
