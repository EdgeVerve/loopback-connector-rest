// Copyright IBM Corp. 2013,2016. All Rights Reserved.
// Node module: loopback-connector-rest
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/**
 *
 * ©2016-2017 EdgeVerve Systems Limited (a fully owned Infosys subsidiary),
 * Bangalore, India. All Rights Reserved.
 *
 */

var debug = require('debug')('loopback:connector:rest');
var RestResource = require('./rest-model');
var RequestBuilder = require('./rest-builder');
var request = require('request');
var _ = require('lodash');
var g = require('strong-globalize')();
var JsonTemplate = require('./template');

/**
 * Export the initialize method to loopback-datasource-juggler
 * @param {DataSource} dataSource The loopback data source instance
 * @param {function} [callback] The callback function
 */
exports.initialize = function initializeDataSource(dataSource, callback) {
  var settings = dataSource.settings || {};
  var baseURL = settings.baseURL || settings.restPath || 'http://localhost:3000/';

  var connector = new RestConnector(baseURL, settings);
  dataSource.connector = connector;
  dataSource.connector.dataSource = dataSource;
  connector.needOptionsArgument = true;

  var DataAccessObject = function() {};

    // Copy the methods from default DataAccessObject
  if (!settings.operations || settings.crud) {
    if (dataSource.constructor.DataAccessObject) {
      for (var i in dataSource.constructor.DataAccessObject) {
        DataAccessObject[i] = dataSource.constructor.DataAccessObject[i];
      }
            /* eslint-disable one-var */
      for (var i in dataSource.constructor.DataAccessObject.prototype) {
        DataAccessObject.prototype[i] = dataSource.constructor.DataAccessObject.prototype[i];
      }
            /* eslint-enable one-var */
    }
  }
  connector.DataAccessObject = DataAccessObject;

  if (Array.isArray(settings.operations)) {
    settings.operations.forEach(function(op) {
      if (!op.template) {
        throw new Error(g.f('The operation template is missing: %j', op));
      }
      var builder = RequestBuilder.compile(op.template, connector._request);
      builder.connector = connector;

            // Bind all the functions to the template
      var functions = op.functions;
      if (functions) {
        for (var f in functions) {
          if (debug.enabled) {
            debug('Mixing in method: %s %j', f, functions[f]);
          }
          var params = functions[f];
          var isPrototypeMethod = f.startsWith('prototype.');
          if (isPrototypeMethod) {
            f = f.substr(10);
          }
          var paramNames = [];
          var paramSources = [];
                    // The params can be ['x', 'y'] or [{name: 'x', source: 'header'},
                    // {name: 'y'}]
          for (var i = 0, n = params.length; i < n; i++) {
            if (typeof params[i] === 'string') {
              paramNames.push(params[i]);
              paramSources.push(null);
            } else if (typeof params[i] === 'object') {
              paramNames.push(params[i].name);
              paramSources.push(params[i].source);
            }
          }
          var fn = builder.operation(paramNames, isPrototypeMethod);
          dataSource[f] = fn;

          var path = '/' + f;
          fn.accepts = [];
          fn.shared = true;
          var args = builder.template.compile();
          paramNames.forEach(function(p, index) {
            var arg = args[p];
            var source = paramSources[index];
            if (!source) {
              source = arg.root;
              if (source === 'headers') {
                source = 'header';
              } else if (source === 'url') {
                source = 'path';
              }
            }
            if (source === 'path') {
                            /// Need to add path vars to the http url
              path += '/:' + p;
            }
            fn.accepts.push({
              arg: p,
              type: arg.type,
              required: arg.required,
              http: {
                source: source || 'query',
              },
            });
          });
          fn.returns = {
            arg: 'data',
            type: 'object',
            root: true,
          };
          fn.http = {
            verb: (op.template.method || 'GET').toLowerCase(),
            path: path,
          };
          fn.description = op.description || '';
          if (isPrototypeMethod) {
            DataAccessObject.prototype[f] = fn;
          }
          else {
            DataAccessObject[f] = fn;
          }
        }
      }
            // Inject the invoke function
      var invokeFn = function() {
        return builder.invoke.apply(builder, arguments);
      };
      var name = 'invoke';

      if (debug.enabled) {
        debug('Mixing in method: %s', name);
      }

      dataSource[name] = invokeFn;
      invokeFn.accepts = [
        {
          name: 'request',
          type: 'object',
        },
      ];
      invokeFn.shared = true;
            // dataSource.defineOperation(name, fn, fn);
      DataAccessObject[name] = invokeFn;
    });
  }

  settings.crudOperations = settings.crudOperations || {};

  Object.keys(settings.crudOperations).forEach(function(method) {
    var op = settings.crudOperations[method];
    var builder = RequestBuilder.compile(op, connector._request);
    builder.connector = connector;
    var params = op.args;
    var paramNames = [];
    var paramSources = [];
    for (var i = 0, n = params.length; i < n; i++) {
      if (typeof params[i] === 'string') {
        paramNames.push(params[i]);
        paramSources.push(null);
      } else if (typeof params[i] === 'object') {
        paramNames.push(params[i].name);
        paramSources.push(params[i].source);
      }
    }
    var fn = builder.connectorOperation(paramNames, op);
    dataSource[method] = fn;

        //var args = builder.template.compile();
    connector[method] = fn;
  });

  callback && process.nextTick(callback);
};

exports.RestConnector = RestConnector;

/**
 * The RestConnector constructor
 * @param {string} baseURL The base URL
 * @param {object} settings The settings
 * @constructor
 */
function RestConnector(baseURL, settings) {
  settings = settings || {};
  var options = settings.options || {};
  var defaults = settings.defaults || {};

  this._baseURL = baseURL;
  this._models = {};
  this._resources = {};

  debug('RestConnector:settings', settings);

  settings = _.omit(settings, ['options', 'defaults', 'connector', 'operations']);

    // Cascade the options in priority order for request module
    // options is the highest order then settings and defaults
  this._settings = _.merge(defaults, settings, options);

    // loopback-datasource-juggler uses connector.settings and
    // not connector._settings, other connectors like mongo,
    // postgres etc. also expose settings as settings, and not _settings
  this.settings = this._settings;
  var templates = this._settings.templates || {};
  var self = this;
  self.templates = {};
  Object.keys(templates).forEach(function(method) {
    var tempalte = new JsonTemplate(templates[method]);
    self.templates[method] = tempalte;
  });

    // map clientCert/clientKey to cert/key for backward compatibility
  if (this._settings.clientKey && this._settings.clientCert) {
    this._settings.key = this._settings.clientKey;
    this._settings.cert = this._settings.clientCert;
  }

  debug('RestConnector:this._settings', this._settings);
  this._request = request.defaults(this._settings);
}

/**
 * Hook for defining a model by the data source
 * @param {object} definition The model description
 */
RestConnector.prototype.define = function defineModel(definition) {
  var m = definition.model.modelName;
  this.installPostProcessor(definition);
  this._models[m] = definition;
  this._resources[m] = new RestResource(definition.settings.resourceName ||
        definition.model.pluralModelName, this._baseURL, this._request);
  var restModel = this._resources[m];
  restModel.connector = this;
  restModel.modelName = m;
};

RestConnector.prototype.getDefaultIdType = function() {
  return String;
};

/**
 * Install the post processor
 * @param {object} definition The model description
 */
RestConnector.prototype.installPostProcessor = function installPostProcessor(definition) {
  var dates = [];
  Object.keys(definition.properties).forEach(function(column) {
    if (definition.properties[column].type.name === 'Date') {
      dates.push(column);
    }
  });

  var postProcessor = function(model) {
    var max = dates.length;
    for (var i = 0; i < max; i++) {
      var column = dates[i];
      if (model[column]) {
        model[column] = new Date(model[column]);
      }
    }
    return model;
  };

  definition.postProcessor = postProcessor;
};

/**
 * Pre-process the request data
 * @param {*} data The request data
 * @returns {{}}
 */
RestConnector.prototype.preProcess = function preProcess(data) {
  var result = {};
  Object.keys(data).forEach(function(key) {
    if (data[key] !== null) {
      result[key] = data[key];
    }
  });
  return result;
};

/**
 * Post-process the response data
 * @param {string} model The model name
 * @param {*} data The response data
 * @param {boolean} many Is it an array
 */
RestConnector.prototype.postProcess = function postProcess(model, data, many) {
  var result = data;
  var postProcessor = this._models[model].postProcessor;
  if (postProcessor && data) {
    if (!many) {
      result = postProcessor(data);
    } else if (Array.isArray(data)) {
      result = [];
      var size = data.length;
      for (var i = 0; i < size; i++) {
        if (data[i]) {
          result[i] = postProcessor(data[i]);
        }
      }
    }
  }
  return result;
};

/**
 * Get a REST resource client for the given model
 * @param {string} model The model name
 * @returns {*}
 */
RestConnector.prototype.getResource = function getResourceUrl(model) {
  var resource = this._resources[model];
  if (!resource) {
    throw new Error(g.f('Resource for %s is not defined', model));
  }
  return resource;
};

/**
 * Create an instance of the model with the given data
 * @param {string} model The model name
 * @param {object} data The model instance data
 * @param {function} [callback] The callback function
 */
RestConnector.prototype.create = function create(model, data, options, callback) {
  this.getResource(model).create(data, options, function(err, body, response) {
    if (err) {
      callback && callback(err, body);
      return;
    }
    if (response.statusCode < 400) {
      body.statusCode = response.statusCode;
      callback && callback(null, body ? body.id : '', '' , body);
    } else {
      var err = g.f('Error response: %d %j', response.statusCode, body);
      callback && callback(err);
    }
  });
};

/**
 * Update or create an instance of the model
 * @param {string} model The model name
 * @param {object} data The model instance data
 * @param {function} [callback] The callback function
 * */
RestConnector.prototype.updateOrCreate = function(model, data, options, callback) {
  var self = this;
  this.exists(model, data.id, options, function(err, exists) {
    if (exists) {
      self.save(model, data, options, callback);
    } else {
      self.create(model, data, options, function(err, id) {
        data.id = id;
        callback(err, data);
      });
    }
  });
};

/**
 * A factory to build callback function for a response
 * @param {string} model The model name
 * @param {function} [callback] The callback function
 * @returns {function}
 */
RestConnector.prototype.responseHandler = function(model, callback, many) {
  var self = this;
  return function(err, body, response) {
    if (err) {
      callback && callback(err, body);
      return;
    }
    if (response.statusCode === 200) {
      if (callback) {
        var result = self.postProcess(model, body, many);
        callback(null, result);
      }
    } else {
      var err = g.f('Error response: %d %j', response.statusCode, body);
      callback && callback(err);
    }
  };
};

/**
 * Save an instance of a given model
 * @param {string} model The model name
 * @param {object} data The model instance data
 * @param {function} [callback] The callback function
 */
RestConnector.prototype.save = function save(model, data, options, callback) {
  this.getResource(model).update(data.id, data, options, this.responseHandler(model, callback));
};

RestConnector.prototype.update = function update(model, query, data, options, callback) {
    // PKG TODO Not sure why query.where should be checked
  if (data.id || query.where) {
    this.getResource(model).update(data.id, data, options, this.responseHandler(model, callback));
  } else {
    this.getResource(model).updateAll(query, data, options, this.responseHandler(model, callback));
  }
};

/**
 * Check the existence of a given model/id
 * @param {string} model The model name
 * @param {*} id The id value
 * @param {function} [callback] The callback function
 */
RestConnector.prototype.exists = function exists(model, id, options, callback) {
  this.getResource(model).find(id, options, function(err, body, response) {
    if (err) {
      callback && callback(err, body);
      return;
    }
    if (response.statusCode === 200) {
      callback && callback(null, true);
    } else if (response.statusCode === 404) {
      callback && callback(null, false);
    } else {
      var err = g.f('Error response: %s %j', response.statusCode, body);
      callback && callback(err);
    }
  });
};

/**
 * Find an instance of a given model/id
 * @param {string} model The model name
 * @param {*} id The id value
 * @param {function} [callback] The callback function
 */
RestConnector.prototype.find = function find(model, id, options, callback) {
  this.getResource(model).find(id, options, this.responseHandler(model, callback));
};

/**
 * Delete an instance for a given model/id
 * @param {string} model The model name
 * @param {*} id The id value
 * @param {function} [callback] The callback function
 */
RestConnector.prototype.destroy = function destroy(model, id, options, callback) {
  this.getResource(model).delete(id, options, this.responseHandler(model, callback));
};

/**
 * Query all instances for a given model based on the filter
 * @param {string} model The model name
 * @param {object} filter The filter object
 * @param {function} [callback] The callback function
 */
RestConnector.prototype.all = function all(model, filter, options, callback) {
  function getFields(data, arr) {
    _.forEach(data, function dataAccessGetKeysForEach(value, key) {
      if ((typeof key === 'string') && (key !== 'and' && key !== 'or')) {
        if (key.indexOf('.') > -1) {
          Array.prototype.splice.apply(arr, [0, 0].concat(key.split('.')));
        } else {
          arr.push({
            key: key,
            value: value,
          });
        }
      } else if (typeof value === 'object') {
        getFields(value, arr);
      }
    });
  }

  function isInstanceQuery(filter) { //pk name needs to be a parameter
    var pk = 'id';
    var whereConds = [];
    getFields(filter.where, whereConds);
    var _isDeleted = whereConds.find(function(cond) {
      return cond.key === '_isDeleted';
    });
    if (_isDeleted && _isDeleted.value === true) {
      return false;
    }
    var pkValue = whereConds.find(function(cond) {
      return cond.key === pk;
    });
    var allowedKeys = ['_scope', '_isDeleted'];
    if (pkValue !== undefined) {
      var modelAllowedKeys = [pk].concat(allowedKeys);
      var allowed = whereConds.reduce(function(result, cond) {
        if (!modelAllowedKeys.includes(cond.key)) {
          return false;
        } else {
          return result;
        }
      }, true);
      if (allowed) {
        return true;
      } else {
        return false;
      }
    } else {
      return false;
    }
  }

    // FIXME: [rfeng] Test the filter to decide if it's findById
  if (filter && filter.where && (!filter.order) &&
        filter.limit === 1 && filter.offset === 0) {
    if (isInstanceQuery(filter)) {
            // Map findById
      var whereConds = [];
      getFields(filter.where, whereConds);
      var id = whereConds.find(function(cond) {
        return cond.key === 'id';
      }).value;
      return this.find(model, id, options, function(err, result) {
        if (!err) {
          if (!result) {
            result = [];
          } else {
            result = [result];
          }
        }
        callback && callback(err, result);
      });
    }
  }
  this.getResource(model).all(filter, options, this.responseHandler(model, callback, true));
};

/**
 * Delete all instances for a given model
 * @param {string} model The model name
 * @param {function} [callback] The callback function
 */
RestConnector.prototype.destroyAll = function destroyAll(model, where, options, callback) {
  if (where && where.id) {
    this.getResource(model).delete(where.id, options, this.responseHandler(model, callback));
  } else {
    this.getResource(model).deleteAll(this.responseHandler(model, options, callback));
  }
};

/**
 * Count cannot not be supported efficiently.
 * @param {string} model The model name
 * @param {function} [callback] The callback function
 * @param {object} where The where object
 */
RestConnector.prototype.count = function count(model, callback, where) {
  throw new Error(g.f('Not supported'));
};

/**
 * Update attributes for a given model/id
 * @param {string} model The model name
 * @param {*} id The id value
 * @param {object} data The model instance data
 * @param {function} [callback] The callback function
 */
RestConnector.prototype.updateAttributes = function(model, id, data, options, callback) {
  data.id = id;
  this.getResource(model).update(id, options, this.responseHandler(model, callback));
};

/**
 * Get types associated with the connector
 * @returns {String[]} The types for the connector
 */
RestConnector.prototype.getTypes = function() {
  return ['rest'];
};
