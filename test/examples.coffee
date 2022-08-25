{testCase} = require "./helper"

describe "real life examples", ->
  testCase """
    lsp prototype
    ---
    "use coffee-compat"
    # Experimenting with transpiling to TS

    import ts from "typescript"

    const DefaultCompilerOptions =
      allowNonTsExtensions: true
      allowJs: true
      target: ts.ScriptTarget.Latest
      moduleResolution: ts.ModuleResolutionKind.NodeJs
      module: ts.ModuleKind.CommonJS
      allowSyntheticDefaultImports: true
      experimentalDecorators: true

    const fileCache = {}

    const createCompilerHost = (options, moduleSearchLocations) ->
      fileExists = (fileName) ->
        fileCache[fileName]?

      readFile = (fileName) ->
        fileCache[fileName]

      getSourceFile = (fileName, languageVersion, onError) ->
        sourceText = ts.sys.readFile(fileName)

        if sourceText?
          return ts.createSourceFile(fileName, sourceText, languageVersion)

      resolveModuleNames = (moduleNames, containingFile) ->
        resolvedModules = []

        for moduleName of moduleNames
          # try to use standard resolution
          result = ts.resolveModuleName moduleName, containingFile, options, {
            fileExists,
            readFile
          }

          if result.resolvedModule
            resolvedModules.push(result.resolvedModule);
          else
            # check fallback locations, for simplicity assume that module at location
            # should be represented by '.d.ts' file
            for location of moduleSearchLocations
              modulePath = path.join(location, moduleName + ".d.ts")
              if fileExists(modulePath)
                resolvedModules.push({ resolvedFileName: modulePath })

        return resolvedModules
    ---
    "use coffee-compat"
    // Experimenting with transpiling to TS

    import ts from "typescript";

    const DefaultCompilerOptions = {
      allowNonTsExtensions: true,
      allowJs: true,
      target: ts.ScriptTarget.Latest,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      module: ts.ModuleKind.CommonJS,
      allowSyntheticDefaultImports: true,
      experimentalDecorators: true,
    };

    const fileCache = {};

    const createCompilerHost = function(options, moduleSearchLocations) {
      fileExists = function(fileName) {
        ((fileCache[fileName]) != null);
      };

      readFile = function(fileName) {
        fileCache[fileName];
      };

      getSourceFile = function(fileName, languageVersion, onError) {
        sourceText = ts.sys.readFile(fileName);

        if (((sourceText) != null)) {
          return ts.createSourceFile(fileName, sourceText, languageVersion);
        };
      };

      resolveModuleNames = function(moduleNames, containingFile) {
        resolvedModules = [];

        for (moduleName of moduleNames) {
          // try to use standard resolution
          result = ts.resolveModuleName(moduleName, containingFile, options, {
            fileExists,
            readFile,
          });

          if (result.resolvedModule) {
            resolvedModules.push(result.resolvedModule);
          }
          else {
            // check fallback locations, for simplicity assume that module at location
            // should be represented by '.d.ts' file
            for (location of moduleSearchLocations) {
              modulePath = path.join(location, moduleName + ".d.ts");
              if (fileExists(modulePath)) {
                resolvedModules.push({ resolvedFileName: modulePath });
              };
            };
          };
        };

        return resolvedModules;
      };
    };
  """

  testCase """
    react example
    ---
    import React from "react"

    data := [
        {
            key: 1,
            value: "Some label"

            },
            {
            key: 2,
            value: "Another label"
            },
    ]

    Component := () => <>{data.map (x) => <h1>{x.value}</h1> }</>
    ---
    import React from "react";

    const data = [
        {
            key: 1,
            value: "Some label"

            },
            {
            key: 2,
            value: "Another label"
            },
    ];

    const Component = () => <>{data.map((x) => <h1>{x.value}</h1>) }</>;
  """

  testCase """
    variables that start with 'in' should not get confused with 'in' keyword
    ---
    outer := 1

    changeNumbers := ->
      inner := 1
      outer := 10

    inner = "1"
    ---
    const outer = 1;

    const changeNumbers = function() {
      const inner = 1;
      const outer = 10;
    };

    inner = "1";
  """

  describe.skip "maybe later", ->
    testCase """
      if else expression
      ---
      date := if x==1 "a" else "b"
      ---
      const date = x==1 ? "a" : "b";
    """
