# LoopBack REST Connector

LoopBack REST connector allows Node.js application to interact with HTTP REST APIs using a template driven approach.

## Installation

npm install loopback-connector-rest

## Options passed in before and after hooks of connector
Now EVRest connector supports passing options (CallContext) to before and after hooks. It can be accessed as ctx.options.

## Supporting CRUD operations using template
Standard Rest Connecotr supports adding methods on Dao using templates however it does not support, templates for crud operations (settings.crud = true). To overcome this, EVRest Connector now supports templates for methods on connector object (not on Dao), so that crud operations also can use template

## Rest Model Template 
Standard methods of rest models like create, update, updateAll, query, all etc. can now use templates only for modifying the request.

## Documentation

For complete documentation, see [StrongLoop Documentation | REST Connector](http://docs.strongloop.com/display/LB/REST+connector).
