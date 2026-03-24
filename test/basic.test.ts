import { describe, expect, test } from '@jest/globals';
import * as pty from 'node-pty';
import { resolve } from 'path';
import type { Encoding, EncodingErrors } from '../src';

const getpass_path = './examples/getpass.js';
const project_dir = resolve(__dirname, '..');

function stripEscapeSequences(text: string): string {
    return text.replace(/\x1B\[200~.*?\x1B\[201~|\x1B(\[\??(\d*(;\d*)*)?[~a-z])?/gi, '');
}

type GetPassOutput = {
    output: string|Buffer;
    echo: string;
    password: string|null|{type: "Buffer", data: number[]};
    signal?: number;
    exitCode: number;
};

async function getpass({
    prompt,
    encoding,
    errors,
    echoChar,
    echoRepeat,
    input,
}: {
    prompt?: string;
    encoding?: Encoding;
    errors?: EncodingErrors;
    echoChar?: string;
    echoRepeat?: number;
    input: string|Buffer|((term: pty.IPty) => void),
}): Promise<GetPassOutput> {
    return new Promise((resolve, reject) => {
        try {
            const args = [getpass_path];

            if (prompt) {
                args.push(`--prompt=${prompt}`);
            }

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

            const cEncoding = (
                encoding === 'latin1' ? 'ISO-8859-1' :
                encoding === 'ascii' ? 'ASCII' :
                encoding === 'utf-8' ? 'UTF-8' :
                null
            );

            const term = pty.spawn(process.argv0, args, {
                name: 'xterm-color',
                cwd: project_dir,
                env: { ...process.env, LANG: cEncoding ? `C.${cEncoding}` : 'C' },
                encoding: null,
                cols: 80,
                rows: 40,
            });

            let buf: Buffer[] = [];
            let sawPrompt = prompt === '';
            
            const bEncoding = encoding === 'binary' ? 'ascii' : encoding ?? 'utf-8';
            const bPrompt = Buffer.from(prompt ?? 'Password: ', bEncoding);

            term.onData(((data: Buffer) => {
                buf.push(data);

                if (!sawPrompt) {
                    let buffer = Buffer.concat(buf);

                    const index = buffer.indexOf(bPrompt);
                    if (index >= 0) {
                        sawPrompt = true;
                        buffer = buffer.subarray(index + bPrompt.length);
                        if (typeof input === 'function') {
                            input(term);
                        } else if (Buffer.isBuffer(input)) {
                            term.write(input);
                        } else {
                            term.write(Buffer.from(input, bEncoding));
                        }
                    }

                    buf = [buffer];
                }
            }) as any);

            term.onExit(({ exitCode, signal }) => {
                try {
                    const output = Buffer.concat(buf);
                    let text = output.toString(encoding === 'binary' ? 'latin1' : encoding ?? 'utf-8');
                    /*
                    // Why does this *sometimes* not work?
                    text = stripEscapeSequences(text).trim();
                    const items = text.split(/(\r?\n|[\x03\x04\r])+/);

                    if (items.length <= 1) {
                        resolve({
                            output,
                            echo: '',
                            password: JSON.parse(text).password,
                            signal,
                            exitCode,
                        });
                        return;
                    }

                    const echo = items[0];
                    const data = JSON.parse(items.slice(1).join('\n'));
                    */

                    const index = text.indexOf('{');
                    if (index < 0) {
                        resolve({
                            output,
                            echo: text,
                            password: null,
                            signal,
                            exitCode,
                        });
                        return;
                    }

                    const echo = text.slice(0, index);
                    const data = JSON.parse(text.slice(index));

                    resolve({
                        output,
                        echo,
                        password: data.password,
                        signal,
                        exitCode,
                    });
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
    prompt?: string;
    encoding?: Encoding;
    errors?: EncodingErrors;
    echoChar?: string;
    echoRepeat?: number;
    input: string|Buffer;
    echo?: string;
    password?: string|null|{type: "Buffer", data: number[]};
    signal?: number;
    exitCode?: number;
    output?: string|Buffer;
};

const tests: TestCase[] = [
    {
        name: 'Valid ASCII',
        encoding: 'ascii',
        input: 'foobar\r',
        password: 'foobar',
    },
    {
        name: 'Valid UTF-8',
        encoding: 'utf-8',
        input: 'äÖß😀桁\r',
        password: 'äÖß😀桁',
    },
    {
        name: 'Valid latin1',
        encoding: 'latin1',
        input: Buffer.from([0xf6, 0xe4, 0xfc, 0xdf, 0xd6, 0xc4, 0xdc, 0x0a]),
        password: 'öäüßÖÄÜ',
    },
    {
        name: 'Multiline Paste',
        input: '\x1B[200~foo\n\nbar\x1B[201~\n',
        password: 'foo\n\nbar',
    },
    {
        name: 'Escape',
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
    {
        name: 'Backspace',
        input: 'foo\x7Fx bar\x7F\x7F\x7F\x7F\n',
        password: 'fox',
    },
    {
        name: 'Echo',
        input: 'foo\n',
        echo: '***',
        echoChar: '*',
        echoRepeat: 1,
        password: 'foo',
    },
    // {
    //     name: 'Echo + Backspace',
    //     input: 'foo\x7Fx\n',
    //     echo: '****',
    //     echoChar: '*',
    //     echoRepeat: 1,
    //     password: 'fox',
    // },

    // TODO: all kinds of broken encoding and stuff
    // TODO: echo
];

describe('Basic Tests', () => {
    for (const { name, prompt, encoding, errors, echoChar, echoRepeat, input, echo, password, signal, exitCode, output } of tests) {
        test(name, async () => {
            const res = await getpass({
                prompt,
                encoding,
                errors,
                echoChar,
                echoRepeat,
                input,
            });

            if (echo !== undefined) {
                expect(stripEscapeSequences(res.echo).trimEnd()).toEqual(echo);
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

            if (output !== undefined) {
                if (Buffer.isBuffer(res.output) && Buffer.isBuffer(output)) {
                    expect(res.output.equals(output)).toBeTruthy();
                } else {
                    expect(res.output).toEqual(output);
                }
            }
        });
    }
});
