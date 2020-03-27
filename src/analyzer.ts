import {
  ExportDeclaration,
  ImportDeclaration,
  Project,
  SourceFile,
  SourceFileReferencingNodes,
  ts,
  Node
} from "ts-morph";
import { isDefinitelyUsedImport } from "./util/isDefinitelyUsedImport";
import { getModuleSourceFile } from "./util/getModuleSourceFile";
import { SingleBar, Presets } from "cli-progress";

type OnResultType = (result: IAnalysedResult) => void;

export const enum AnalysisResultTypeEnum {
  POTENTIALLY_UNUSED = "POTENTIALLY_UNUSED",
  DEFINITELY_USED = "DEFINITELY_USED"
}

interface CodeSymbol {
  name: string;
  line: number;
  column: number;
}

export interface IAnalysedResult {
  file: string;
  type: AnalysisResultTypeEnum;
  symbols: Array<CodeSymbol>;
}

function handleExportDeclaration(node: SourceFileReferencingNodes) {
  return (node as ExportDeclaration).getNamedExports().map(n => n.getName());
}

function handleImportDeclaration(node: SourceFileReferencingNodes) {
  const referenced = [] as string[];

  (node as ImportDeclaration)
    .getNamedImports()
    .map(n => referenced.push(n.getName()));

  const defaultImport = (node as ImportDeclaration).getDefaultImport();

  if (defaultImport) {
    referenced.push("default");
  }

  return referenced;
}

const nodeHandlers = {
  [ts.SyntaxKind.ExportDeclaration.toString()]: handleExportDeclaration,
  [ts.SyntaxKind.ImportDeclaration.toString()]: handleImportDeclaration
};

function getExported(file: SourceFile) {
  const exported: CodeSymbol[] = [];

  file.getExportSymbols().map(symbol => {
    let symbolPosition = { line: 0, column: 0 };
    try {
      symbolPosition = file.getLineAndColumnAtPos(
        symbol.getValueDeclaration()?.getPos() ?? 0
      );
    } catch (e) {
      // console.log(
      //   "ERROR ON POSITION",
      //   file.getFilePath(),
      //   symbol.compilerSymbol.name,
      //   e
      // );
    }
    exported.push({
      name: symbol.compilerSymbol.name,
      ...symbolPosition
    });
  });

  return exported;
}

const classMembersToIgnore = [
  "componentDidMount",
  "componentWillUnmount",
  "shouldComponentUpdate",
  "componentWillUpdate",
  "componentDidUpdate",
  "render",
  "defaultProps",
  "UNSAFE_componentWillReceiveProps",
  "UNSAFE_componentWillMount",
  "getDerivedStateFromProps",
  "componentDidCatch",
  "hydrate",
  "__constructor"
];

const ignoreRegex = new RegExp(classMembersToIgnore.join("|"));

function getUnusedClassMembers(file: SourceFile) {
  return file
    .getClasses()
    .map(clazz => {
      const unusedMembers = clazz
        .getMembers()
        .map(member => {
          const memberWithRefs = {
            member,
            refs: [] as Node[]
          };
          const memberName = member.getSymbol()?.getName();
          if (
            memberName &&
            !ignoreRegex.test(memberName) &&
            Node.isReferenceFindableNode(member)
          ) {
            memberWithRefs.refs = member.findReferencesAsNodes();
          }

          return memberWithRefs;
        })
        .filter(({ refs, member }) => {
          const memberName = member.getSymbol()?.getName();

          return (
            refs.length === 0 && memberName && !ignoreRegex.test(memberName)
          );
        });

      return {
        clazz,
        unusedMembers
      };
    })
    .filter(({ unusedMembers }) => unusedMembers.length > 0)
    .flatMap(({ clazz, unusedMembers }) => {
      return unusedMembers.map(
        ({ member }): CodeSymbol => {
          let symbolPosition = { line: 0, column: 0 };
          const symbol = member.getSymbol();
          try {
            symbolPosition = file.getLineAndColumnAtPos(
              symbol?.getValueDeclaration()?.getPos() ?? 0
            );
            // eslint-disable-next-line no-empty
          } catch (e) {}

          return {
            name: `MEMBER: ${clazz.getName()}.${symbol?.getName()}`,
            ...symbolPosition
          };
        }
      );
    });
}

const emitDefinitelyUsed = (file: SourceFile, onResult: OnResultType) => {
  file
    .getImportDeclarations()
    .map(decl => ({
      moduleSourceFile: getModuleSourceFile(decl),
      definitelyUsed: isDefinitelyUsedImport(decl)
    }))
    .filter(
      (
        meta
      ): meta is {
        moduleSourceFile: string;
        definitelyUsed: true;
      } => !!meta.definitelyUsed && !!meta.moduleSourceFile
    )
    .forEach(({ moduleSourceFile }) => {
      onResult({
        file: moduleSourceFile,
        symbols: [],
        type: AnalysisResultTypeEnum.DEFINITELY_USED
      });
    });
};

const emitPotentiallyUnused = (file: SourceFile, onResult: OnResultType) => {
  const exported = getExported(file);

  const referenced2D = file
    .getReferencingNodesInOtherSourceFiles()
    .map((node: SourceFileReferencingNodes) => {
      const handler =
        nodeHandlers[node.getKind().toString()] ||
        function noop() {
          return [] as string[];
        };
      return handler(node);
    });

  const referenced = ([] as string[]).concat(...referenced2D);

  const unused = exported.filter(exp => !referenced.includes(exp.name));
  const unusedClassMembers = getUnusedClassMembers(file);
  onResult({
    file: file.getFilePath(),
    symbols: unused.concat(unusedClassMembers),
    type: AnalysisResultTypeEnum.POTENTIALLY_UNUSED
  });
};

export const analyze = (project: Project, onResult: OnResultType) => {
  const progressBar = new SingleBar(
    {
      format:
        "Project Analysis|" +
        "{bar}" +
        "| {percentage}% || {value}/{total} Files || File: {file}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true
    },
    Presets.shades_classic
  );
  const projectFiles = project.getSourceFiles();
  progressBar.start(projectFiles.length, 0);

  projectFiles.forEach((file, index) => {
    progressBar.update(index + 1, { file: file.getFilePath() });
    emitPotentiallyUnused(file, onResult);
    emitDefinitelyUsed(file, onResult);
  });

  progressBar.stop();
};
