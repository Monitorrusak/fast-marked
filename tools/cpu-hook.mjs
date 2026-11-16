// Preload with `node --import ./tools/cpu-hook.mjs main.ts` to print the process's CPU time at exit.
process.on('exit', () => {
  const u = process.cpuUsage();
  process.stderr.write(`cpu ${((u.user + u.system) / 1000).toFixed(0)} ms (user ${(u.user / 1000).toFixed(0)}, sys ${(u.system / 1000).toFixed(0)})\n`);
});
