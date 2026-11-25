import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin') {
  const native = fileURLToPath(new URL('../native/', import.meta.url));
  const cache = fileURLToPath(new URL('../node_modules/.cache/swift', import.meta.url));
  mkdirSync(cache, { recursive: true });
  const stage = mkdtempSync(join(native, '.credential-key-'));
  try {
    const binaries = ['arm64', 'x86_64'].map(arch => {
      const binary = join(stage, arch);
      execFileSync('/usr/bin/swiftc', ['-O', '-target', arch + '-apple-macos11.0',
        '-module-cache-path', cache, join(native, 'credential-key.swift'), '-o', binary], { stdio: 'inherit' });
      return binary;
    });
    const universal = join(stage, 'credential-key');
    execFileSync('/usr/bin/lipo', ['-create', ...binaries, '-output', universal]);
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', universal], { stdio: 'inherit' });
    renameSync(universal, join(native, 'credential-key'));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
