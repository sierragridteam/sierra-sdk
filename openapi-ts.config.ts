import { defineConfig } from '@hey-api/openapi-ts';
export default defineConfig({
  input: './schema/generated.json',
  output: { path: './packages/typescript/src/generated' },
  plugins: ['@hey-api/typescript', '@hey-api/client-fetch', {name:'zod', dates:{offset:true}}, {name:'@hey-api/sdk', validator: true}],
});
