#!/usr/bin/env node
// Run from this folder: node replay.js recipe.json
const fs = require('node:fs');
const { replay } = require('./engine');
try {
  const file = process.argv[2];
  if (!file) throw Error('Usage: node replay.js <recipe.json>');
  const recipe = JSON.parse(fs.readFileSync(file, 'utf8'));
  const actual = replay(recipe);
  if (JSON.stringify(actual) !== JSON.stringify(recipe.expected)) throw Error('Replay differs from the recorded expectation.');
  console.log(JSON.stringify({ status: 'passed', result: actual }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
