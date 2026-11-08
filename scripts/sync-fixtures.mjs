import {readFileSync,writeFileSync} from 'node:fs';
const text=readFileSync(new URL('../fixtures/scenarios.json',import.meta.url),'utf8');
writeFileSync(new URL('../packages/typescript/src/fixtures-data.ts',import.meta.url),'// Generated from fixtures/scenarios.json by scripts/sync-fixtures.mjs\nexport const fixtureData = '+text.trim()+';\n');
