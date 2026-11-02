import { spawn } from 'node:child_process';

const windows = process.platform === 'win32';
const processes = [
  spawn(windows ? 'cmd.exe' : 'npm', windows ? ['/c', 'npm', 'run', 'dev:mock'] : ['run', 'dev:mock'], { stdio: 'inherit' }),
  spawn(windows ? 'cmd.exe' : 'npm', windows ? ['/c', 'npm', 'run', 'dev:next'] : ['run', 'dev:next'], { stdio: 'inherit' }),
];

const shutdown = (exitCode = 0) => {
  for (const proc of processes) {
    if (!proc.killed && proc.exitCode === null) {
      proc.kill('SIGTERM');
    }
  }
  process.exit(exitCode);
};

for (const proc of processes) {
  proc.on('exit', (code, signal) => {
    if (signal) {
      shutdown(1);
      return;
    }

    if (code !== 0) {
      shutdown(code ?? 1);
    }
  });

  proc.on('error', (error) => {
    console.error('Failed to start a dev process:', error);
    shutdown(1);
  });
}
