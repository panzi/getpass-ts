import fs from "fs/promises";
import { basename } from "path";

for await (const jsPath of fs.glob('./build/esm/*.js')) {
    const esmPath = jsPath.slice(0, jsPath.length - 3) + '.mjs';
    const jsMapPath = jsPath + '.map';
    const esmMapPath = esmPath + '.map';

    try {
        const mapStr = await fs.readFile(jsMapPath, 'utf-8');
        const map = JSON.parse(mapStr);
        map.file = basename(esmPath);
        await fs.writeFile(esmMapPath, JSON.stringify(map));
        await fs.unlink(jsMapPath);
    } catch (error) {
        if (/** @type {any} */ (error)?.code === 'ENOENT') {
            console.warn(/** @type {any} */ (error)?.message || error);
        } else {
            throw error;
        }
    }

    await fs.rename(jsPath, esmPath);
}
