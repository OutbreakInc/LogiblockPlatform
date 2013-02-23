module.exports = (function(){

var fs = require("fs");
var childProcess = require("child_process");
var http = require("http");

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



// http://modules.logiblock.com/galago/
// outbreak/gps/versions
//
//
//

Downloader.prototype =
{
}
function Downloader(ownerName, moduleName, version)
{
	http.request("http://modules.logiblock.com/galago/" + ownerName + "/" + moduleName + "/")
}

