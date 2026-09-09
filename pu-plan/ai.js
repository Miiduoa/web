const asset=name=>new URL(name,import.meta.url).href;
await import(asset('./boot-v9.js'));
