// Source gate only; never deploys or reads credentials. Run on the full recovered source.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
function verify(root, manifest) {
  const base = path.resolve(root),
    missing = [],
    different = [],
    extra = [];
  const expected = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    const file = path.resolve(base, f.path);
    if (!file.startsWith(base + path.sep)) throw Error('Unsafe source path');
    if (!fs.existsSync(file)) {
      missing.push(f.path);
      continue;
    }
    if (fs.lstatSync(file).isSymbolicLink())
      throw Error('Source symlinks need explicit review');
    const hash = crypto
      .createHash('sha1')
      .update(fs.readFileSync(file))
      .digest('hex');
    if (hash !== f.uid) different.push(f.path);
  }
  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) scan(file);
      else if (
        !expected.has(path.relative(base, file).split(path.sep).join('/'))
      )
        extra.push(path.relative(base, file));
    }
  };
  scan(path.join(base, 'src'));
  return {
    deploymentId: manifest.deploymentId,
    projectId: manifest.projectId,
    teamId: manifest.teamId,
    expected: manifest.files.length,
    missing,
    different,
    extraRuntime: extra,
    verified: !missing.length && !different.length && !extra.length,
  };
}
module.exports = { verify };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2)
    throw Error(
      'Usage: node tools/verify-production-baseline.cjs <source-directory> <source-manifest.json>',
    );
  const result = verify(args[0], JSON.parse(fs.readFileSync(args[1], 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  if (!result.verified) process.exitCode = 1;
}
