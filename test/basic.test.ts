import { describe, expect, test } from '@jest/globals';
import * as pty from 'node-pty';
import { resolve } from 'path';
import type { Encoding, EncodingErrors } from '../src';

const getpass_path = './examples/getpass.js';
const project_dir = resolve(__dirname, '..');

function stripEscapeSequences(text: string): string {
    return text.replace(/\x1B(\[\??(\d*(;\d*)*)?[~a-z])?/gi, '');
}

type GetPassOutput = {
    echo: string;
    password: string|null|{type: "Buffer", data: number[]};
    signal?: number;
    exitCode: number;
};

async function getpass(args: string[], input: string|Buffer|((term: pty.IPty) => void)): Promise<GetPassOutput> {
    return new Promise((resolve, reject) => {
        try {

            const term = pty.spawn(process.argv0, args ? [getpass_path, ...args] : [getpass_path], {
                name: 'xterm-color',
                cwd: project_dir,
                env: process.env,
            });

            let buf = '';
            let sawPrompt = false;

            term.onData(data => {
                buf += data;

                if (!sawPrompt) {
                    const prompt = 'Password: ';
                    const index = buf.indexOf(prompt);
                    if (index >= 0) {
                        sawPrompt = true;
                        buf = buf.slice(index + prompt.length);
                        if (typeof input === 'function') {
                            input(term);
                        } else {
                            term.write(input);
                        }
                    }
                }
            });

            term.onExit(({ exitCode, signal }) => {
                try {
                    buf = stripEscapeSequences(buf).trim();
                    const items = buf.split(/(\r?\n)+/);

                    if (items.length <= 1) {
                        resolve({
                            echo: '',
                            password: JSON.parse(buf).password,
                            signal,
                            exitCode,
                        });
                        return;
                    }

                    const echo = items[0];
                    const data = JSON.parse(items.slice(1).join('\n'));

                    resolve({ echo, password: data.password, signal, exitCode });
                } catch (error) {
                    reject(error);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

type TestCase = {
    name: string;
    encoding?: Encoding;
    errors?: EncodingErrors;
    echoChar?: string;
    echoRepeat?: number;
    input: string|Buffer;
    echo?: string;
    password?: string|null|{type: "Buffer", data: number[]};
    signal?: number;
    exitCode?: number;
};

const tests: TestCase[] = [
    {
        name: 'valid ASCII',
        encoding: 'ascii',
        input: 'foobar\r',
        password: 'foobar',
    },
    {
        name: 'valid UTF-8',
        encoding: 'utf-8',
        input: 'äÖß😀桁\r',
        password: 'äÖß😀桁',
    },
    {
        name: 'valid latin1',
        encoding: 'latin1',
        input: Buffer.from([0xf6, 0xe4, 0xfc, 0xdf, 0xd6, 0xc4, 0xdc, 0x0a]),
        password: 'öäüßÖÄÜ',
    },
    {
        name: 'multiline paste',
        input: '\x1B[200~foo\n\nbar\x1B[201~\n',
        password: 'foo\n\nbar',
    },
    {
        name: 'escape',
        input: 'foo\x1B',
        password: null,
    },
    {
        name: 'Ctrl+C',
        input: 'foo\x03',
        password: null,
    },
    {
        name: 'Ctrl+D',
        input: 'foo\x04',
        password: 'foo',
    },

    // TODO: all kinds of broken encoding and stuff
    // TODO: echo, backspace
];

describe('basic', () => {
    for (const { name, encoding, errors, echoChar, echoRepeat, input, echo, password, signal, exitCode } of tests) {
        test(name, async () => {
            const args: string[] = [];

            if (encoding) {
                args.push(`--encoding=${encoding}`);
            }

            if (errors) {
                args.push(`--errors=${errors}`);
            }

            if (echoChar) {
                args.push(`--echo-char=${echoChar}`);
            }

            if (echoRepeat !== undefined) {
                args.push(`--echo-repeat=${echoRepeat}`);
            }

            const res = await getpass(args, input);

            if (echo !== undefined) {
                expect(res.echo).toEqual(echo);
            }

            if (password !== undefined) {
                expect(res.password).toEqual(password);
            }

            if (signal !== undefined) {
                expect(res.signal).toEqual(signal);
            }

            if (exitCode !== undefined) {
                expect(res.exitCode).toEqual(exitCode);
            }
        });
    }
});
