import { getPass } from '../build/index.js';

async function main() {
    const password = await getPass({
        echoChar: '•',
        echoRepeat: [1, 3],
    });
    console.log(JSON.stringify({ password }));
}

main();
