#!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var childProcess = require("child_process");
var moduleverse = require("moduleverse");
var	Q = require("noq").noTry;
var EventEmitter = require("events").EventEmitter;
var crypto = require("crypto");

var verbose = false;

////////////////////////////////////////////////////////////////

function _extend(obj)
{
	var recurse = arguments.callee;
	Array.prototype.slice.call(arguments, 1).forEach(function(source)
	{
		for(var prop in source)
		{
			if(source[prop] instanceof Array)
				obj[prop] = ((obj[prop] instanceof Array)? obj[prop] : []).concat(source[prop]);
			else if((typeof(obj[prop]) == "object") && (typeof(source[prop]) == "object"))
				recurse(obj[prop], source[prop]);
			else
				obj[prop] = source[prop];
		}
	});
	return(obj);
}

function pathExtensionSwap(p, newExt)
{
	return(p.substr(0, p.length - path.extname(p).length) + newExt);
}

//why require("mkdirp") when you can implement it this elegantly?
function mkdirp(p, callback)
{
	var self = arguments.callee;
	fs.exists(p, function(exists)
	{
		if(!exists)
			self(path.dirname(p), function(err)	//if it doesn't exist, ensure the parent does
			{
				if(err)	callback(err);
				else	fs.mkdir(p, callback);	//if the parent exists, create the child
			});
		else
			callback();
	});
};

////////////////////////////////////////////////////////////////

var Config =
{
	baseDir: function baseDir()
	{
		switch(process.platform)
		{
		case "darwin":	return(path.join(process.env["HOME"], "Library/Application Support/Logiblock"));
		default:
		case "linux":	return(path.join(process.env["HOME"], ".logiblock"));
		case "win32":	return(path.join(process.env["APPDATA"], "Logiblock"));
		}
	},
	coreModulesDir: function coreModulesDir()
	{
		return(path.join(this.baseDir(), "modules"));	
	},
	modulesDir: function modulesDir()
	{
		switch(process.platform)
		{
		case "darwin":	return(path.join(process.env["HOME"], "Documents/Logiblock/modules"));
		default:
		case "linux":	return(path.join(process.env["HOME"], "logiblock/modules"));
		case "win32":	return(path.join(process.env["HOMEDIR"], "Logiblock", "modules"));
		}
	},
	cacheDir: function cacheDir()
	{
		return(path.join(this.baseDir(), "cache"));
	},
	sdkName: function sdkName()
	{
		switch(process.platform)
		{
		case "darwin":	return("sdk-arm-gcc-mac64");
		default:
		case "linux":	return("sdk-arm-gcc-linux64");
		case "win32":	return("sdk-arm-gcc-win32");
		}
	},
	gdbServerName: function sdkName()
	{
		switch(process.platform)
		{
		case "darwin":	return("GalagoServer-Mac");
		default:
		case "linux":	return("GalagoServer-linux64");
		case "win32":	return("GalagoServer-win32.exe");
		}
	},
	
	env: function Config_env(pathsTable)
	{
		var e =
		{
			"PATH": path.join(pathsTable.sdk, "bin"),
			"LD_PATH": path.join(pathsTable.sdk, "lib")
		};
		
		if(process.platform == "linux")
			e.LD_LIBRARY_PATH = [	path.join(pathsTable.sdk, "x86_64-unknown-linux-gnu/arm-none-eabi/lib"),
									path.join(pathsTable.sdk, "libexec/gcc/arm-none-eabi/4.7.2")
								].join(":");
		return(e);
	}
};

////////////////////////////////////////////////////////////////

SubProcess.prototype = _extend(new EventEmitter(),
{
	spawn: function SubProcess_spawn(path, args, options)
	{
		var ths = this;
		this.quit();	//terminate existing process

		if(path)
		{
			this._path = path;
			this._args = args || [];
			this._options = options || {};
		}

		ths.emit("start");
		this._process = childProcess.spawn(this._path, this._args, this._options);

		this._process.stdout.setEncoding("utf8");
		this._process.stderr.setEncoding("utf8");

		this._process.on("exit", function(code)
		{
			console.log("subprocess '" + this._path + "' exited with: ", code);
			ths.emit("exit");
			if(ths._restartWhenDied)
			{
				console.log("Respawning sub-process in a moment...");
				setTimeout(function()
				{
					ths.spawn();
				}, 500);
			}
		});

		this._process.stdout.on("data", function(data){ths.emit("stdout", data);});
		this._process.stderr.on("data", function(data){ths.emit("stderr", data);});
	},

	write: function SubProcess_write(data)
	{
		if(this._process)
			this._process.stdin.write(data);
	},

	quit: function SubProcess_quit()
	{
		if(this._process != null)
		{
			this._restartWhenDied = false;
			this._process.kill();
			this._process = null;
		}
	},

	_process: null,
	_path: null,
	_args: null,
	_options: null,
	_restartWhenDied: null,
});
function SubProcess(path, args, options)
{
	EventEmitter.call(this);

	this._restartWhenDied = true;

	var ths = this;
	if(path)
		process.nextTick(function()
		{
			ths.spawn(path, args, options);
		});
}

////////////////////////////////////////////////////////////////

module.exports = (function(){

var _ =
{
	extend: function(obj)
	{
		var recurse = arguments.callee;
		Array.prototype.slice.call(arguments, 1).forEach(function(source)
		{
			for(var prop in source)
			{
				if(source[prop] instanceof Array)
					obj[prop] = ((obj[prop] instanceof Array)? obj[prop] : []).concat(source[prop]);
				else if((typeof(obj[prop]) == "object") && (typeof(source[prop]) == "object"))
					recurse(obj[prop], source[prop]);
				else
					obj[prop] = source[prop];
			}
		});
		return(obj);
	},
};

////////////////////////////////////////////////////////////////

_extend(ParseError.prototype, Error);
function ParseError(message, file)
{
	this.message = message;
	this.file = file;
}

_extend(FileError.prototype, Error);
function FileError(message, file)
{
	this.message = message;
	this.file = file;
}

////////////////////////////////////////////////////////////////

Module.prototype =
{
	rootPath: undefined,
	moduleJson: undefined,
	
	open: function()	//promise
	{
		var promise = Q.defer();

		var pJSONPath = path.join(this.rootPath, "module.json");
		fs.readFile(pJSONPath, "utf8", function(err, data)
		{
			if(err)
				return(promise.reject(new FileError("Could not open module JSON file", pJSONPath)));
			
			try
			{
				if(!(this.moduleJson = JSON.parse(data)))	throw(true);
			}
			catch(e)
			{
				//console.log("Could not parse module.json file at " + pJSONPath + ": ", e);
				return(promise.reject(new ParseError("Could not parse module JSON file", pJSONPath)));
			}
			
			promise.resolve(this.moduleJson);
			
		}.bind(this));

		return(promise.promise);
	},
	
	exists: function()
	{
		return(moduleJson != undefined);
	},
};
function Module(rootPath)
{
	this.rootPath = rootPath;
}

Toolchain.prototype =
{
	resolvePaths: function(paths, basesTable, defaultBase)
	{
		var resolvedPaths = [];
		paths.forEach(function(source)
		{
			var filePath = [];
			if(source.base == "abs")			filePath.push(source.name);	//absolute path
			else
			{
				if(basesTable[source.base])		filePath.push(basesTable[source.base]);
				else							filePath.push(basesTable[defaultBase]);
				if(source.dir)					filePath.push(source.dir);
				if(source.name)					filePath.push(source.name);	//else it's a directory
			}
			
			resolvedPaths.push(_extend({}, source, {base: "abs", dir: undefined, name: path.join.apply(path, filePath)}));
		});
		return(resolvedPaths);
	},
	
	compile: function(pathsTable, output, project, isRootModule)	//promised
	{
		var ths = this, promise = Q.defer(), args = [], fingerprint = fingerprintObject(project);
		
		//gaunt
		if(project.settings && project.settings.gaunt)
			args.push("-nostdlib", "-nodefaultlibs");
		
		//debugging
		if(project.settings && project.settings.debug)
			args.push("-g");
		
		//other compiler flags
		if(project.otherCompilerFlags && (project.otherCompilerFlags instanceof Array))
			args = args.concat(project.otherCompilerFlags);
		
		//add definitions
		if(typeof(project.definitions) == "object")
			for(var k in project.definitions)
				args.push("-D" + k + "=" + project.definitions[k]);
		
		//paths used to resolve complex referenced paths
		pathsTable = _extend({}, pathsTable);
		
		if(verbose)
			console.log("arguments=", pathsTable, output, project);
		
		//only for the root module (where any linking occurs) include the linkFile, if present
		if(isRootModule && project.linkFile)
			this.resolvePaths([project.linkFile], pathsTable, "project").forEach(function(path)
			{
				args.push("-T", path.name);
			});
		
		//resolve and add include files
		if(project.include)
			this.resolvePaths(project.include, pathsTable, "project").forEach(function(path)
			{
				args.push("-I", path.name);
			});
		
		//resolve and add sources

		if(!project.files || (project.files.length == 0))
			return(promise.reject(new Error("Your project does not contain any source files. Please see http://logiblock.com/help for project file instructions.")))

		var sources = project.files.filter(function(f)
		{
			return(f.name && f.name.match(/\.(c|cpp|cc|cxx|s|S|a)$/));
		});

		if(!sources || (sources.length == 0))
			return(promise.reject(new Error("Your project does not contain any buildable source code. Please see http://logiblock.com/help for project file instructions.")))

		sources = this.resolvePaths(sources, pathsTable, "project").map(function(s)	//resolve the sources
		{
			return(s.name);
		});

		//compile!
		var compilerPath = path.join(pathsTable.sdk, "bin", "arm-none-eabi-g++");
		
		if(verbose)
			console.log("compilerPath=", compilerPath, "args=", args, "sources=", sources);

		var objectFiles = [];

		//asyncly loop through sources, building them one-at-a-time, storing the built object-file paths and collecting errors
		(function()
		{
			var next = arguments.callee,
				currentArgs = args.slice(0);	//take the base args as a starting point

			if(isRootModule)
			{
				//if we're building the root, it's ok to build and link everything in one go.
				currentArgs.push("-o", output);	//generate the ELF
				currentArgs = currentArgs.concat(sources);
				sources = [];
			}
			else
			{
				var source = sources.shift(),
					objectFilePath = path.join(Config.cacheDir(), pathExtensionSwap(path.basename(source), "-" + fingerprint + ".o"));

				//add "-o <objectFile> -c <currentSourceFile>" to a copy of the base args
				currentArgs.push("-o", objectFilePath, "-c", source);
				objectFiles.push(objectFilePath);
			}

			if(verbose)
				console.log("build command line:", compilerPath + " " + currentArgs.join(" "), "\n");
			
			var compiler = childProcess.spawn(compilerPath, currentArgs,
			{
				env: Config.env(pathsTable)
			});
			compiler.stdout.setEncoding("utf8");
			compiler.stderr.setEncoding("utf8");
			
			var compileErrors = [];
			var stdout = "", stderr = "";
			
			compiler.stdout.on("data", function(data)
			{
				stdout += data;
			}.bind(this));
			compiler.stderr.on("data", function(data)
			{
				stderr += data;
			}.bind(this));
			compiler.on("exit", function(returnCode)
			{
				if(stdout.length > 0)
					console.log("stdout: ", stdout);
				
				if(stderr.length > 0)
					console.log("stderr: ", stderr);
				
				//for each line of output, see if it matches the way GCC formats an error
				stderr.split("\n").forEach(function(line)
				{
					//this regex looks for errors like:
					//	"./example.cpp:74:2: error: 'mistake' was not declared in this scope"
					//	"./example.cpp:93: undefined reference to `mistake'"
					//and breaks it into:
					//	match[1]: "./example.cpp"
					//	match[2]: "74"
					//	match[3]: "2"
					//	match[4]: " error: 'mistake' was not declared in this scope"
					
					var m = line.match(/^(.*?):(\d+):(\d*):{0,1}(.*)/);
					if(m)
					{
						var compileError = {raw: line, file: m[1], line: m[2], charIndex: m[3] || 0, err: m[4].trim()};
						var last = (compileErrors.length > 0) && compileErrors[compileErrors.length - 1];
						if(		last && (last.file == compileError.file) && (last.line == compileError.line)
								&& (last.charIndex > 0) && (last.charIndex == compileError.charIndex)
							)
						{
							//merge into last
							last.raw += "\n" + compileError.raw;
							last.err += "\n" + compileError.err;
						}
						else
							compileErrors.push(compileError);	//add new
					}
				});
				
				if(sources.length > 0)
					next();
				else
				{
					return((isRootModule? Q.resolve() : ths.makelib(pathsTable, output, objectFiles)).then(function(result)
					{
						if(result)
							stderr += result.errors;

						promise.resolve(		//complete with no error
						{
							output: output,
							compileErrors: compileErrors,
							returnCode: (result && result.returnCode) || returnCode,	//if either is nonzero, return it
							stdout: stdout,
							stderr: stderr
						});

					}).fail(function(e)
					{
						promise.reject(e);
					}));
				}

			}.bind(this));

		})();	//end of async loop and invocation

		return(promise.promise);
	},
	
	assemble: function(output, sourceFileArray, settings)	//might not need
	{
		;
	},
	
	link: function(output, objectFileArray, settings)	//might not need
	{
		;
	},
	
	makelib: function(pathsTable, outputFile, objectFiles)	//promised
	{
		var promise = Q.defer(), args = ["q", outputFile].concat(objectFiles);
		
		fs.unlink(outputFile, function(err)
		{
			if(err && (err.code != "ENOENT"))
				return(promise.reject(err));

			var ar = childProcess.spawn(path.join(pathsTable.sdk, "bin", "arm-none-eabi-ar"), args,
			{
				env: Config.env(pathsTable)
			});
			ar.stdout.setEncoding("utf8");
			ar.stderr.setEncoding("utf8");
			var stdout = "", stderr = "";
			
			ar.stdout.on("data", function(data)
			{
				stdout += data;
			}.bind(this));
			ar.stderr.on("data", function(data)
			{
				stderr += data;
			}.bind(this));
			ar.on("exit", function(returnCode)
			{
				promise.resolve(
				{
					returnCode: returnCode,
					output: stdout,
					errors: stderr
				});
			}.bind(this));
		});
		return(promise.promise);
	},

	makebin: function(pathsTable, outputFile, objectFile)	//promise
	{
		var promise = Q.defer();
		var args = ["-j", ".text", "-O", "binary", objectFile, outputFile];
		
		var objcopy = childProcess.spawn(path.join(pathsTable.sdk, "bin", "arm-none-eabi-objcopy"), args,
		{
			env: Config.env(pathsTable)
		});
		objcopy.stdout.setEncoding("utf8");
		objcopy.stderr.setEncoding("utf8");
		var stdout = "", stderr = "";
		
		objcopy.stdout.on("data", function(data)
		{
			stdout += data;
		}.bind(this));
		objcopy.stderr.on("data", function(data)
		{
			stderr += data;
		}.bind(this));
		objcopy.on("exit", function(returnCode)
		{
			promise.resolve(
			{
				returnCode: returnCode,
				output: stdout,
				errors: stderr
			});
		}.bind(this));

		return(promise.promise);
	},
	
	disassemble: function(pathsTable, outputFile, objectFileArray)	//promise
	{
		var promise = Q.defer();

		var args = ["-d"];
		
		args = args.concat(objectFileArray);
		
		var output = fs.createWriteStream(outputFile);

		var disassembler = childProcess.spawn(path.join(pathsTable.sdk, "bin", "arm-none-eabi-objdump"), args,
		{
			env: Config.env(pathsTable)
		});
		disassembler.stdout.setEncoding("utf8");
		disassembler.stderr.setEncoding("utf8");
		var stdout = "", stderr = "";
		
		disassembler.stdout.pipe(output);
		
		disassembler.stderr.on("data", function(data)
		{
			stderr += data;
		}.bind(this));
		disassembler.on("exit", function(returnCode)
		{
			promise.resolve(
			{
				returnCode: returnCode,
				disassembly: stdout,
				errors: stderr
			});
		}.bind(this));

		return(promise.promise);
	},
	
	reportSize: function(pathsTable, objectFileArray)	//promise
	{
		var promise = Q.defer();

		var args = [].concat(objectFileArray);
		
		var elfSize = childProcess.spawn(path.join(pathsTable.sdk, "bin", "arm-none-eabi-size"), args,
		{
			env: Config.env(pathsTable)
		});
		elfSize.stdout.setEncoding("utf8");
		elfSize.stderr.setEncoding("utf8");
		var stdout = "", stderr = "";
		
		elfSize.stdout.on("data", function(data)
		{
			stdout += data;
		}.bind(this));
		
		elfSize.stderr.on("data", function(data)
		{
			stderr += data;
		}.bind(this));
		elfSize.on("exit", function(returnCode)
		{
			//parse size report in Berkeley format (see `man size`)
			var lines = stdout.split("\n");

			lines.shift();	//discard the first line (the legend)

			var sizes = [];
			for(var lineIdx in lines)
			{
				var fields = lines[lineIdx].match(/\S+/g);
				if(fields)
					sizes.push({name: fields.pop(), size: parseInt(fields.shift())});
			}

			promise.resolve(
			{
				returnCode: returnCode,
				sizes: sizes,
				errors: stderr
			});
		}.bind(this));

		return(promise.promise);
	}
};
function Toolchain()
{
}


Targets.prototype =
{
	open: function(targetsJsonFile)	//promise
	{
		var promise = Q.defer();

		fs.readFile(targetsJsonFile, "utf8", function(err, data)
		{
			if(err)	return(promise.reject(new FileError("Could not load targets JSON file", targetsJsonFile)));
			
			var targets;
			try
			{
				if(!(targets = JSON.parse(data)))	throw(true);
			}
			catch(e)
			{
				//console.warn("Could not parse targets.json file at " + targetsJsonFile + ": ", e);
				return(promise.reject(new ParseError("Could not parse targets JSON file", targetsJsonFile)));
			}
			
			this.add(targets.targets);
			promise.resolve(targets.targets);
			
		}.bind(this));

		return(promise.promise);
	},
	add: function(arrayOfTargets)
	{
		arrayOfTargets.forEach(function(target)
		{
			//crudely validate the target
			if(!target.name)
				return(true);	//continue
			//...
			
			//this could simply replace an existing definition, which is expected
			this.targets[target.name] = target;
			
		}.bind(this));
	},
	resolve: function(targetName, moduleJson)
	{
		var target = this.targets[targetName];
		if(!target)
			return(undefined);
		
		target = _extend({}, target);
		if(target["extends"])
		{
			var ancestor = this.resolve(target["extends"]);
			if(ancestor)
				_extend(target, ancestor, {name: target.name});
		}
		
		if(moduleJson)
			_extend(target, moduleJson, {name: moduleJson.name});
		
		return(target);
	}
};
function Targets()
{
	this.targets = {};
}

////////////////////////////////////////////////////////////////

function fingerprintObject(obj)
{
	//mildly canonicalize the object to produce a consistent serializeation we can hash. Obviously this is no ASN-1.
	var json = {};
	Object.keys(obj).sort().forEach(function(k){json[k]=obj[k];});	//legilographically sort keys
	
	var print = crypto.createHash("md5");
	print.update(JSON.stringify(json));
	return(print.digest("hex"));
}


////////////////////////////////////////////////////////////////


ProjectBuilder.prototype =
{
	//dirs must contain
	//  sdk: sdk root - ./bin/gcc
	//  project: active project root - ./module.json
	//	module: module cache root - ./modulename/version
	//  output: output directory - ./out.elf
	build: function(dirs)
	{
		var promise = Q.defer();

		//moduleverse.debug(true);
		
		var ths = this, moduleCache = {}, modulePromises = {}, buildList = [];
		
		var recurse = function(moduleOwnerAndName, moduleDir)
		{
			var promise = Q.defer();
			
			new Module(moduleDir).open().then(function(moduleJson)
			{
				if(verbose)
					console.log("opened module at", moduleDir, moduleJson);

				moduleJson.dir = moduleDir;
				moduleCache[moduleOwnerAndName] = moduleJson;
				
				//resolve dependencies
				var deps = [], promises = [];
				Object.keys(moduleJson.dependencies).forEach(function(o, i)
				{
					//validate
					if(!o || (typeof o != "string"))
						return(promise.reject(new Error("invalid dependency: " + String(o))));
					
					var x = o.split("/");
					if(!x || (x.length != 2))
						return(promise.reject(new Error("dependency is malformed: " + String(o))));
					
					//is it in the cache already, and of a satisfactory version?	//@@add proper version check
					if(moduleCache[o])
					{
						if(verbose)
							console.log("=>", moduleOwnerAndName, "relies on", o, ", which is already cached so I won't resolve its dependencies");
						return;
					}
					
					deps.push({index: i, orig: o, owner: x[0], name: x[1], version: moduleJson.dependencies[o]});
					
					promises.push(moduleverse.findLocalInstallation(Config.coreModulesDir(), x[0], x[1]));
				});
				
				Q.all(promises).then(function(modules)
				{
					var p = [];
					for(var i = 0; i < deps.length; i++)
					{
						if(modules[i] == undefined)	//not able to load module deps[i]
						{
							//queue a download operation; if that succeeds, recurse, else we can't build so bail out completely
							(function()
							{
								var downloadModuleName = deps[i].orig,
									downloadPromise = new moduleverse.ModuleUpdater(	Config.coreModulesDir(),
																						deps[i].owner,
																						deps[i].name,
																						deps[i].version
																					).promise;
								p.push(downloadPromise);
								
								downloadPromise.then(function(coreModulesDir)
								{
									//misnomer: the loop is effectively restarted to parse the newly-downloaded module
									return(recurse(downloadModuleName, coreModulesDir));
								}).fail(function()
								{
									var e = new Error(		"error: unable to resolve dependency "
															+ downloadModuleName
															+ " required by "
															+ ((moduleOwnerAndName == "local")? "the current project" : moduleOwnerAndName)
														);
									e.file = path.join(moduleDir, "module.json");
									e.line = 1;
									return(Q.reject(e));
								});

							})();
							continue;
						}
						
						var fullModuleName = deps[i].orig;
						
						if(moduleCache[fullModuleName])
						{
							if(verbose)
								console.log("=>", moduleOwnerAndName, "relies on", fullModuleName, " which is already cached; using existing promise");
							
							p.push(modulePromises[fullModuleName]);
							continue;	//depend on the one we're already evaluating (or have evaluated)
						}
						
						moduleCache[fullModuleName] = true;	//cache it to be used by parallel and future inquiries
						p.push(modulePromises[fullModuleName] = recurse(deps[i].orig, modules[i].__path));
					}
					
					//chain to a step that joins all disparate find/download operations for this module
					return(Q.all(p).then(function()
					{
						Object.keys(moduleJson.dependencies || {}).forEach(function(dep)
						{
							ths.inheritDependencyProperties(dirs, moduleJson, moduleCache[dep]);
						});

						buildList.push(moduleJson);
						
						promise.resolve();
					}));
					
				}).fail(function(e)
				{
					promise.reject(e);
				});
				
			}).fail(function(e)
			{
				console.warn("Could not open the module at " + moduleDir);
				promise.reject(e);
			});
			return(promise.promise);
		};
		
		var mkdirPromise = Q.defer();

		mkdirp(Config.cacheDir(), function(err)
		{
			if(err)	mkdirPromise.reject();
			else	mkdirPromise.resolve();
		});

		Q.all([		ths.targets.open(path.join(dirs.platform, "targets.json")),
					mkdirPromise
				])
		.then(function()
		{
			recurse("local", dirs.project).then(function(e)
			{
				if(verbose)
					console.log("\ndone:", buildList);

				//build each project in the buildList - each as object files except the last, which must be built
				//  as an aggregate of all preceding object files and its own sources.
				var libs = [], i = 0;
				(function()
				{
					var next = arguments.callee, moduleJson = buildList[i], modulePath = moduleJson.dir,
						fingerprint = fingerprintObject(buildList[i]);

					var targetName = (moduleJson.compatibleWith && moduleJson.compatibleWith[0]) || "Galago4",	//hack, should be specified as a high-level param
						resolvedModuleJSON = ths.targets.resolve(targetName, moduleJson);

					dirs.project = modulePath;	//specialize the dir table for this module

					var isRootModule = ((i + 1) == buildList.length), outputName;
					if(isRootModule)
					{
						outputName = path.join(modulePath, resolvedModuleJSON.name + ".elf");
						resolvedModuleJSON.files = resolvedModuleJSON.files.concat(libs.reverse().map(function(o)
						{
							return({base: "abs", name: o});
						}));
					}
					else
						libs.push(outputName = path.join(Config.cacheDir(), pathExtensionSwap(path.basename(resolvedModuleJSON.name), "-" + fingerprint + ".a")));

					if(verbose)
						console.log("compiling ", isRootModule, modulePath, resolvedModuleJSON);
					
					ths.toolchain.compile(		dirs,
												outputName,
												resolvedModuleJSON,
												isRootModule
											).then(function(compileResult)
					{
						//if(verbose)
							console.log("built module " + modulePath);
						
						//complete successfully, but signal a failed build.
						if(compileResult.returnCode !== 0)
							return(promise.resolve(compileResult));

						if(++i < buildList.length)
							next();
						else
							promise.resolve(compileResult);

					}).fail(function()
					{
						promise.reject(new Error("Module at " + modulePath + " could not be built."));
					});

				})();

			}).fail(function(e)
			{
				//if(!e.code || (e.code != 404))
				//	e = new Error("Cannot build because a dependency of this project could not be resolved, identified, loaded or updated.");
				console.warn("Cannot build because a dependency of this project could not be resolved, identified, loaded or updated");
				if(e.stack)
					console.warn(e.stack);
				promise.reject(e);
			});
		});

		return(promise.then(function(compileResult)
		{
			if(verbose)
				console.log("compile result:", compileResult);

			compileResult.disasmPath = pathExtensionSwap(compileResult.output, ".disasm.txt");

			return(ths.toolchain.disassemble(dirs, compileResult.disasmPath, [compileResult.output]).then(function(result)
			{
				compileResult.binaryPath = pathExtensionSwap(compileResult.output, ".bin");
				return(ths.toolchain.makebin(dirs, compileResult.binaryPath, compileResult.output));

			}).then(function(binResults)
			{
				return(ths.toolchain.reportSize(dirs, compileResult.output));

			}).then(function(sizeResults)
			{
				compileResult.sizes = sizeResults.sizes;

				return(compileResult);
			}));
		}));
	},

	inheritDependencyProperties: function ProjectBuilder_inheritDependencyProperties(dirs, receiver, donor)
	{
		//console.log(receiver.name + " <- inherits - " + donor.name);

		//take certain properties of this module and roll them into the parent
		var dirsTable = _extend({}, dirs, {project: donor.dir});
		
		//katamari the includes
		if(donor.include && (donor.include instanceof Array))
			receiver.include = (receiver.include || (receiver.include = [])).concat(
					this.toolchain.resolvePaths(	donor.include.filter(function(f)
													{
														return(f.export === true);
													}),
													dirsTable,
													"project"
												)
			);

		//katamari the preprocessor defines
		if(donor.definitions && (typeof donor.definitions == "object"))
			_extend(receiver.definitions || (receiver.definitions = {}), donor.definitions);
		
		//overwrite the linker script file, if present
		if(donor.linkFile && !receiver.linkFile)
			receiver.linkFile = this.toolchain.resolvePaths([donor.linkFile], dirsTable, "project")[0];
	}
};
function ProjectBuilder()
{
	this.toolchain = new Toolchain();
	this.targets = new Targets();
}

///////////////////////////////////////////////////////////////

GDBServerProcess.prototype = _extend(new EventEmitter(),
{
	onStatusReport: function GDBServerProcess_onStatusReport(data)
	{
		this._buffer += data;
		
		var events = this._buffer.trim().split("\n");
		for(var i = 0; i < events.length; i++)
		{
			var event;
			try
			{
				event = JSON.parse(events[i]);
			}
			catch(e)
			{
				//if the last element is truncated, try again when more data arrives
				if(i == (events.length - 1))
				{
					this._buffer = events[i];
					return;
				}
				else	//else it was corrupt (extremely rare), simply ignore the message.
					console.log("Undecipherable message: ", e, events[i]);
			}
			this.emit("event", event);
		}
		this._buffer = "";
	},

	getStatus: function GDBServerProcess_getStatus()
	{
		this._serverProcess.write("?\n");	//provoke a status update
	},

	_buffer: null,
	_serverProcess: null,
});
function GDBServerProcess()
{
	EventEmitter.call(this);
	
	this._buffer = "";
	this._serverProcess = new SubProcess(path.join(__dirname, Config.gdbServerName()), ["--interactive"]);
	this._serverProcess.on("stdout", this.onStatusReport.bind(this));
}

///////////////////////////////////////////////////////////////

return(
{
	Config: Config,
	SubProcess: SubProcess,
	ProjectBuilder: ProjectBuilder,
	GDBServerProcess: GDBServerProcess
});

})();

///////////////////////////////////////////////////////////////

if(require.main == module)
{
	process.stdin.on("data", function(){});	//keeps node alive

	var builder = new module.exports.ProjectBuilder();

	var options =
	{
		build: true,
		runDriver: false,
		install: false,
		runGDB: false,
		experimental: false,
		projectBase: undefined
	};

	for(var i = 2; i < process.argv.length; i++)
	{
		switch(process.argv[i])
		{
		case "-i":
		case "-install":
		case "--install":
			//options.build = false;
			options.runDriver = true;
			options.runGDB = false;
			options.install = true;
			options.experimental = true;
			break;
		case "-n":
		case "-init":
		case "--init":
			options.init = true;
			break;
		case "-d":
		case "-debug":
		case "--debug":
			//options.build = false;
			options.runDriver = true;
			options.runGDB = true;
			options.experimental = true;
			break;
		default:
			if(options.projectBase == undefined)
				options.projectBase = process.argv[i];
			else
			{
				console.warn("Too many projects specified!");
				process.exit();
			}
		}
	}

	if(options.projectBase == undefined)
		options.projectBase = process.cwd();
	else if(options.projectBase.substr(-11) == "module.json")
		options.projectBase = options.projectBase.substr(0, options.projectBase.length - 11);

	if(verbose)
		console.log("options:", options);

	//@@asyncly determine the sdk path.
	//  The platform (this), project and output paths are determined without lookup.
	//  Module paths of dependencies are determined recursively.
	var sdkPromise = moduleverse.findLocalInstallation(Config.coreModulesDir(), "logiblock", Config.sdkName());	//take the latest installed SDK

	sdkPromise.then(function(sdkBase)
	{
		if(sdkBase == undefined)	//no SDK! download it?
		{
			console.log("Did not find an SDK on your system.  I will try to download the latest one\n and then build your project.\nNote: you must have an internet connection to update.");

			var percent = "0.00", lastFile = "", blank = "                        ";

			var downloadPromise = new moduleverse.ModuleUpdater(Config.coreModulesDir(), "logiblock", Config.sdkName(), undefined)
				.on("version", function(ver)
				{
					console.log("Downloading SDK version: " + ver);
				})
				.on("progress", function(loaded, total)
				{
					percent = (100 * loaded / total).toFixed(2);
					process.stdout.write("Downloaded: " + percent + "% - " + lastFile + "..." + blank.substr(lastFile.length) + "\r");
				})
				.on("file", function(file)
				{
					lastFile = path.basename(file);
					if(lastFile.length > 20)
						lastFile = lastFile.substr(0, 20);
					process.stdout.write("Downloaded: " + percent + "% - " + lastFile + "..." + blank.substr(lastFile.length) + "\r");
				}).promise;

			var sdkPromise = Q.defer();

			downloadPromise.then(function(sdkBase)
			{
				console.log("Downloaded and installed successfully!");
				sdkPromise.resolve(sdkBase);
			}).fail(function(err)
			{
				console.err("Could not download the SDK! Check for more detailed help or instructions at:\nhttp://logiblock.com/ide");
				sdkPromise.reject(err);
			});
			
			return(sdkPromise.promise);
		}
		else
			return(sdkBase.__path);
		
	}).then(function(sdkBasePath)
	{
		//now that we have an SDK, invoke GDB or build as appropriate

		if(options.init)
		{
			if(fs.existsSync(path.join(options.projectBase, "module.json")))
			{
				console.warn("Error: There's already a project here, I won't overwrite it.");
				process.exit(-1);
			}

			fs.writeFileSync(path.join(options.projectBase, "module.json"), JSON.stringify(
			{
				name: "example",
				version: "0.1",
				files: [{name: "main.cpp"}],
				compatibleWith: ["Galago4"]
			}));
			fs.writeFileSync(path.join(options.projectBase, "main.cpp"), "#include <GalagoAPI.h>\nusing namespace Galago;\n\nstruct Context\n{\n\tint iteration;\n\n\tContext(void): iteration(0) {}\n};\n\nvoid statusTask(void* c, Task, bool)\n{\n\tContext* context = (Context*)c;\n\n\tio.serial.write(\"\\r\\n Iteration \");\n\tio.serial.write(context->iteration);\n\tcontext->iteration++;\n\n\tio.led = !io.led;\n\n\tsystem.when(system.delay(500), statusTask, c);\n}\n\nint main(void)\n{\n\tio.serial.start(38400);\n\n\tsystem.when(system.delay(500), statusTask, new Context());\n\n\twhile(true)\n\t\tsystem.sleep();\n}\n");
			console.log("wrote: ", path.join(options.projectBase, "main.cpp"));
		}

		if(options.build)
		{
			console.log("Building...");
			builder.build(
			{
				sdk: sdkBasePath,
				project: options.projectBase,
				platform: path.resolve(__dirname, ".."),
				module: Config.coreModulesDir(),
				output: options.projectBase		//@@for now

			}).fail(function(err)
			{
				console.warn("Compiling failed!  Error:");
				console.warn(err);
				process.exit(-1);

			}).then(function(result)	//outputFile, result)
			{
				//console.log("compile() RESULT: ", result);
				/*
				for(var i = 0; i < result.compileErrors.length; i++)
				{
					console.log(result.compileErrors[i]);
				}
				*/
				
				if(result.returnCode == 0)
				{
					var sizeStr;
					if(result.sizes && (result.sizes.length > 0))
					{
						var moduleSize = result.sizes[0].size;
						
						if(moduleSize >= 1048576)
							sizeStr = (moduleSize / 1048576).toFixed(2) + "MB";
						else if(moduleSize >= 1024)
							sizeStr = (moduleSize / 1024).toFixed(2) + "KB";
					}
					else
						sizeStr = "(unknown)";

					console.log("Built successfully, using " + sizeStr + " of 32KB.");	//@@pull size limit from targets

					console.log("\n  ELF output:  " + result.output + "\n  Binary image:  " + result.binaryPath + "\n  Disassembly file:  " + result.disasmPath + "\n");
				}
				else
				{
					console.warn("Did not build successfully.  Please check the compiler warnings and errors list for more information.");
					process.exit(result.returnCode);
				}


				if(options.experimental)
					console.log("\nNOTICE: you have specified an EXPERIMENTAL mode\n  that is known not to work in some cases.\n");

				var installPromise = Q.defer();
				if(options.runDriver)
				{
					var driverOptions = [];
					var driverNoisy = true;

					if(options.install)
						driverOptions.push(result.output);
					else
					{
						console.log("No firmware download requested.");
						driverNoisy = false;
						installPromise.resolve();
					}
					
					var driverProcess = childProcess.spawn(path.join(__dirname, Config.gdbServerName()), driverOptions, {});
					
					process.on("SIGINT", function()
					{
						return(false);
					});

					driverProcess.stdout.setEncoding("utf8");
					driverProcess.stderr.setEncoding("utf8");

					driverProcess.stdout.on("data", function(d)
					{
						if(driverNoisy || (process.platform == "win32"))	//@@special exception for windows - always noisy
							process.stdout.write(d);
					});
					driverProcess.stderr.on("data", function(d)
					{
						if(driverNoisy)
							process.stdout.write(d);

						if(d.match(/Progress 100\.00/) != null)	//@@dirty hack!
						{
							installPromise.resolve();
							driverNoisy = false;
						}
					});

					driverProcess.on("exit", function(code)
					{
						console.warn("Driver terminated unexpectedly!");	//red herring?
					});
				}
				else
					installPromise.resolve();

				if(options.runGDB)
				{
					if(process.platform != "win32")
					{
						var pty = require("./pty.js-prebuilt");
						var keypress = require("keypress");
						
						installPromise.promise.then(function()
						{
							console.log("Starting GDB...");
							var gdbProcess = pty.spawn(path.join(sdkBasePath, "bin", "arm-none-eabi-gdb"), [result.output],
							{
								name: "xterm",
								cwd: options.projectBase,
								env: process.env
							});
							
							gdbProcess.on("data", function(d)
							{
								process.stdout.write(d);
							});

							keypress(process.stdin);
							process.stdin.on("keypress", function(ch, keypress)
							{
								gdbProcess.write((ch !== undefined)? ch : keypress.sequence);
							});
							process.stdin.setRawMode(true);
							process.stdin.resume();

							process.on("SIGINT", function()
							{
								gdbProcess.kill("SIGINT");	//send it right along
								return(false);
							});
							
							gdbProcess.on("exit", function(code)
							{
								process.exit(code);
							});
							gdbProcess.write("target remote localhost:1033\n");	//give it a whirl on the most common port.
						});
					}
					else
						installPromise.promise.then(function()
						{
							//for win32, just run the server and instruct the user to invoke GDB manually
							//  this is because the terminal pass-through isn't possible (or at least equivalent)
							console.log("\nOn Windows, you will need to run GDB manually in a different window.");
						});
				}
				else
					installPromise.promise.then(function()
					{
						if(options.install)
							console.log("Firmware downloaded and execution is paused on the first instruction.\nAttach a debugger, reset or power-cycle the device to run.");
						process.exit(0);
					});
			});
		}

	}).fail(function(error)
	{
		console.warn("Could not build the project! Error: ", error);
	});
}
