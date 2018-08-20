import { compile } from "./swift-to-js";

import { readdirSync, statSync, readFile as readFile_, writeFile as writeFile_ } from "fs";
import { promisify } from "util";

const writeOutput = false;

const readFile = promisify(readFile_);
const writeFile = promisify(writeFile_);

const swiftFilePattern = /\.swift$/;

for (const category of readdirSync("./tests/")) {
	if (statSync(`./tests/${category}`).isDirectory()) {
		describe(category, () => {
			for (const file of readdirSync(`./tests/${category}`)) {
				if (swiftFilePattern.test(file)) {
					test(file.replace(swiftFilePattern, ""), async () => {
						const swiftPath = `./tests/${category}/${file}`;
						const jsPath = `./tests/${category}/${file.replace(swiftFilePattern, ".js")}`;
						const result = compile(swiftPath);
						if (writeOutput) {
							await writeFile(jsPath, await result);
						} else {
							const expected = readFile(jsPath);
							expect(await result).toEqual((await expected).toString("utf-8"));
						}
					});
				}
			}
		});
	}
}
