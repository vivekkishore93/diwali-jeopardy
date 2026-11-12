// Disk storage: question-set CSV files and the saved game state.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(root) {
  const questionsDir = path.join(root, 'questions');
  const dataDir = path.join(root, 'data');
  const statePath = path.join(dataDir, 'game.json');
  fs.mkdirSync(questionsDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const safe = name => {
    const base = String(name || '').replace(/\.csv$/i, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 60);
    if (!base) throw new Error('Invalid set name.');
    return base;
  };
  const file = name => path.join(questionsDir, `${safe(name)}.csv`);

  let saveTimer = null;

  return {
    questionsDir,
    safeName: safe,
    listSets() {
      return fs.readdirSync(questionsDir)
        .filter(f => f.toLowerCase().endsWith('.csv'))
        .map(f => {
          const st = fs.statSync(path.join(questionsDir, f));
          return { name: f.replace(/\.csv$/i, ''), size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    readSet(name) { return fs.readFileSync(file(name), 'utf8'); },
    writeSet(name, csv) { fs.writeFileSync(file(name), csv, 'utf8'); return safe(name); },
    deleteSet(name) { fs.unlinkSync(file(name)); },
    hasSet(name) { try { return fs.existsSync(file(name)); } catch { return false; } },

    loadState() {
      try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return null; }
    },
    saveState(state) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const tmp = statePath + '.tmp';
        fs.writeFile(tmp, JSON.stringify(state), err => {
          if (!err) fs.rename(tmp, statePath, () => {});
        });
      }, 150);
    },
  };
}
