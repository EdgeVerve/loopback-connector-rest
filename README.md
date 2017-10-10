# LoopBack REST Connector

LoopBack REST connector allows Node.js application to interact with HTTP REST APIs using a template driven approach.

> ### This project is modification of original [loopback-connector-rest](https://github.com/strongloop/loopback-connector-rest).

## Installation

npm install https://github.com/EdgeVerve/loopback-connector-rest/v1.0.0
> use latest version

## Options passed in before and after hooks of connector
Now OERest connector supports passing options (CallContext) to before and after hooks. It can be accessed as ctx.options.

## Supporting CRUD operations using template
Standard Rest Connecotr supports adding methods on Dao using templates however it does not support, templates for crud operations (settings.crud = true). To overcome this, OERest Connector now supports templates for methods on connector object (not on Dao), so that crud operations also can use template

## Rest Model Template 
Standard methods of rest models like create, update, updateAll, query, all etc. can now use templates only for modifying the request.

## Support of prototype methods 
In operations you can define prototype methods like updateAttributes, deleteById etc. These have advantage that this parameter will be pointed to instance, so you can use values like this.id in URL.
Example.
```
{
				"template": {
					"method": "PUT",
					"url": "http://localhost:4000/rest/bank/bank1/{model.modelName}/{this.id}",
					"body": "{!data:object}"
				},
				"functions": {
					"prototype.updateAttributes": ["data"]
				}
```


## Sample configuration

operations section is to templatize model custom methods, for templatizing inbuild crud methods, you can use templates section.

```
"oelocalrest": {
        "connector": "loopback-connector-rest",
        "debug": "false",
        "crud" : true,     
        "name": "oelocalrest",
        "updateAttributesByIdOnly" : false,
        "baseURL": "http://localhost:4000/api/",
        "options": {
            "headers": {
                "accept": "application/json",
                "content-type": "application/json"
            },
            "strictSSL": false
        },
        "templates": {
            "create": {
                "method": "POST",
                "uri": "http://localhost:4000/rest/bank/{!callContext.ctx.tenantId}/account",
                "body": "{!body:object}"
            },
            "query": {
                    "method": "GET",
                    "uri": "http://localhost:4000/rest/bank/{!callContext.ctx.tenantId}/account"
            }
        },
        "operations": [{
                "template": {
                    "method": "GET",
                    "url": "http://localhost:4000/rest/error1"
                },
                "functions": {
                    "error1": []
                }
        }
       ]
    }
```

## Documentation

For complete documentation, see [StrongLoop Documentation | REST Connector](http://docs.strongloop.com/display/LB/REST+connector).