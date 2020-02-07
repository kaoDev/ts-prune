import minimist from "minimist";
import path from "path";

import { analyze } from "./analyzer";
import { initialize } from "./initializer";
import { State } from "./state";
import { present } from "./presenter";
import fs from "fs";

const reportFile = path.join(process.cwd(), "unused-code.txt");

const reportToFile = (line: string) => {
  console.log(line);
  fs.appendFileSync(reportFile, line + "\n", { encoding: "utf8" });
};

export const run = (argv = process.argv.slice(2), output = reportToFile) => {
  fs.writeFileSync(reportFile, "", { encoding: "utf8" });

  const tsConfigPath = path.join(
    process.cwd(),
    minimist(argv).p || "tsconfig.json"
  );

  console.log("Loading project", tsConfigPath);

  const { project } = initialize(tsConfigPath);

  const state = new State();

  analyze(project, state.onResult);

  const presentationState = present(state);

  console.log("");
  console.log("");
  console.log(
    `Found ${presentationState.symbolCount} potentially unused exports in ${presentationState.fileCount} files`
  );

  presentationState.unusedSymbols.map(value => {
    output(value);
  });
};
