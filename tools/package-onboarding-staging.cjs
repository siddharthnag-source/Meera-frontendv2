// Curated, credential-free staging source. Never copy commerce, env files or node_modules.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, 'work/onboarding-deploy'));
if (!output.startsWith(path.join(root, 'work') + path.sep)) throw Error('Package inside work/ only.');
fs.mkdirSync(output, { recursive: true });
function copy(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(target, name));
  } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
}
for (const relative of ['app', 'public']) copy(path.join(root, 'onboarding-staging', relative), path.join(output, relative));
for (const relative of ['src/app/onboarding', 'src/app/api/onboarding', 'src/components/onboarding', 'src/contexts/ThemeContext.tsx', 'src/styles/meera-theme.css', 'tools/voice-onboarding/assets']) copy(path.join(root, relative), path.join(output, relative));
for (const name of fs.readdirSync(path.join(root, 'src/lib')).filter(name => name.startsWith('onboarding-') && name.endsWith('.ts'))) copy(path.join(root, 'src/lib', name), path.join(output, 'src/lib', name));
function rewrite(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) rewrite(file);
    else if (/\.(ts|tsx|css)$/.test(name)) {
      let text = fs.readFileSync(file, 'utf8');
      text = text.replace(/((?:\.\.\/)+)src\//g, (match, prefix) => prefix.slice(3) + 'src/');
      fs.writeFileSync(file, text);
    }
  }
}
rewrite(path.join(output, 'app'));
const config = fs.readFileSync(path.join(root, 'onboarding-staging/next.config.ts'), 'utf8').replace('../tools/voice-onboarding/assets', './tools/voice-onboarding/assets');
fs.writeFileSync(path.join(output, 'next.config.ts'), config);
copy(path.join(root, 'onboarding-staging/middleware.ts'), path.join(output, 'middleware.ts'));
copy(path.join(root, 'onboarding-staging/postcss.config.mjs'), path.join(output, 'postcss.config.mjs'));
const tsconfig = JSON.parse(fs.readFileSync(path.join(root, 'onboarding-staging/tsconfig.json')));
tsconfig.compilerOptions.paths['@/*'] = ['./src/*'];
tsconfig.include = ['next-env.d.ts', 'app/**/*.ts', 'app/**/*.tsx', 'src/**/*.ts', 'src/**/*.tsx', '.next/types/**/*.ts'];
fs.writeFileSync(path.join(output, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'onboarding-staging/package.json')));
for (const collection of ['dependencies', 'devDependencies']) for (const key of Object.keys(pkg[collection])) pkg[collection][key] = require(path.join(root, 'node_modules', key, 'package.json')).version;
pkg.scripts = { build: 'next build', start: 'next start', dev: 'next dev' };
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify(pkg, null, 2));
fs.writeFileSync(path.join(output, 'vercel.json'), JSON.stringify({ git: { deploymentEnabled: false } }, null, 2));
console.log('Credential-free onboarding source prepared.');
