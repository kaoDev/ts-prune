import { State } from "./state";

const fileIgnorePatterns = [".styleguide.tsx"];

export const present = (state: State) => {
  const filesWithUnusedSymbols = state
    .definitelyUnused()
    .filter(result =>
      fileIgnorePatterns.every(pattern => !result.file.includes(pattern))
    )
    .filter(result => result.symbols.length > 0);

  const symbolCount = filesWithUnusedSymbols.reduce(
    (sum, result) => sum + result.symbols.length,
    0
  );

  const unusedSymbols = filesWithUnusedSymbols
    .map(result => ({
      file: result.file.replace(process.cwd(), "."),
      symbols: result.symbols
    }))
    .flatMap(result =>
      result.symbols
        .map(symbol =>
          [symbol.name, `${result.file}:${symbol.line}:${symbol.column}`].join(
            " @ "
          )
        )
        .concat("")
    );

  return {
    fileCount: filesWithUnusedSymbols.length,
    symbolCount,
    unusedSymbols
  };
};
