import { getPass } from '../build/index.js';

async function main() {
    const password = await getPass();
    console.log(JSON.stringify({ password }));
}

main();
