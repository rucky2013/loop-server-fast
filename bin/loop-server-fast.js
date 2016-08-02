#!/usr/bin/env node
/*

Fast Loop-Server reader - runs an http server which accepts requests like the PHP software, and quickly reads the results ready for display on-screen.
To be used in the most common cases only (i.e. it doesn't handle bulk message downloads etc.)

The loop-server config.json contains the settings for this server.
Usage:  node loop-server-fast.js config/path/config.json [-production]


Testing https connection:    
openssl s_client -CApath /etc/ssl/certs -connect yourdomain.com:5566

*/



var multiparty = require('multiparty');
var http = require('http');
var https = require('https');
var util = require('util');
var path = require("path");
require("date-format-lite");
var mv = require('mv');
var fs = require('fs');
var exec = require('child_process').exec;
var drivelist = require('drivelist');
var uuid = require('node-uuid');
var fsExtra = require('fs-extra');
var request = require("request");
var needle = require('needle');
var readChunk = require('read-chunk'); // npm install read-chunk 
var imageType = require('image-type');
var shredfile = require('shredfile')();
var async = require('async');
var mysql = require('mysql');
var os = require('os');


var httpsFlag = false;				//whether we are serving up https (= true) or http (= false)
var serverOptions = {};				//default https server options (see nodejs https module)
var listenPort = 3277;				//default listen port


if((process.argv)&&(process.argv[2])){
  var loopServerConfig = process.argv[2];
} else {
  
  console.log("Usage: node loop-server-fast.js config/path/config.json [-production]");
  process.exit(0);
}




var config = JSON.parse(fs.readFileSync(loopServerConfig));

if((process.argv[3]) && (process.argv[3] == '-production')){
  var cnf = config.production;
} else {
  var cnf = config.staging;
}
 


var connection = mysql.createConnection({
  host     : cnf.db.hosts[0],
  user     : cnf.db.user,
  password : cnf.db.pass,
  database : cnf.db.name
});
 
connection.connect();


function cleanData(str)
{
	//TODO clean for database requests
	return str;
}


function trimChar(string, charToRemove) {
    while(string.substring(0,1) == charToRemove) {
        string = string.substring(1);
    }

    while(string.slice(-1) == charToRemove) {
        string = string.slice(0, -1); 
    }

    return string;
}




function readSession(sessionId, cb)
{
	
		/*     	$sql = "SELECT * FROM php_session WHERE session_id='" .clean_data($session_id) ."'";
        $result = dbquery($sql)  or die("Unable to execute query $sql " . dberror());
		while($row = db_fetch_array($result))
		{
          	$fieldarray[] = $row;
        }
        

        
        if (isset($fieldarray[0]['session_data'])) {
            $this->fieldarray = $fieldarray[0];
             
            return $fieldarray[0]['session_data'];
        } else {
            
            return '';  // return an empty string
        } // if
        
        Sample session record
        | sgo3vosp1ej150sln9cvdslqm0 | 736     | 2016-06-09 16:04:03 | 2016-06-26 16:40:54 | view-count|i:1;logged-user|i:736;user-ip|s:15:"128.199.221.111";layer-group-user|s:0:"";authenticated-layer|s:3:"181";temp-user-name|s:7:"Anon 11";lat|i:51;lon|i:0; 
        */
        var keyValues = {};
        
        
        connection.query("SELECT * FROM php_session WHERE session_id='" + cleanData(sessionId) + "'", function(err, rows, fields) {
        	
        	if (err) throw err;
        	
        	if((rows[0])&&(rows[0].session_data)) {
        		var params = rows[0].session_data.split(";");
				for(var cnt=0; cnt< params.length; cnt++) {
				
					var paramData = params[cnt].split("|");
					if(paramData[1]) {
						//There is some data about this param
						var paramValues = paramData[1].split(":");
						if(paramValues[0] == 'i') {
							//An integer - value proceeds
							var paramValue = paramValues[1];
						} else {
							//A string, [1] is the string length, [2] is the string itself
							var paramValue = trimChar(paramValues[2], '"');
						}
						
						keyValues[paramData[0]] = paramValue;
						console.log("Key:" + paramData[0] + " = " + paramValue);
					} 		
				}
			}
			
			cb(keyValues);
		});

}



function httpHttpsCreateServer(options) {
	if(httpsFlag == true) {
		console.log("Starting https server.");
		https.createServer(options, handleServer).listen(listenPort);
		
		
	} else {
		console.log("Starting http server.");
		http.createServer(handleServer).listen(listenPort);
	}
	
}





function handleServer(_req, _res) {
	
	var req = _req;
	var res = _res;
	var body = [];
	
	//Start ordinary error handling
	req.on('error', function(err) {
	  // This prints the error message and stack trace to `stderr`.
	  console.error(err.stack);
	  
	  res.statusCode = 400;			//Error during transmission - tell the app about it
	  res.end();
	});
	
	req.on('data', function(chunk) {
		body.push(chunk);
	});

	req.on('end', function() {


		//A get request to pull from the server
		// show a file upload form
		var url = req.url;
		var params = querystring.parse(url);
		
		var cookies = parseCookies(req);
		params.sessionId = cookies.ses;		//This is our custom cookie. The other option would be PHPSESSID
		
		var jsonData = searchProcess(params, function(err, data) {
			if(err) {
				console.log(err);
				res.statusCode = 400;
				res.end();
			}
			
			//Prepare the result set for the jsonp result
			var strData = params['callback'] + "(" + JSON.parse( JSON.stringify( data ) ) + ")"; 
			
			res.on('error', function(err){
				//Handle the errors here
				res.statusCode = 400;
				res.end();
			})

			  res.writeHead(200, {'content-type': 'text/plain'});  
	  
	  
			  res.end(strData, function(err) {
				  //Wait until finished sending, then delete locally
				  if(err) {
					 console.log(err);
				  } else {
					//success, do nothing
			
				   }
			  });
		});		//End of process
		
	});  //End of req end
	
}
	    
	  
function parseCookies (request) {
    var list = {},
        rc = request.headers.cookie;

    rc && rc.split(';').forEach(function( cookie ) {
        var parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });

    return list;
}




function searchProcess(params, cb) {

	//Get the session data
	readSession(params.sessionId, function(session) {			//eg. 'sgo3vosp1ej150sln9cvdslqm0'
		console.log("Finished getting session data. Logged user:" + session['logged-user']);




		if((session['logged-user'])&&(session['logged-user'] != '')) {
			//Already logged in, but check if we know the ip address
			if((!session['user-ip'])||(session['user-ip'] == '')) {
				//No ip. - TODO will have to revert back to the PHP version
			} else {
			
				//We're good to make a db request
				
				//TODO increment and write the view-count session var.
				
				
				var layer = 3;
				var ip = "1.2.3.4";
				var userCheck = "";
				var initialRecords = 100;
				var outputJSON = {};
				var debug = false;

	
				//PHP
				//TODO: date_default_timezone_set($server_timezone);

				if((params.passcode) && (params.passcode != '')||((params.reading) && (params.reading != ''))) { 
				//TODO: 
				/*$layer_info = $ly->get_layer_id($_REQUEST['passcode'], $_REQUEST['reading']);
				if($layer_info) {
					$layer = $layer_info['int_layer_id'];
				} else {
					//Create a new layer - TODO: don't allow layers so easily
					$layer = $ly->new_layer($_REQUEST['passcode'], 'public'); 
					
					//Given this is a new layer - the first user is the correct user
					$lg = new cls_login();
					$lg->update_subscriptions(clean_data($_REQUEST['whisper_site']), $layer);	
					
				}*/
				
				} else {	//End of passcode not = ''

					if(session['authenticated-layer']) {
						layer = session['authenticated-layer'];
					} else {
						layer = 1;		//Default to about layer
					}
				}

				if((params.units) && (params.units != '')) {
					units = params.units;
				}

				if((params.dbg) && (params.dbg == 'true')) {
					debug = true;
				} else {
					debug = false;
				}
			
				if(session['logged-user']) {
					userCheck = " OR int_author_id = " + session['logged-user'] + " OR int_whisper_to_id = " + session['logged-user']; 
			
				}
			
				if(session['logged-group-user']) {
					userChech = userCheck + " OR int_author_id = " + session['logged-group-user'] + " OR int_whisper_to_id = " + session['logged-group-user']; 
			
				}
			
				if((params.records) && (params.records < 100)) {
					initialRecords = 100;	//min this can be - needs to be about 4 to 1 of private to public to start reducing the number of public messages visible
				} else {
					if(params.records) {
						initialRecords = params.records;
					}
				}
			
			


				//TODO: $ip = $ly->getRealIpAddr();
			

			
				connection.query("SELECT * FROM tbl_ssshout WHERE int_layer_id = " + layer + " AND enm_active = 'true' AND (var_whisper_to = '' OR ISNULL(var_whisper_to) OR var_whisper_to ='" + ip + "' OR var_ip = '" + ip + "' " + userCheck + ") ORDER BY int_ssshout_id DESC LIMIT " + initialRecords, function(err, rows, fields) {
  
  
				  if (err) throw err;
  
				  //console.log(rows[0].var_shouted);

				  outputJSON.res = [];
				  outputJSON.ses = params.sessionId;
				  
				  for(var cnt = 0; cnt< rows.length; cnt++) {
				  
				  			var whisper = true;		//TODO generate these.
				  	
				  			var newEntry = {
				  				'text': rows[cnt].var_shouted_processed,
				  				'lat': rows[cnt].latitude,
				  				'lon': rows[cnt].longtiude,
				  				'dist': rows[cnt].dist,
				  				'ago': ago(rows[cnt].date_when_shouted),
				  				'whisper': whisper
				  			
				  			}
				  	
				  			outputJSON.res.push(newEntry);
				  							  
				  
				  }

				  cb(null, outputJSON);			//No errors

				   	

  
				  connection.end();
				});
			}
		} else {
			//Not logged in - TODO will have to revert back to the PHP version
		
		}
	
	
	});		//End of readSession


}







//Run at server startup
httpHttpsCreateServer(serverOptions);  

 