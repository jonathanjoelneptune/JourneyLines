#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function findProject(startPath) {
  const start = path.resolve(startPath || process.cwd());
  const candidates = [
    { repoRoot: start, appRoot: path.join(start, 'journeylines') },
    { repoRoot: path.dirname(start), appRoot: start },
    { repoRoot: start, appRoot: start },
  ];
  for (const candidate of candidates) {
    const required = {
      app: path.join(candidate.appRoot, 'src', 'App.jsx'),
      controls: path.join(candidate.appRoot, 'src', 'components', 'PlaybackControls.jsx'),
      styles: path.join(candidate.appRoot, 'src', 'styles.css'),
      packageJson: path.join(candidate.appRoot, 'package.json'),
      qaDir: path.join(candidate.appRoot, 'QA'),
    };
    if ([required.app, required.controls, required.styles, required.packageJson].every(fs.existsSync)) return { ...candidate, ...required };
  }
  throw new Error(`Could not find GlobeHoppers beneath ${start}`);
}

const failures = [];
const passes = [];
function check(condition, label) {
  if (condition) passes.push(label);
  else failures.push(label);
}
function includes(source, text, label) { check(source.includes(text), label); }
function excludes(source, text, label) { check(!source.includes(text), label); }

const project = findProject(process.argv[2] || process.cwd());
const app = fs.readFileSync(project.app, 'utf8');
const controls = fs.readFileSync(project.controls, 'utf8');
const styles = fs.readFileSync(project.styles, 'utf8');
const packageData = JSON.parse(fs.readFileSync(project.packageJson, 'utf8'));

check(packageData.version === '6.3.0', 'package version is 6.3.0');
includes(app, 'const GLOBEHOPPERS_V63 = true;', 'v6.3 application marker is present');
includes(app, 'const timelineComplete = started && legs.length > 0', 'timeline complete state is centralized');
includes(app, 'const hasPlaybackStarted = started && !introLaunching', 'resume eligibility excludes initial launch');
includes(app, "'Resume Travel History'", 'top-bar playback label supports Resume');
includes(app, 'hasPlaybackStarted={hasPlaybackStarted}', 'resume state is passed to PlaybackControls');
includes(app, 'timelineComplete={timelineComplete}', 'centralized completed state is passed to PlaybackControls');

includes(controls, 'hasPlaybackStarted = false', 'controls accept prior playback state');
includes(controls, "hasPlaybackStarted ? 'Resume' : 'Play'", 'paused control displays Resume');
includes(controls, "hasPlaybackStarted ? 'Resume travel timeline' : 'Play travel timeline'", 'paused control exposes Resume accessibly');
includes(controls, "timelineComplete ? 'Complete'", 'completed label remains higher priority than Resume');
includes(controls, '(isPlaying ? onPause : onPlay)?.()', 'Resume uses the existing continuation path');

includes(styles, 'GlobeHoppers v6.3 playback-state labels and Add/Edit Hop preview breathing room', 'v6.3 layout marker is present');
includes(styles, 'width: min(1420px, calc(100vw - 24px))', 'desktop Hop modal has wider maximum width');
includes(styles, 'minmax(370px, .92fr)', 'Hop Preview has a protected desktop width');
includes(styles, 'scrollbar-gutter: stable', 'preview scrollbar gutter is reserved');
includes(styles, 'padding: 10px 18px 2px 2px', 'preview content has protected right-side breathing room');
includes(styles, 'grid-template-columns: 38px minmax(0, 1fr) minmax(76px, 112px)', 'preview rows protect marker and traveler columns');
includes(styles, 'white-space: normal', 'traveler status can wrap rather than clip');
includes(styles, '@media (max-width: 980px)', 'narrow screens retain the stacked layout');

check(fs.existsSync(project.qaDir), 'journeylines/QA directory exists');
check(fs.existsSync(path.join(project.qaDir, 'QA-v6.1.md')), 'v6.1 QA record moved into journeylines/QA');
check(fs.existsSync(path.join(project.qaDir, 'QA-v6.2.md')), 'v6.2 QA record moved into journeylines/QA');
check(fs.existsSync(path.join(project.qaDir, 'QA-v6.3.md')), 'v6.3 QA record exists');
check(!fs.existsSync(path.join(project.repoRoot, 'QA-v6.1.md')), 'root v6.1 QA duplicate is absent');
check(!fs.existsSync(path.join(project.repoRoot, 'QA-v6.2.md')), 'root v6.2 QA duplicate is absent');
check(!fs.existsSync(path.join(project.appRoot, 'QA-v6.1.md')), 'legacy direct v6.1 QA file is absent');
check(!fs.existsSync(path.join(project.appRoot, 'QA-v6.2.md')), 'legacy direct v6.2 QA file is absent');

for (const [label, file] of [['App.jsx', project.app], ['PlaybackControls.jsx', project.controls]]) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  // Node does not parse JSX. A nonzero result is expected, so only reject obvious file-read failures here.
  check(!String(result.stderr || '').includes('ENOENT'), `${label} is readable for build verification`);
}

console.log('\nGlobeHoppers v6.3 static verification');
for (const label of passes) console.log(`  PASS  ${label}`);
for (const label of failures) console.error(`  FAIL  ${label}`);
if (failures.length) {
  console.error(`\n${failures.length} verification check(s) failed. Production build was not started.`);
  process.exit(1);
}

if (process.env.GLOBEHOPPERS_SKIP_BUILD === '1') {
  console.log('\nStatic verification passed. Build skipped by GLOBEHOPPERS_SKIP_BUILD=1.');
  process.exit(0);
}

console.log('\nRunning production build...');
const build = spawnSync('npm', ['run', 'build'], { cwd: project.appRoot, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) {
  console.error('\nProduction build failed. Do not deploy this checkout until the build error is corrected.');
  process.exit(build.status || 1);
}
console.log('\nGlobeHoppers v6.3 verification and production build passed.');
