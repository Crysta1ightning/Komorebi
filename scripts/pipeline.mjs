import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = fileURLToPath(new URL(process.platform === 'win32' ? '../.venv-asr/Scripts/python.exe' : '../.venv-asr/bin/python', import.meta.url));
if (!existsSync(python)) {
  console.error('Create .venv-asr and install scripts/asr-requirements.txt first. See PIPELINE.md.');
  process.exit(1);
}
const child = spawn(python, ['scripts/video_pipeline.py', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
