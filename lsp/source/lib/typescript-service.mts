import assert from "assert"
import path from "path";

import BundledCivetModule, { SourceMap } from "@danielx/civet"

import ts, {
  CompilerHost,
  CompilerOptions,
  IScriptSnapshot,
  LanguageServiceHost,
} from "typescript"

const {
  ScriptSnapshot,
  createCompilerHost,
  createLanguageService,
  parseJsonConfigFileContent,
  readConfigFile,
  sys,
} = ts

import { TextDocument } from "vscode-languageserver-textdocument";
import { fileURLToPath } from "url";
import { createRequire } from "module";

import { compile as coffeeCompile } from "coffeescript"

// ts doesn't have this key in the type
interface ResolvedModuleWithFailedLookupLocations extends ts.ResolvedModuleWithFailedLookupLocations {
  failedLookupLocations: string[];
}

interface FileMeta {
  sourcemapLines: SourceMap["data"]["lines"] | undefined
  transpiledDoc: TextDocument
}

interface Host extends LanguageServiceHost {
  getMeta(path: string): FileMeta | undefined
  addDocument(doc: TextDocument): void
}

interface Transpiler {
  (path: string, source: string): {
    code: string,
    sourceMap?: SourceMap
  } | undefined
}

const civetExtension = /\.civet$/

function TSHost(compilationSettings: CompilerOptions, baseHost: CompilerHost, transpilers: Map<string, Transpiler>): Host {
  const { rootDir } = compilationSettings
  assert(rootDir, "Most have root dir for now")

  const scriptFileNames: Set<string> = new Set([])
  const fileMetaData: Map<string, FileMeta> = new Map;

  const documents: Set<TextDocument> = new Set();
  const pathMap: Map<string, TextDocument> = new Map
  const snapshotMap: Map<string, IScriptSnapshot> = new Map

  let projectVersion = 0;

  const transpiledExtensions = new Set(transpilers.keys())

  const resolutionCache: ts.ModuleResolutionCache = ts.createModuleResolutionCache(rootDir, (fileName) => fileName, compilationSettings);

  let self: Host;

  return self = Object.assign({}, baseHost, {
    getModuleResolutionCache: () => resolutionCache,
    /**
     * This is how TypeScript resolves module names when it finds things like `import { foo } from "bar"`.
     * We need to modify this to make sure that TypeScript can resolve our `.civet` files.
     * We default to the original behavior, but if it is a `.civet` file, we resolve it with the `.civet` extension.
     * This requires the `allowNonTsExtensions` option and `allowJs` options to be set to true.
     * Then TypeScript will call `getScriptSnapshot` with the `.civet` extension and we can do the transpilation there.
     */
    resolveModuleNames(moduleNames: string[], containingFile: string, _reusedNames: string[] | undefined, _redirectedReference: ts.ResolvedProjectReference | undefined, compilerOptions: CompilerOptions, _containingSourceFile?: ts.SourceFile) {
      console.log("resolveModuleNames", moduleNames, containingFile)

      return moduleNames.map(name => {
        // Try to resolve the module using the standard TypeScript logic
        let resolution = ts.resolveModuleName(name, containingFile, compilerOptions, self, resolutionCache) as ResolvedModuleWithFailedLookupLocations
        let { resolvedModule } = resolution
        if (resolvedModule) {
          console.log("resolved", resolvedModule.resolvedFileName)
          return resolvedModule
        }

        // TODO: account for module resolution configuration options 'node', etc.

        // TODO: check extension against all transpilers
        for (const ext of transpiledExtensions) {
          const extension = `.${ext}`
          const resolved = path.resolve(path.dirname(containingFile), name)
          if (name.endsWith(extension)) {
            // TODO: add to resolution cache?
            console.log("resolved", resolved)
            return {
              resolvedFileName: resolved,
              extension,
              isExternalLibraryImport: false,
            }
          }
        }

        // console.log("failed to resolve", name, containingFile)//, resolution.failedLookupLocations)
        return undefined
      });
    },
    readDirectory(path: string, extensions?: readonly string[], exclude?: readonly string[], include?: readonly string[], depth?: number): string[] {
      // Add .civet extension to the list of extensions
      extensions = extensions?.concat([".civet"])
      console.log("readDirectory", path, extensions, exclude, include, depth)
      return sys.readDirectory(path, extensions, exclude, include, depth)
    },
    /**
     * Add a VSCode TextDocument source file.
     * The VSCode document should keep track of its contents and version.
     * I think we just need to update the project version on change events.
     */
    addDocument(doc: TextDocument) {
      const path = fileURLToPath(doc.uri)

      // Clear the cached snapshot for this document
      snapshotMap.delete(path)

      if (scriptFileNames.has(path)) {
        // We already have the document but it may have updated
        projectVersion++
        return
      }

      documents.add(doc)
      scriptFileNames.add(path)
      pathMap.set(path, doc)
      projectVersion++
    },
    getMeta(path: string) {
      return fileMetaData.get(path)
    },
    getProjectVersion() {
      return projectVersion.toString();
    },
    getCompilationSettings() {
      return compilationSettings;
    },
    // TODO: Handle source documents and document updates
    getScriptSnapshot(path: string) {
      // console.log("getScriptSnapshot", path)

      return getOrCreatePathSnapshot(path)
    },
    getScriptVersion(path: string) {
      return pathMap.get(path)?.version.toString() || "0"
    },
    getScriptFileNames() {
      return Array.from(scriptFileNames)
    },
    writeFile(fileName: string, content: string) {
      console.log("write", fileName, content)
    }
  });

  /**
   * Get the source code for a path.
   * Use the VSCode document if it exists otherwise use the file system.
   */
  function getPathSource(path: string): string {
    const doc = pathMap.get(path)
    if (doc) {
      return doc.getText()
    }

    if (sys.fileExists(path)) {
      return sys.readFile(path)!
    }

    return ""
  }

  function getOrCreatePathSnapshot(path: string) {
    let snapshot = snapshotMap.get(path)
    if (snapshot) return snapshot

    const source = getPathSource(path)
    const ext = getExtensionFromPath(path)

    const transpiler = transpilers.get(ext)
    if (transpiler) {
      const result = transpiler(path, source)
      if (!result) return

      const { code: transpiledCode, sourceMap } = result

      createOrUpdateMeta(path, transpiledCode, sourceMap?.data.lines)
      snapshot = ScriptSnapshot.fromString(transpiledCode)
    } else {
      snapshot = ScriptSnapshot.fromString(source)
    }

    snapshotMap.set(path, snapshot)
    return snapshot
  }

  function createOrUpdateMeta(path: string, code: string, sourcemapLines?: SourceMap["data"]["lines"]) {
    let meta = fileMetaData.get(path)

    if (!meta) {
      // TODO: does this extension matter?
      const transpiledDoc = TextDocument.create(path.replace(civetExtension, ".ts"), "typescript", 0, code)

      meta = {
        sourcemapLines,
        transpiledDoc,
      }

      fileMetaData.set(path, meta)
    } else {
      meta.sourcemapLines = sourcemapLines
      const doc = meta.transpiledDoc
      TextDocument.update(doc, [{ text: code }], doc.version + 1)
    }
  }
}

function TSService(projectURL = "./") {
  const logger = console
  const projectPath = fileURLToPath(projectURL)
  const tsConfigPath = `${projectPath}tsconfig.json`
  const { config } = readConfigFile(tsConfigPath, sys.readFile)

  const existingOptions = {
    rootDir: projectPath,
    // This is necessary to load .civet files
    allowNonTsExtensions: true,
    // Better described as "allow non-ts, non-json extensions"
    allowJs: true,
  }

  const parsedConfig = parseJsonConfigFileContent(
    config,
    sys,
    projectPath,
    existingOptions,
    tsConfigPath,
    undefined,
    [{
      extension: "civet",
      isMixedContent: false,
      // Note: in order for parsed config to include *.ext files, scriptKind must be set to Deferred.
      // See: https://github.com/microsoft/TypeScript/blob/2106b07f22d6d8f2affe34b9869767fa5bc7a4d9/src/compiler/utilities.ts#L6356
      scriptKind: ts.ScriptKind.Deferred,
    }, {
      extension: "coffee",
      isMixedContent: false,
      scriptKind: ts.ScriptKind.Deferred,
    }]
  )

  // @ts-ignore
  const baseHost = createCompilerHost(parsedConfig)

  const transpilers = new Map<string, Transpiler>([
    ["civet", transpileCivet],
    ["coffee", transpileCoffee],
  ])

  const host = TSHost(parsedConfig.options, baseHost, transpilers)

  const service = createLanguageService(host)

  logger.info("PARSED CONFIG\n", parsedConfig, "\n\n")

  // Use Civet from the project if present
  let Civet: typeof BundledCivetModule
  try {
    const projectRequire = createRequire(projectURL)
    const civetPath = "@danielx/civet"
    Civet = projectRequire(civetPath)

    console.info(`LOADED CIVET: ${path.join(projectURL, civetPath)} \n\n`)
  } catch (e) {
    console.info("USING BUNDLED CIVET")
    Civet = BundledCivetModule
  }

  return Object.assign(service, {
    host
  })

  function transpileCivet(path: string, source: string) {
    try {
      return Civet.compile(source, {
        filename: path,
        sourceMap: true
      })
    } catch (e) {
      console.error(e)
      return
    }
  }
}

function transpileCoffee(path: string, source: string) {
  const { js, sourceMap } = coffeeCompile(source, {
    bare: true,
    filename: path,
    header: false,
    sourceMap: true
  })

  return {
    code: js
  }
}

function getExtensionFromPath(path: string) {
  return path.split(".").pop() || ""
}

export default TSService
