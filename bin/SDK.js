#!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var childProcess = require("child_process");
var moduleverse = require("moduleverse");
var	Q = require("q");
var EventEmitter = require("events").EventEmitter;

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

////////////////////////////////////////////////////////////////

var Config =
{
	baseDir: function baseDir()
	{
		switch(process.platform)
		{
		case "darwin":	return(path.join(process.env["HOME"], "Library/Application Support/Logiblock/modules"));
		default:
		case "linux":	return(path.join(process.env["HOME"], ".logiblock/modules"));
		case "win32":	return(path.join(process.env["APPDATA"], "Logiblock", "modules"));
		}
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
	
	open: function(callback)
	{
		var pJSONPath = path.join(this.rootPath, "module.json");
		fs.readFile(pJSONPath, "utf8", function(err, data)
		{
			if(err)
				return(callback(new FileError("Could not open module JSON file", pJSONPath)));
			
			try
			{
				if(!(this.moduleJson = JSON.parse(data)))	throw(true);
			}
			catch(e)
			{
				console.log("parse error: ", e);
				return(callback(new ParseError("Could not parse module JSON file", pJSONPath)));
			}
			
			callback(undefined, this.moduleJson);
			
		}.bind(this));
	},
	
	exists: function()
	{
		return(moduleJson != undefined);
	},
}
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
			if(basesTable[source.base])	filePath.push(basesTable[source.base]);
			else						filePath.push(basesTable[defaultBase]);
			if(source.dir)				filePath.push(source.dir);
			if(source.name)				filePath.push(source.name);	//else it's a directory
			
			resolvedPaths.push(path.join.apply(path, filePath));
		});
		return(resolvedPaths);
	},
	
	compile: function(pathsTable, output, project, callback)
	{
		var args =
		[
			"-o", output,
		];
		
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
		
		//@@if verbose mode
		//console.log("pathsTable=", pathsTable);
		
		if(project.linkFile)
			this.resolvePaths([project.linkFile], pathsTable, "project").forEach(function(path)
			{
				args.push("-T", path);
			});
		
		//resolve and add include files
		if(project.include)
			this.resolvePaths(project.include, pathsTable, "project").forEach(function(path)
			{
				args.push("-I", path);
			});
		
		//resolve and add sources
		//@@check existence of .files property, error in a helpful way if missing
		args = args.concat(this.resolvePaths(project.files, pathsTable, "project"));
		
		//compile!
		var compilerPath = path.join(pathsTable.sdk, "bin", "arm-none-eabi-g++");
		
		//@@if verbose mode
		//console.log("compilerPath=", compilerPath, "args=", args);
		
		var compiler = childProcess.spawn(compilerPath, args,
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
			
			//invoke callback with no error
			callback(undefined,
			{
				compileErrors: compileErrors,
				returnCode: returnCode,
				stderr: stderr
			});
		}.bind(this));
	},
	
	assemble: function(output, sourceFileArray, settings)	//might not need
	{
		;
	},
	
	link: function(output, objectFileArray, settings)	//might not need
	{
		;
	},
	
	makebin: function(pathsTable, objectFile, outputFile, callback)
	{
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
			callback(undefined,
			{
				returnCode: returnCode,
				output: stdout,
				errors: stderr
			});
		}.bind(this));
	},
	
	disassemble: function(pathsTable, objectFileArray, outputFile, callback)
	{
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
			callback(undefined,
			{
				returnCode: returnCode,
				disassembly: stdout,
				errors: stderr
			});
		}.bind(this));
	},
	
	reportSize: function(pathsTable, objectFileArray, callback)
	{
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

			callback(undefined,
			{
				returnCode: returnCode,
				sizes: sizes,
				errors: stderr
			});
		}.bind(this));
	}
}
function Toolchain()
{
}


Targets.prototype =
{
	open: function(targetsJsonFile, callback)
	{
		fs.readFile(targetsJsonFile, "utf8", function(err, data)
		{
			if(err)	return(callback(new FileError("Could not load targets JSON file", targetsJsonFile)));
			
			var targets;
			try
			{
				if(!(targets = JSON.parse(data)))	throw(true);
			}
			catch(e)
			{
				console.log("parse error: ", e);
				return(callback(new ParseError("Could not parse targets JSON file", targetsJsonFile)));
			}
			
			this.add(targets.targets);
			callback(undefined);
			
		}.bind(this));
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
}
function Targets()
{
	this.targets = {};
}


////////////////////////////////////////////////////////////////


//global setting!
/*
var sdkBase = "../SDK6/";
var platformBase = sdkBase + "../platform/";

var toolchain = new Toolchain(sdkBase);

var targets = new Targets();

targets.open(platformBase + "targets.json", function(err)
{
	if(err)
	{
		console.log("error: ", err);
		return;
	}
	
	var module = new Module(".");

	module.open(function(err, moduleJson)
	{
		if(err)
		{
			console.log("error: ", err);
			return;
		}
		
		var targetName = moduleJson.compatibleWith[0];	//@@hack
		
		var settings = targets.resolve(targetName, moduleJson);
		
		if(!settings)
		{
			console.log("could not resolve target: " + targetName);
			return;
		}
		
		console.log("settings: ", settings);
		
		toolchain.compile("out.elf", {"project": ".", "platform": platformBase}, settings, function(err, compileResult)
		{
			console.log("compilation complete: ", compileResult);
			
			toolchain.disassemble(["out.elf"], function(err, result)
			{
				console.log("disassembly complete: ", result);
			});
		});
	});
});
*/

Compiler.prototype =
{
	toolchain: null,
	targets: null,
	
	//dirs must contain
	//  sdk: sdk root - ./bin/gcc
	//  project: active project root - ./module.json
	//	module: module cache root - ./modulename/version
	//  output: output directory - ./out.elf
	compile: function(dirs, callback)
	{
		var ths = this;
		this.targets.open(path.join(dirs.platform, "targets.json"), function(err)
		{
			if(err)	return(callback(err));
			
			var project = new Module(dirs.project);
			project.open(function(err, moduleJson)
			{
				if(err)	return(callback(err));
				
				var settings;
				
				if((moduleJson.compatibleWith != undefined) && (moduleJson.compatibleWith.length > 0))
				{
					var targetName = moduleJson.compatibleWith[0];	//@@hack!
					
					settings = ths.targets.resolve(targetName, moduleJson);
					
					if(!settings)
						return(callback(new Error("Could not resolve target '" + targetName + "'")));
				}
				else
					settings = moduleJson;	//no dependencies	//@@should this be implemented as targets.resolve(undefined, {...})?
				
				var deps = [];
				//resolve dependencies
				for(var depNum in settings.dependencies)
				{
					var depName = settings.dependencies[depNum];
					//@@filter depName to replace "/" with "+" here??
					console.log("Matching dependency: ", Config.modulesDir(), depName);
					deps.push(moduleverse.findLocalInstallation(Config.modulesDir(), depName, depName));
				}

				var build = function build(dependencyJSON)
				{
					var outputDir = (dirs.output || dirs.project || ".")
					var outputName = path.join(outputDir, "module.elf");
					ths.toolchain.compile(dirs, outputName, settings, function(err, compileResult)
					{
						//console.log("compilation complete: ", compileResult);
						if(err)	return(callback(err));
						
						compileResult.disasmPath = path.join(outputDir, "module.disasm.txt");
						ths.toolchain.disassemble(dirs, [outputName], compileResult.disasmPath, function(err, result)
						{
							compileResult.binaryPath = path.join(outputDir, "module.bin");
							ths.toolchain.makebin(dirs, outputName, compileResult.binaryPath, function(err, binResults)
							{
								ths.toolchain.reportSize(dirs, outputName, function(err, sizeResults)
								{
									compileResult.sizes = sizeResults.sizes;

									callback(undefined, outputName, compileResult);
								});
							});
						});
					});
				};
				
				if(deps.length > 0)
					Q.all(deps).then(build);
				else
					build([]);
			});
		});
	}
};
function Compiler()
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
	Compiler: Compiler,
	GDBServerProcess: GDBServerProcess
});

})();

///////////////////////////////////////////////////////////////

if(require.main == module)
{
	process.stdin.on("data", function(){});	//keeps node alive

	var compiler = new module.exports.Compiler();

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

	//@@asyncly determine the sdk path.
	//  The platform (this), project and output paths are determined without lookup.
	//  Module paths of dependencies are determined recursively.
	var sdkPromise = moduleverse.findLocalInstallation(Config.baseDir(), "logiblock", Config.sdkName());	//take the latest installed SDK

	sdkPromise.then(function(sdkBase)
	{
		if(sdkBase == undefined)	//no SDK! download it?
		{
			console.log("Did not find an SDK on your system.  I will try to download the latest one\n and then build your project.\nNote: you must have an internet connection to update.");

			var percent = "0.00", lastFile = "", blank = "                        ";

			var downloadPromise = new moduleverse.ModuleUpdater(Config.baseDir(), "logiblock", Config.sdkName(), undefined)
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
			compiler.compile(
			{
				sdk: sdkBasePath,
				project: options.projectBase,
				platform: path.resolve(__dirname, ".."),
				module: Config.baseDir(),
				output: options.projectBase,	//@@for now
			}, function(err, outputFile, result)
			{
				if(err)
				{
					console.warn("Compiling failed!  Error:");
					console.warn(err);
					process.exit(-1);
				}
				else
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

						console.log("\n  ELF output:  " + outputFile + "\n  Binary image:  " + result.binaryPath + "\n  Disassembly file:  " + result.disasmPath + "\n");
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
							driverOptions.push(outputFile);
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
								var gdbProcess = pty.spawn(path.join(sdkBasePath, "bin", "arm-none-eabi-gdb"), [outputFile],
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
				}
			});
		}

	}).fail(function(error)
	{
		console.warn("Could not build the project! Error: ", error);
	});
}
