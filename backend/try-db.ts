import { FakeD1 } from './test/fake-d1.ts';
const db = new FakeD1('migrations');
const tables = db.rows<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
console.log(tables.map(t => t.name).join(', '));
