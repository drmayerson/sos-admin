import { useState } from 'preact/hooks';
import { FLAG_COLS, type Row } from '../core/types';
import { useApp } from './ctx';

/** Running log of comments / actions taken on a flag, plus a box to add one. Doesn't decide the flag. */
export function FlagComments({ flag }: { flag: Row }) {
  const { repo, run } = useApp();
  const [text, setText] = useState('');
  const lines = (flag[FLAG_COLS.comments] ?? '').split('\n').filter(Boolean);
  const add = async () => {
    if (await run(() => repo.addFlagComment(flag[FLAG_COLS.flagId], text))) setText('');
  };
  return (
    <div class="comments">
      {lines.length > 0 && <ul>{lines.map((l) => <li>{l}</li>)}</ul>}
      <div class="row">
        <input
          class="grow"
          placeholder="Comment / action taken (e.g. e-mailed course teacher)"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim() && add()}
        />
        <button disabled={!text.trim()} onClick={add}>Add</button>
      </div>
    </div>
  );
}
